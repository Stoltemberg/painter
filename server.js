require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 5e7, // 50MB (Allow large init payload)
    pingTimeout: 60000 // Increase timeout for slow connections
});
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { createClient: createRedisClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const PORT = process.env.PORT || 3000;
const BOARD_FILE = path.join(__dirname, 'board.dat');
const BOARD_WIDTH = 3000;
const BOARD_HEIGHT = 3000;
const BUFFER_SIZE = BOARD_WIDTH * BOARD_HEIGHT * 3; // R,G,B per pixel
const CHUNK_LINES = 50; // Smaller chunks (~450KB) for stability

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

// Chat Rate Limit
const chatRateLimit = new Map(); // socketId -> lastTime
const CHAT_COOLDOWN = 1000; // 1 second
const MAX_MSG_LENGTH = 100;


// simple team scores
let teamScores = { red: 0, blue: 0, green: 0 };
const TEAMS = ['none', 'red', 'blue', 'green'];
const TEAM_SCORES_FILE = path.join(__dirname, 'team_scores.json');

// Active Overlays (In-Memory)
let activeOverlays = [];


// Load Team Scores (Async with Cloud Fallback)
async function initTeamScores() {
    let loaded = false;

    // 1. Try Supabase
    if (supabase) {
        try {
            const { data, error } = await supabase.storage
                .from('pixel-board')
                .download('team_scores.json');

            if (data) {
                const text = await data.text();
                teamScores = JSON.parse(text);
                console.log('Loaded Team Scores from Cloud:', teamScores);
                // Save locally to sync
                saveTeamScores();
                loaded = true;
            }
        } catch (e) {
            console.warn('Cloud team scores not found or error:', e.message);
        }
    }

    // 2. Local Fallback
    if (!loaded) {
        try {
            if (fs.existsSync(TEAM_SCORES_FILE)) {
                const data = fs.readFileSync(TEAM_SCORES_FILE, 'utf8');
                teamScores = JSON.parse(data);
                console.log('Loaded Team Scores from Local:', teamScores);
            }
        } catch (e) {
            console.warn('Failed to load local team scores:', e);
        }
    }
}
initTeamScores();


function saveTeamScores() {
    fs.writeFile(TEAM_SCORES_FILE, JSON.stringify(teamScores), (err) => {
        if (err) console.error('Error saving team scores:', err);
    });
}

// Leaderboard Persistence
const dirtyScores = new Map(); // guestId -> { name, score, team }
let globalLeaderboard = [];
let lastTeamScoreUpload = 0;

async function syncScores() {
    if (!supabase) return;

    // 1. Upsert Dirty Scores
    if (dirtyScores.size > 0) {
        const updates = Array.from(dirtyScores.values());
        dirtyScores.clear();

        const { error } = await supabase.from('leaderboard').upsert(updates);
        if (error) console.error('Score Sync Error:', error);
    }

    // 2. Fetch Global Top 10
    const { data } = await supabase
        .from('leaderboard')
        .select('name, score')
        .order('score', { ascending: false })
        .limit(10);

    if (data) {
        globalLeaderboard = data;
        io.emit('leaderboard', globalLeaderboard);
    }

    // 3. Persist Team Scores to Cloud (every 5s)
    const now = Date.now();
    if (now - lastTeamScoreUpload > 5000) {
        lastTeamScoreUpload = now;
        const { error } = await supabase.storage
            .from('pixel-board')
            .upload('team_scores.json', JSON.stringify(teamScores), {
                contentType: 'application/json',
                upsert: true
            });
        if (error) console.error('Team Score Cloud Save Error:', error.message);
    }
}

// Sync Cache every 5s
// Real-time In-Memory Helper
function updateGlobalLeaderboard(name, score, guestId) {
    // Check if user is already in top 50 (larger buffer)
    const existingIndex = globalLeaderboard.findIndex(p => p.guestId === guestId || p.name === name); // simplify matching

    if (existingIndex !== -1) {
        globalLeaderboard[existingIndex].score = score;
        globalLeaderboard[existingIndex].name = name; // Update name if changed
    } else {
        globalLeaderboard.push({ name, score, guestId });
    }

    // Sort and Top 10
    globalLeaderboard.sort((a, b) => b.score - a.score);
    if (globalLeaderboard.length > 10) globalLeaderboard.length = 10;
}

// Sync Cache every 1s (Real-time requirement)
setInterval(syncScores, 1000);

// Load board logic
const initBoard = async () => {
    let loadedFromCloud = false;

    // Helper to migrate old board if needed
    const loadAndMigrate = (buffer) => {
        const len = buffer.length;

        if (len === BUFFER_SIZE) {
            board = buffer;
            return true;
        }

        // Migrate from 3000x3000 (Expand)
        if (len === 3000 * 3000 * 3) {
            console.log('Migrating 3000x3000 board to 4500x4500...');
            const oldWidth = 3000;
            const newWidth = 4500;
            for (let y = 0; y < 3000; y++) {
                const sourceStart = y * oldWidth * 3;
                const sourceEnd = sourceStart + (oldWidth * 3);
                const targetStart = y * newWidth * 3;
                buffer.copy(board, targetStart, sourceStart, sourceEnd);
            }
            console.log('Migration complete (Expanded).');
            return true;
        }

        // Migrate from 6000x6000 (Crop)
        if (len === 6000 * 6000 * 3) {
            console.log('Migrating 6000x6000 board to 4500x4500...');
            const oldWidth = 6000;
            const newWidth = 4500;
            // We only take the top-left 4500x4500
            for (let y = 0; y < 4500; y++) {
                const sourceStart = y * oldWidth * 3;
                // We copy 4500 pixels (width) * 3 bytes
                const copyLen = newWidth * 3;
                const targetStart = y * newWidth * 3;
                buffer.copy(board, targetStart, sourceStart, sourceStart + copyLen);
            }
            console.log('Migration complete (Cropped).');
            return true;
        }

        return false;
    };

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

                if (loadAndMigrate(buffer)) {
                    console.log('Board loaded from Supabase!');
                    // Save locally to cache force update size
                    fs.writeFileSync(BOARD_FILE, board);
                    loadedFromCloud = true;
                } else {
                    console.log('Supabase board size mismatch and migration failed.');
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
            if (loadAndMigrate(data)) {
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
        supabaseKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
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

// --- Public Stats API ---
app.get('/api/stats/user/:id', async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Database unavailable' });
    const { id } = req.params;

    // 1. Get all sessions for this user
    const { data: sessions, error: sessionError } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', id);

    if (sessionError || !sessions) return res.json({ pixel_count: 0 });

    const sessionIds = sessions.map(s => s.id);
    if (sessionIds.length === 0) return res.json({ pixel_count: 0 });

    // 2. Count strokes for these sessions
    const { count, error: countError } = await supabase
        .from('strokes')
        .select('*', { count: 'exact', head: true })
        .in('session_id', sessionIds);

    if (countError) return res.status(500).json({ error: countError.message });

    res.json({ pixel_count: count, session_count: sessions.length });
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

const saveZones = () => {
    fs.writeFileSync(ZONES_FILE, JSON.stringify(protectedZones, null, 2));
};

app.get('/api/admin/zones', basicAuth, (req, res) => {
    res.json(protectedZones);
});

app.post('/api/admin/zones', basicAuth, express.json(), (req, res) => {
    const { x, y, w, h, reason } = req.body;
    if (x == null || y == null || w == null || h == null) return res.status(400).send('Missing args');
    const newZone = { id: Date.now().toString(), x, y, w, h, reason: reason || 'Admin' };
    protectedZones.push(newZone);
    saveZones();
    console.log('Added zone:', newZone);
    res.json({ success: true, zone: newZone });
});

app.delete('/api/admin/zones/:id', basicAuth, (req, res) => {
    const { id } = req.params;
    protectedZones = protectedZones.filter(z => z.id !== id);
    saveZones();
    res.json({ success: true });
});

app.get('/api/admin/board', basicAuth, (req, res) => {
    // Send the buffer directly
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(Buffer.from(board));
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
let strokeBuffer = [];
const STROKE_BATCH_LIMIT = 50; // Max strokes before auto-flush
const FLUSH_INTERVAL = 5000; // 5 seconds

// Helper: Flush buffered strokes to Supabase
async function flushStrokes() {
    if (strokeBuffer.length === 0 || !supabase) return;

    const batch = [...strokeBuffer];
    strokeBuffer = []; // Clear buffer immediately

    // Map to DB structure
    const rows = batch.map(s => ({
        x: s.x,
        y: s.y,
        color: s.color, // Expecting hex string or similar
        team: s.team,
        session_id: s.sessionId // We need to resolve this from guestId later
    }));

    // For now, we might not have session_id linked correctly if we don't look it up.
    // Simplifying: We will try to just insert basic data. 
    // If session_id is missing, we might need to adjust the schema or lookup logic.
    // For this step, let's just log if we can't insert.

    // Optimistic insert structure (assuming session mapping exists or nullable)
    // IMPORTANT: In the SQL schema we made session_id reference sessions(id).
    // We need to ensure we have a session ID. For now, we will skip session_id 
    // if we haven't implemented the session handshake yet, OR we update the logic 
    // to find/create session on connection.

    // To avoid FK errors right now without changing connection logic, 
    // we will only insert if we have a valid session UUID. 
    // If not, we skip the history log for that stroke (it still paints on board).

    const validRows = rows.filter(r => r.session_id);

    if (validRows.length > 0) {
        const { error } = await supabase.from('strokes').insert(validRows);
        if (error) console.error('Error flushing strokes:', error.message);
    }
}

// Flush interval
setInterval(flushStrokes, FLUSH_INTERVAL);

// Snapshot Logic (Lazy Cloud Save)
const saveBoard = async () => {
    // Only save if dirty AND not currently uploading
    if (needsSave && !isUploading) {
        // 1. Save locally (Cache only - keep for quick restart)
        // We can skip this if disk IO is a concern, but it's good for crash recovery.
        // On Render Free Tier, we'll skip frequent local writes to save IOPS/CPU.
        /* 
        fs.writeFile(BOARD_FILE, board, (err) => {
             if (err) console.error('Error saving local board:', err);
        }); 
        */

        // 2. Upload to Supabase (Source of Truth)
        if (supabase) {
            isUploading = true;
            console.log('Uploading board snapshot to Supabase...');

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
                needsSave = false; // logic: only mark clean if cloud accepted it
            }

            isUploading = false;
        }
    }
};

// Save Snapshot every 2 minutes (Lazy) - Less CPU usage
setInterval(saveBoard, 120000);

// Fallback RAM Leaderboard (no persistence)
function broadcastLeaderboardLegacy() {
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
    io.emit('team_scores', teamScores);
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

// Chunking Configuration

// Cache compressed board to save CPU/RAM on concurrent connects
let cachedCompressedBoard = null;
let lastCompressionTime = 0;
const COMPRESSION_TTL = 1000; // 1 second cache

const getCompressedBoard = () => {
    const now = Date.now();
    // Use cache if fresh
    if (cachedCompressedBoard && (now - lastCompressionTime < COMPRESSION_TTL)) {
        return cachedCompressedBoard;
    }

    // Refresh cache
    cachedCompressedBoard = zlib.gzipSync(board);
    lastCompressionTime = now;
    return cachedCompressedBoard;
    return cachedCompressedBoard;
};

// --- Redis & Sync Logic ---
let syncPub = null;

function updateBoardPixel(x, y, r, g, b) {
    const index = (y * BOARD_WIDTH + x) * 3;
    if (index < board.length && index >= 0) {
        board[index] = r;
        board[index + 1] = g;
        board[index + 2] = b;
        needsSave = true;
    }
}

async function initRedis() {
    if (process.env.REDIS_URL) {
        console.log('Initializing Redis Adapter...');
        try {
            const pubClient = createRedisClient({ url: process.env.REDIS_URL });
            const subClient = pubClient.duplicate();

            pubClient.on('error', (err) => console.error('Redis Pub Error:', err));
            subClient.on('error', (err) => console.error('Redis Sub Error:', err));

            await Promise.all([pubClient.connect(), subClient.connect()]);

            io.adapter(createAdapter(pubClient, subClient));

            // Sync Channel
            syncPub = pubClient;
            const syncSub = pubClient.duplicate();
            syncSub.on('error', (err) => console.error('Redis Sync Error:', err));
            await syncSub.connect();

            await syncSub.subscribe('board_sync', (message) => {
                try {
                    const payload = JSON.parse(message);
                    if (payload.t === 'p') {
                        const b = Buffer.from(payload.d, 'base64');
                        if (b.length >= 7) {
                            const x = b.readUInt16LE(0);
                            const y = b.readUInt16LE(2);
                            const r = b.readUInt8(4);
                            const g = b.readUInt8(5);
                            const b2 = b.readUInt8(6);
                            updateBoardPixel(x, y, r, g, b2);
                        }
                    } else if (payload.t === 'b') {
                        const buffers = payload.d.map(s => Buffer.from(s, 'base64'));
                        for (const b of buffers) {
                            if (b.length >= 7) {
                                const x = b.readUInt16LE(0);
                                const y = b.readUInt16LE(2);
                                const r = b.readUInt8(4);
                                const g = b.readUInt8(5);
                                const b2 = b.readUInt8(6);
                                updateBoardPixel(x, y, r, g, b2);
                            }
                        }
                    }
                } catch (e) { console.error('Redis Sync processing error', e); }
            });
            console.log('Redis Adapter & Sync Configured.');
        } catch (e) {
            console.error('Redis Init Failed:', e);
        }
    }
}
initRedis();

io.on('connection', async (socket) => {
    // console.log('A user connected');
    io.emit('online_count', io.engine.clientsCount);

    // Load Persistence
    const guestId = socket.handshake.query.guestId;
    socket.guestId = guestId;
    socket.pixelScore = 0;
    socket.dbSessionId = null; // Store database UUID for this session

    // --- Session Management (Supabase) ---
    if (supabase && guestId) {
        // 1. Try to find existing session for this guest UUID
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('id')
            .eq('guest_uuid', guestId)
            .single();

        if (sessionData) {
            socket.dbSessionId = sessionData.id;
            // Async update last_seen
            supabase.from('sessions').update({ last_seen: new Date() }).eq('id', socket.dbSessionId).then();
        } else {
            // Create new session
            const { data: newSession, error: createError } = await supabase
                .from('sessions')
                .insert({ guest_uuid: guestId })
                .select('id')
                .single();

            if (newSession) {
                socket.dbSessionId = newSession.id;
                console.log('New Session Created:', socket.dbSessionId);
            }
        }

        // Load Score
        const { data } = await supabase
            .from('leaderboard')
            .select('score')
            .eq('id', guestId)
            .single();
        if (data) socket.pixelScore = data.score;
    }

    // Send current scores
    socket.emit('pixel_score', socket.pixelScore);
    socket.emit('leaderboard', globalLeaderboard);
    socket.emit('team_scores', teamScores); // V7: Initial Team Scores

    // 1. Send Metadata
    socket.emit('board_info', { width: BOARD_WIDTH, height: BOARD_HEIGHT });

    // 2. Send Chunks Sequentially (RAW - No Compression)
    const totalChunks = Math.ceil(BOARD_HEIGHT / CHUNK_LINES);

    const sendChunks = async () => {
        for (let i = 0; i < totalChunks; i++) {
            if (!socket.connected) return;

            const startY = i * CHUNK_LINES;
            const endY = Math.min(startY + CHUNK_LINES, BOARD_HEIGHT);

            const startByte = startY * BOARD_WIDTH * 3;
            const endByte = endY * BOARD_WIDTH * 3;

            const slice = board.subarray(startByte, endByte);

            socket.emit('board_chunk', {
                y: startY,
                height: endY - startY,
                data: slice,
                progress: (i + 1) / totalChunks
            });

            await new Promise(resolve => setTimeout(resolve, 20));
        }
    };

    sendChunks().catch(e => console.error('Chunk send error:', e));

    // Send Chat History
    socket.emit('chat_history', chatHistory);

    // V7: Auth Handling (Join) - moved up or just use helper

    // Initial Leaderboard
    socket.emit('leaderboard', globalLeaderboard);
    socket.emit('team_scores', teamScores);
    socket.emit('pixel_score', socket.pixelScore || 0);
    if (!supabase) broadcastLeaderboardLegacy();

    // Initial Ink
    updateInk(socket);

    // System Join Message
    socket.broadcast.emit('chat', { id: 'SYSTEM', text: 'A new canvas explorer joined!', name: 'System' });

    // socket.emit('init', board); // Removed unused full board emit (client uses chunks)

    // V7: Ink / Energy System
    // Map<socketId, { ink: number, lastRefill: number, isUser: boolean }>
    // (Moved to global scope above)

    // socket.emit('init', board); // Disabled to prevent duplicate data transmission (Chunks used instead)

    // --- Socket Event Handlers ---
    socket.on('pixel', (data) => {
        if (!data) return; // Prevention
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

            needsSave = true;
            // Binary Packet: [X(2), Y(2), R(1), G(1), B(1), Team(1)]
            const tid = data.t || 0;
            const bBuf = Buffer.alloc(8);
            bBuf.writeUInt16LE(x, 0);
            bBuf.writeUInt16LE(y, 2);
            bBuf.writeUInt8(r, 4);
            bBuf.writeUInt8(g, 5);
            bBuf.writeUInt8(b, 6);
            bBuf.writeUInt8(tid, 7);

            socket.broadcast.emit('pixel', bBuf);

            if (syncPub) {
                syncPub.publish('board_sync', JSON.stringify({ t: 'p', d: bBuf.toString('base64') }));
            }
            if (TEAMS[tid]) teamScores[TEAMS[tid]]++;

            if (!socket.pixelScore) socket.pixelScore = 0;
            socket.pixelScore += pixelCount;

            // --- Push to History Buffer ---
            if (socket.dbSessionId) {
                // Convert RGB back to hex for DB
                const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                strokeBuffer.push({
                    x, y, color: hex,
                    team: TEAMS[tid],
                    sessionId: socket.dbSessionId
                });

                // Safety: Auto flush if too big
                if (strokeBuffer.length >= STROKE_BATCH_LIMIT) {
                    flushStrokes();
                }
            }

            // Queue for Sync
            if (supabase && socket.guestId) {
                dirtyScores.set(socket.guestId, {
                    id: socket.guestId,
                    name: socket.name || 'Guest',
                    score: socket.pixelScore,
                    team: TEAMS[(data.t || 0)] || 'none'
                });
            } else {
                // Fallback for non-supabase mode (RAM only)
                broadcastLeaderboardLegacy();
            }

            // Real-time Update
            updateGlobalLeaderboard(socket.name || 'Guest', socket.pixelScore, socket.guestId);
            io.emit('leaderboard', globalLeaderboard);
            io.emit('team_scores', teamScores); // V7: Team Score

            // Sync score back to client immediately
            socket.emit('pixel_score', socket.pixelScore);

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
            // Binary Batch: Sequence of [X(2), Y(2), R(1), G(1), B(1), Team(1)]
            const bufList = [];
            for (const p of pixels) {
                const tid = p.t || 0;
                const b = Buffer.alloc(8);
                b.writeUInt16LE(p.x, 0);
                b.writeUInt16LE(p.y, 2);
                b.writeUInt8(p.r, 4);
                b.writeUInt8(p.g, 5);
                b.writeUInt8(p.b, 6);
                b.writeUInt8(tid, 7);
                bufList.push(b);

                if (TEAMS[tid]) {
                    teamScores[TEAMS[tid]]++;
                }

                // --- History Buffer for Batch ---
                if (socket.dbSessionId) {
                    const hex = "#" + ((1 << 24) + (p.r << 16) + (p.g << 8) + p.b).toString(16).slice(1);
                    strokeBuffer.push({
                        x: p.x, y: p.y, color: hex,
                        team: TEAMS[tid],
                        sessionId: socket.dbSessionId
                    });
                }
            }
            // Auto flush if too big after batch
            if (strokeBuffer.length >= STROKE_BATCH_LIMIT) {
                flushStrokes();
            }
            const finalBuf = Buffer.concat(bufList);
            socket.broadcast.emit('batch_pixels', finalBuf);

            if (syncPub) {
                const b64List = bufList.map(b => b.toString('base64'));
                syncPub.publish('board_sync', JSON.stringify({ t: 'b', d: b64List }));
            }

            saveTeamScores(); // Save after batch update

            if (!socket.pixelScore) socket.pixelScore = 0;
            socket.pixelScore += pixelCount;

            // Queue for Sync
            if (supabase && socket.guestId) {
                dirtyScores.set(socket.guestId, {
                    id: socket.guestId,
                    name: socket.name || 'Guest',
                    score: socket.pixelScore,
                    team: TEAMS[(pixels[0].t || 0)] || 'none'
                });
            } else {
                broadcastLeaderboardLegacy();
            }

            // Real-time Update
            updateGlobalLeaderboard(socket.name || 'Guest', socket.pixelScore, socket.guestId);
            io.emit('leaderboard', globalLeaderboard);
            io.emit('team_scores', teamScores); // V7: Broadcast Team Scores

            // Sync score back to client immediately
            socket.emit('pixel_score', socket.pixelScore);

            updateInk(socket);
        }
    });

    // V7: Auth Handling (Join)
    socket.on('auth', (token) => {
        if (!token || !supabase) return;

        supabase.auth.getUser(token).then(async ({ data, error }) => {
            if (!error && data.user) {
                const state = getInkState(socket);
                if (!state.isUser) {
                    state.isUser = true;
                    state.ink = USER_MAX;
                    state.ink = Math.max(state.ink, USER_MAX);
                }

                // Link Session to User FIRST
                if (socket.dbSessionId) {
                    const { error: linkError } = await supabase.from('sessions')
                        .update({ user_id: data.user.id })
                        .eq('id', socket.dbSessionId);

                    if (linkError) console.error('Error linking session to user:', linkError.message);
                    else console.log(`Session ${socket.dbSessionId} linked to User ${data.user.id}`);
                }

                // THEN emit success
                socket.emit('auth_success', {
                    id: data.user.id,
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

    // --- Overlays ---
    socket.on('place_overlay', (data) => {
        // data: { url, x, y, scale, owner }
        if (!data || !data.url) return;

        const newOverlay = {
            id: `ov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            url: data.url,
            x: data.x || 0,
            y: data.y || 0,
            scale: data.scale || 1,
            owner: data.owner || 'Anon',
            createdAt: Date.now()
        };

        activeOverlays.push(newOverlay);
        if (activeOverlays.length > 20) activeOverlays.shift(); // Limit 20

        io.emit('update_overlays', activeOverlays);

        const sysMsg = { id: 'SYSTEM', text: `New Overlay placed by ${newOverlay.owner}`, name: 'System' };
        io.emit('chat', sysMsg);
    });

    socket.on('update_overlay', (data) => {
        // data: { id, x, y, scale }
        const ov = activeOverlays.find(o => o.id === data.id);
        if (ov) {
            ov.x = data.x;
            ov.y = data.y;
            ov.scale = data.scale;
            io.emit('update_overlays', activeOverlays);
        }
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
            // Rate Limit Check
            const lastChat = chatRateLimit.get(socket.id) || 0;
            const now = Date.now();
            if (now - lastChat < CHAT_COOLDOWN) {
                // Rate limited (silently ignore or warn)
                return;
            }
            chatRateLimit.set(socket.id, now);

            const text = msg.text.substring(0, MAX_MSG_LENGTH);

            // ADMIN TOOLS (Secret Command)
            if (text.startsWith('/clear admin123') || text === '/clear_overlays') {
                console.log('Clearing Overlays/Board');
                if (text === '/clear_overlays') {
                    activeOverlays = [];
                    io.emit('update_overlays', activeOverlays);
                    io.emit('chat', { id: 'SYSTEM', text: 'Overlays cleared.', name: 'System' });
                    return;
                }

                board.fill(255);
                needsSave = true;
                io.emit('init', board); // Reload everyone
                activeOverlays = []; // Clear overlays too
                io.emit('update_overlays', activeOverlays);

                const sysMsg = { id: 'SYSTEM', text: '⚠️ BOARD CLEARED BY ADMIN ⚠️', name: 'System' };
                chatHistory.push(sysMsg);
                if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
                io.emit('chat', sysMsg);
                return;
            }

            // Admin: /rmoverlay [id]
            if (text.startsWith('/rmoverlay')) {
                const parts = text.split(' ');
                if (parts[1]) {
                    activeOverlays = activeOverlays.filter(o => o.id !== parts[1]);
                    io.emit('update_overlays', activeOverlays);
                }
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
