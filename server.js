require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const BOARD_FILE = path.join(__dirname, 'board.dat');
const BOARD_WIDTH = 3000;
const BOARD_HEIGHT = 3000;
const BUFFER_SIZE = BOARD_WIDTH * BOARD_HEIGHT * 3; // R,G,B per pixel

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client initialized.');
} else {
    console.warn('Supabase credentials not found. Cloud persistence disabled.');
}

// Initialize board
let board = Buffer.alloc(BUFFER_SIZE);
board.fill(255); // White

// Chat History
const chatHistory = [];
const MAX_HISTORY = 20;

// Load board logic
const initBoard = async () => {
    let loadedFromCloud = false;

    // 1. Try Supabase first (Source of Truth)
    if (supabase) {
        try {
            console.log('Checking Supabase for board.dat...');
            const { data, error } = await supabase
                .storage
                .from('pixel-board')
                .download('board.dat');

            if (error) {
                console.log('Supabase download error:', error.message);
            } else if (data) {
                const arrayBuffer = await data.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                if (buffer.length === BUFFER_SIZE) {
                    board = buffer;
                    console.log('Board loaded from Supabase!');
                    // Save locally to cache
                    fs.writeFileSync(BOARD_FILE, board);
                    loadedFromCloud = true;
                } else {
                    console.log('Supabase board size mismatch.');
                }
            }
        } catch (err) {
            console.error('Error with Supabase init:', err);
        }
    }

    // 2. If Supabase failed, try local file
    if (!loadedFromCloud && fs.existsSync(BOARD_FILE)) {
        try {
            console.log('Loading board from local file (Fallback)...');
            const data = fs.readFileSync(BOARD_FILE);
            if (data.length === BUFFER_SIZE) {
                board = data;
                console.log('Local board loaded.');
            } else {
                console.log('Local board size mismatch, ignoring.');
            }
        } catch (err) {
            console.error('Error loading local board:', err);
        }
    }
};

// Run init
initBoard();

app.use(express.static('public'));

// --- Middleware: Simple Basic Auth ---
const basicAuth = (req, res, next) => {
    const auth = { login: 'admin', password: 'admin123' }; // TODO: Env vars
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === auth.login && password === auth.password) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Authentication required.');
};

// --- Admin Routes ---
app.get('/admin', basicAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- Admin Zones API ---
app.get('/api/config', (req, res) => {
    // Return only public anon key
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_KEY
    });
});

app.get('/api/admin/stats', basicAuth, (req, res) => {
    res.json({
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss
    });
});

app.post('/api/admin/save', basicAuth, async (req, res) => {
    console.log('Admin triggered force save.');
    needsSave = true;
    await saveBoard();
    res.json({ success: true, message: 'Save triggered successfully.' });
});

// Zones Persistence
const ZONES_FILE = path.join(__dirname, 'zones.json');
let protectedZones = [];
if (fs.existsSync(ZONES_FILE)) {
    try {
        protectedZones = JSON.parse(fs.readFileSync(ZONES_FILE));
        console.log(`Loaded ${protectedZones.length} protected zones.`);
    } catch (e) {
        console.error('Error loading zones:', e);
    }
}

function saveZones() {
    fs.writeFileSync(ZONES_FILE, JSON.stringify(protectedZones, null, 2));
}

// ...

app.post('/api/admin/clear', basicAuth, (req, res) => {
    console.log('Admin triggered clear board.');
    board.fill(255);
    needsSave = true;
    io.emit('init', board);
    io.emit('chat', { id: 'SYSTEM', text: '⚠️ BOARD CLEARED BY ADMIN ⚠️', name: 'System' });
    res.json({ success: true, message: 'Board cleared.' });
});

// Persistence logic
let needsSave = false;
let isUploading = false;

const saveBoard = async () => {
    if (needsSave) {
        // 1. Save locally
        fs.writeFile(BOARD_FILE, board, (err) => {
            if (err) console.error('Error saving local board:', err);
        });

        // 2. Upload to Supabase (if configured)
        if (supabase && !isUploading) {
            isUploading = true;
            console.log('Uploading board to Supabase...');

            const { error } = await supabase
                .storage
                .from('pixel-board')
                .upload('board.dat', board, {
                    contentType: 'application/octet-stream',
                    upsert: true
                });

            if (error) {
                console.error('Supabase upload error:', error.message);
            } else {
                console.log('Supabase upload success.');
            }

            isUploading = false;
        }

        needsSave = false;
    }
};


// Save every 10 seconds
setInterval(saveBoard, 10000);

// Helper to broadcast leaderboard
function broadcastLeaderboard() {
    const clients = [];
    io.sockets.sockets.forEach((s) => {
        if (s.pixelScore > 0) {
            clients.push({ name: s.name || 'Anon', score: s.pixelScore });
        }
    });
    // Sort desc
    clients.sort((a, b) => b.score - a.score);
    // Top 5
    const top5 = clients.slice(0, 5);
    io.emit('leaderboard', top5);
}

// V7: Ink / Energy System
// Map<socketId, { ink: number, lastRefill: number, isUser: boolean }>
const userInk = new Map();

const GUEST_MAX = 250;
const GUEST_REFILL_RATE = 15000; // 15s per pixel
const USER_MAX = 750;
const USER_REFILL_RATE = 10000; // 10s per pixel

function getInkState(socket) {
    // Prefer guestId from query, fallback to socket.id (shouldn't happen with updated client)
    const id = socket.handshake.query.guestId || socket.id;

    if (!userInk.has(id)) {
        userInk.set(id, {
            ink: GUEST_MAX,
            lastRefill: Date.now(),
            isUser: false
        });
    }
    return userInk.get(id);
}

function updateInk(socket) {
    const state = getInkState(socket); // Pass socket object now
    const now = Date.now();
    const max = state.isUser ? USER_MAX : GUEST_MAX;
    const rate = state.isUser ? USER_REFILL_RATE : GUEST_REFILL_RATE;

    // Visual refill: (time_diff / rate) pixels
    const elapsed = now - state.lastRefill;
    if (elapsed > 0) {
        const refillAmount = elapsed / rate;
        state.ink = Math.min(max, state.ink + refillAmount);
        state.lastRefill = now;
    }

    // Emit rate for client animation
    socket.emit('ink', {
        ink: Math.floor(state.ink),
        max,
        rate
    });
    return state;
}

io.on('connection', (socket) => {
    // console.log('A user connected');
    io.emit('online_count', io.engine.clientsCount);

    // Send Chat History
    socket.emit('chat_history', chatHistory);

    // V7: Auth Handling (Join) - moved up or just use helper

    // Initial Leaderboard
    broadcastLeaderboard();

    // Initial Ink
    updateInk(socket);

    // System Join Message
    socket.broadcast.emit('chat', { id: 'SYSTEM', text: 'A new canvas explorer joined!', name: 'System' });

    socket.emit('init', board);

    // V7: Ink / Energy System
    // Map<socketId, { ink: number, lastRefill: number, isUser: boolean }>
    // (Moved to global scope above)

    socket.emit('init', board);

    // --- Socket Event Handlers ---
    socket.on('pixel', (data) => {
        const state = updateInk(socket);
        if (state.ink < 1) {
            socket.emit('error_msg', 'Out of Ink!');
            return;
        }

        const { x, y, r, g, b, size = 1 } = data; // Default size 1

        // Check Protection
        for (const zone of protectedZones) {
            if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h) {
                return; // Protected
            }
        }

        // Calculate bounds
        const half = Math.floor(size / 2);
        const startX = Math.max(0, x - half);
        const startY = Math.max(0, y - half);
        const endX = Math.min(BOARD_WIDTH, x - half + size);
        const endY = Math.min(BOARD_HEIGHT, y - half + size);

        let changed = false;
        let pixelCount = 0;

        for (let py = startY; py < endY; py++) {
            for (let px = startX; px < endX; px++) {
                const index = (py * BOARD_WIDTH + px) * 3;
                if (board[index] !== r || board[index + 1] !== g || board[index + 2] !== b) {
                    board[index] = r;
                    board[index + 1] = g;
                    board[index + 2] = b;
                    changed = true;
                    pixelCount++;
                }
            }
        }

        if (changed) {
            // Deduct Ink
            state.ink -= 1;
            state.ink -= 1; // Why twice? Removing one.

            // Wait, previous code had state.ink -= 1 twice by mistake?
            // "state.ink -= 1; state.ink -= 1;" in the read file step 981 logic.
            // I'll fix that too.
            state.ink += 1; // Correcting previous double decrement logic locally here for cleaner code
            // Actually, I'll just write clean code here.

            needsSave = true;
            socket.broadcast.emit('pixel', { x, y, r, g, b, size });

            if (!socket.pixelScore) socket.pixelScore = 0;
            socket.pixelScore += pixelCount;
            broadcastLeaderboard();
            updateInk(socket); // Send update
        }
    });

    // V6: Batch Pixels (Stamps)
    socket.on('batch_pixels', (pixels) => {
        if (!Array.isArray(pixels) || pixels.length > 500) return;

        const state = updateInk(socket);
        // Check if enough ink
        if (state.ink < pixels.length) {
            socket.emit('error_msg', 'Not enough Ink!');
            return;
        }

        let changed = false;
        let pixelCount = 0;

        for (const p of pixels) {
            const { x, y, r, g, b } = p;
            if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) continue;

            let protected = false;
            for (const zone of protectedZones) {
                if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h) {
                    protected = true;
                    break;
                }
            }
            if (protected) continue;

            const index = (y * BOARD_WIDTH + x) * 3;
            if (board[index] !== r || board[index + 1] !== g || board[index + 2] !== b) {
                board[index] = r;
                board[index + 1] = g;
                board[index + 2] = b;
                changed = true;
                pixelCount++;
            }
        }

        if (changed) {
            state.ink -= pixelCount; // Accurate deduction
            needsSave = true;
            socket.broadcast.emit('batch_pixels', pixels);

            if (!socket.pixelScore) socket.pixelScore = 0;
            socket.pixelScore += pixelCount;
            broadcastLeaderboard();
            updateInk(socket);
        }
    });

    // V7: Auth Handling (Join)
    socket.on('auth', (token) => {
        if (!token || !supabase) return;

        supabase.auth.getUser(token).then(({ data, error }) => {
            if (!error && data.user) {
                const state = getInkState(socket.id);
                if (!state.isUser) {
                    state.isUser = true;
                    state.ink = USER_MAX;
                    state.ink = Math.max(state.ink, USER_MAX);
                }
                socket.emit('auth_success', {
                    name: data.user.email.split('@')[0],
                    limit: USER_MAX
                });
                updateInk(socket);
            }
        });
    });

    // V6: Cursor Reactions
    socket.on('reaction', (data) => {
        socket.broadcast.emit('reaction', {
            id: socket.id,
            emoji: data.emoji,
            x: data.x,
            y: data.y
        });
    });

    socket.on('cursor', (data) => {
        socket.name = data.name || 'Anon';
        socket.broadcast.emit('cursor', {
            id: socket.id,
            x: data.x,
            y: data.y,
            name: data.name
        });
    });

    socket.on('chat', (msg) => {
        if (msg && msg.text) {
            const text = msg.text.substring(0, 100);

            // ADMIN TOOLS (Secret Command)
            if (text.startsWith('/clear admin123')) {
                console.log('Admin Clear Command Executed');
                board.fill(255);
                needsSave = true;
                io.emit('init', board); // Reload everyone

                const sysMsg = { id: 'SYSTEM', text: '⚠️ BOARD CLEARED BY ADMIN ⚠️', name: 'System' };
                chatHistory.push(sysMsg);
                if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
                io.emit('chat', sysMsg);
                return;
            }

            const chatMsg = {
                id: socket.id,
                text: text,
                name: msg.name ? msg.name.substring(0, 20) : null
            };

            // Add to history
            chatHistory.push(chatMsg);
            if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

            io.emit('chat', chatMsg);
        }
    });

    socket.on('disconnect', () => {
        io.emit('online_count', io.engine.clientsCount);
        // Tell others to remove this cursor
        socket.broadcast.emit('cursor_disconnect', socket.id);
        // System Leave Message
        socket.broadcast.emit('chat', { id: 'SYSTEM', text: 'An artist has left the studio.', name: 'System' });
    });
}); // End of io.on('connection')

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
