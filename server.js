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

io.on('connection', (socket) => {
    // console.log('A user connected');
    io.emit('online_count', io.engine.clientsCount);

    // Send Chat History
    socket.emit('chat_history', chatHistory);

    // System Join Message
    socket.broadcast.emit('chat', { id: 'SYSTEM', text: 'A new canvas explorer joined!', name: 'System' });

    socket.emit('init', board);

    socket.on('pixel', (data) => {
        const { x, y, r, g, b, size = 1 } = data; // Default size 1

        // Calculate bounds for the brush (centered at x, y)
        const half = Math.floor(size / 2);
        const startX = Math.max(0, x - half);
        const startY = Math.max(0, y - half);
        const endX = Math.min(BOARD_WIDTH, x - half + size);
        const endY = Math.min(BOARD_HEIGHT, y - half + size);

        let changed = false;

        for (let py = startY; py < endY; py++) {
            for (let px = startX; px < endX; px++) {
                const index = (py * BOARD_WIDTH + px) * 3;

                // Only update if color is different (and valid index)
                if (board[index] !== r || board[index + 1] !== g || board[index + 2] !== b) {
                    board[index] = r;
                    board[index + 1] = g;
                    board[index + 2] = b;
                    changed = true;
                }
            }
        }

        if (changed) {
            needsSave = true;
            // Broadcast the brush stroke itself, let clients handle the loop aka "drawRect"
            socket.broadcast.emit('pixel', { x, y, r, g, b, size });
        }
    });

    socket.on('cursor', (data) => {
        // Broadcast cursor position to everyone else
        // data: { x, y, name }
        socket.broadcast.emit('cursor', {
            id: socket.id,
            x: data.x,
            y: data.y,
            name: data.name // Pass nickname
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
});

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
