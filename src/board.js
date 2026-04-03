/**
 * Board Service — Manages the pixel board buffer, persistence, and compression.
 * Extracted from server.js for modularity.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BOARD_WIDTH = 3000;
const BOARD_HEIGHT = 3000;
const BUFFER_SIZE = BOARD_WIDTH * BOARD_HEIGHT * 3;
const BOARD_FILE = path.join(__dirname, '..', 'board.dat');
const CHUNK_LINES = 50;

let board = Buffer.alloc(BUFFER_SIZE);
board.fill(255); // White default

// Compression cache
let cachedCompressedBoard = null;
let lastCompressionTime = 0;
const COMPRESSION_TTL = 1000;

let needsSave = false;
let lastSave = 0;
const LAZY_SAVE_INTERVAL = 2 * 60 * 1000; // 2 minutes

/**
 * Load and validate a board buffer.
 * @param {Buffer} buffer - Raw board data
 * @returns {boolean} Whether the buffer was loaded successfully
 */
function loadAndMigrate(buffer) {
    const len = buffer.length;
    if (len === BUFFER_SIZE) {
        board = buffer;
        return true;
    }
    console.log(`Board size mismatch: expected ${BUFFER_SIZE}, got ${len}`);
    return false;
}

/**
 * Initialize the board from cloud (Supabase) or local file.
 * @param {object|null} supabase - Supabase client
 */
async function initBoard(supabase) {
    let loadedFromCloud = false;

    // 1. Try cloud
    if (supabase) {
        try {
            const { data, error } = await supabase.storage
                .from('pixel-board')
                .download('board.dat');

            if (data && !error) {
                const buffer = Buffer.from(await data.arrayBuffer());
                if (loadAndMigrate(buffer)) {
                    console.log(`Board loaded from Supabase (${buffer.length} bytes).`);
                    loadedFromCloud = true;
                    // Sync to local
                    fs.writeFileSync(BOARD_FILE, board);
                }
            } else if (error) {
                console.warn('Supabase board load error:', error.message);
            }
        } catch (err) {
            console.error('Supabase board download failed:', err.message);
        }
    }

    // 2. Fallback to local
    if (!loadedFromCloud && fs.existsSync(BOARD_FILE)) {
        try {
            const buffer = fs.readFileSync(BOARD_FILE);
            if (loadAndMigrate(buffer)) {
                console.log(`Board loaded from local file (${buffer.length} bytes).`);
            }
        } catch (err) {
            console.error('Local board load error:', err.message);
        }
    }

    if (!loadedFromCloud && !fs.existsSync(BOARD_FILE)) {
        console.log('No existing board found. Starting fresh (white).');
    }
}

/**
 * Save board to local file and optionally to Supabase.
 * @param {object|null} supabase - Supabase client
 */
async function saveBoard(supabase) {
    if (!needsSave) return;

    try {
        fs.writeFileSync(BOARD_FILE, board);
        console.log('Board saved locally.');
    } catch (err) {
        console.error('Local save error:', err.message);
    }

    if (supabase) {
        try {
            const blob = new Blob([board], { type: 'application/octet-stream' });
            const { error } = await supabase.storage
                .from('pixel-board')
                .upload('board.dat', blob, { upsert: true });
            if (error) {
                console.error('Cloud save error:', error.message);
            } else {
                console.log('Board saved to cloud.');
            }
        } catch (err) {
            console.error('Cloud save failed:', err.message);
        }
    }

    needsSave = false;
    lastSave = Date.now();
}

/**
 * Get compressed board data (cached with TTL).
 * @returns {Buffer} Gzipped board data
 */
function getCompressedBoard() {
    const now = Date.now();
    if (cachedCompressedBoard && (now - lastCompressionTime < COMPRESSION_TTL)) {
        return cachedCompressedBoard;
    }
    cachedCompressedBoard = zlib.gzipSync(board);
    lastCompressionTime = now;
    return cachedCompressedBoard;
}

/**
 * Set a pixel on the board.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {boolean} Whether the pixel was actually changed
 */
function setPixel(x, y, r, g, b) {
    const index = (y * BOARD_WIDTH + x) * 3;
    if (board[index] !== r || board[index + 1] !== g || board[index + 2] !== b) {
        board[index] = r;
        board[index + 1] = g;
        board[index + 2] = b;
        needsSave = true;
        return true;
    }
    return false;
}

/**
 * Send board data to a socket in chunks.
 * @param {object} socket - Socket.IO socket
 */
function sendBoardChunks(socket) {
    const totalChunks = Math.ceil(BOARD_HEIGHT / CHUNK_LINES);
    let i = 0;

    const sendNext = () => {
        if (i >= totalChunks) return;

        const y = i * CHUNK_LINES;
        const height = Math.min(CHUNK_LINES, BOARD_HEIGHT - y);
        const start = y * BOARD_WIDTH * 3;
        const end = start + height * BOARD_WIDTH * 3;
        const chunk = board.slice(start, end);

        socket.emit('board_chunk', {
            y,
            height,
            data: chunk,
            progress: (i + 1) / totalChunks
        });

        i++;
        setImmediate(sendNext);
    };

    socket.emit('board_info', { width: BOARD_WIDTH, height: BOARD_HEIGHT });
    sendNext();
}

module.exports = {
    BOARD_WIDTH,
    BOARD_HEIGHT,
    BUFFER_SIZE,
    CHUNK_LINES,
    LAZY_SAVE_INTERVAL,
    board: () => board,
    get needsSave() { return needsSave; },
    set needsSave(v) { needsSave = v; },
    get lastSave() { return lastSave; },
    initBoard,
    saveBoard,
    getCompressedBoard,
    setPixel,
    sendBoardChunks,
    loadAndMigrate,
};
