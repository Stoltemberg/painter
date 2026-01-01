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

// Load board logic
const initBoard = async () => {
    // 1. Try local file first (fastest)
    if (fs.existsSync(BOARD_FILE)) {
        try {
            console.log('Loading board from local file...');
            const data = fs.readFileSync(BOARD_FILE);
            if (data.length === BUFFER_SIZE) {
                board = data;
                console.log('Local board loaded.');
                return;
            } else {
                console.log('Local board size mismatch, ignoring.');
            }
        } catch (err) {
            console.error('Error loading local board:', err);
        }
    }

    // 2. If no local, try Supabase (if configured)
    if (supabase) {
        try {
            console.log('Checking Supabase for board.dat...');
            const { data, error } = await supabase
                .storage
                .from('pixel-board')
                .download('board.dat');

            if (error) {
                console.log('Supabase download error (might be first run):', error.message);
            } else if (data) {
                // data is a Blob or Buffer? In Node.js environment usually Blob or ArrayBuffer.
                // supabase-js in Node returns a Blob by default or we need to await .arrayBuffer()
                const arrayBuffer = await data.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                if (buffer.length === BUFFER_SIZE) {
                    board = buffer;
                    console.log('Board loaded from Supabase!');
                    // Save locally to cache
                    fs.writeFileSync(BOARD_FILE, board);
                } else {
                    console.log('Supabase board size mismatch.');
                }
            }
        } catch (err) {
            console.error('Error with Supabase init:', err);
        }
    }
};

// Run init
initBoard();

app.use(express.static('public'));

// Persistence
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
    socket.emit('init', board);

    socket.on('pixel', (data) => {
        const { x, y, r, g, b } = data;
        if (x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT) {
            const index = (y * BOARD_WIDTH + x) * 3;
            // Diff check
            if (board[index] !== r || board[index + 1] !== g || board[index + 2] !== b) {
                board[index] = r;
                board[index + 1] = g;
                board[index + 2] = b;
                needsSave = true;
                socket.broadcast.emit('pixel', { x, y, r, g, b });
            }
        }
    });

    socket.on('disconnect', () => {
        io.emit('online_count', io.engine.clientsCount);
    });
});

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
