const socket = io();

// DOM Elements
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapViewport = document.getElementById('minimap-viewport');
const colorPicker = document.getElementById('colorPicker');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeLabel = document.getElementById('brushSizeLabel');
const eraserBtn = document.getElementById('eraserBtn');
const statusDiv = document.getElementById('status');
const resetBtn = document.getElementById('resetView');
const coordsDiv = document.getElementById('coords');
const onlineCountDiv = document.getElementById('onlineCount');

// State
let boardSize = 3000;
let scale = 0.5;
let offsetX = boardSize / 2 - window.innerWidth / 2;
let offsetY = boardSize / 2 - window.innerHeight / 2;
let isDragging = false;
let isPainting = false;
let lastX = 0;
let lastY = 0;
let currentMode = 'brush'; // 'brush' or 'eraser'
let brushSize = 1;

// Offscreen buffer
const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d', { alpha: false });
bufferCanvas.width = boardSize;
bufferCanvas.height = boardSize;
// Fill white initially
bufferCtx.fillStyle = '#ffffff';
bufferCtx.fillRect(0, 0, boardSize, boardSize);

// --- Inputs ---
if (brushSizeInput) {
    brushSizeInput.addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
        if (brushSizeLabel) brushSizeLabel.textContent = `${brushSize}px`;
    });
}

if (eraserBtn) {
    eraserBtn.addEventListener('click', () => {
        currentMode = 'eraser';
        canvas.style.cursor = 'cell';
        // Optional: Highlight active tool
        eraserBtn.style.border = '2px solid #4ade80';
    });
}

if (colorPicker) {
    colorPicker.addEventListener('click', () => {
        currentMode = 'brush';
        canvas.style.cursor = 'crosshair';
        eraserBtn.style.border = '1px solid #555';
    });
    // Also reset if color changes
    colorPicker.addEventListener('input', () => {
        currentMode = 'brush';
        canvas.style.cursor = 'crosshair';
        eraserBtn.style.border = '1px solid #555';
    });
}

// --- Resize Handling ---
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
    updateMinimapViewport();
}
window.addEventListener('resize', resize);
resize();

// --- Rendering ---
function draw() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-offsetX * scale, -offsetY * scale);
    ctx.scale(scale, scale);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bufferCanvas, 0, 0);

    if (scale > 15) {
        const vx = Math.max(0, offsetX);
        const vy = Math.max(0, offsetY);
        const vw = canvas.width / scale;
        const vh = canvas.height / scale;
        drawGrid(ctx, vx, vy, vw, vh);
    }

    ctx.restore();
}

function drawGrid(ctx, vx, vy, vw, vh) {
    ctx.beginPath();
    ctx.lineWidth = 0.5 / scale;
    ctx.strokeStyle = '#ddd';

    const startX = Math.floor(vx);
    const startY = Math.floor(vy);
    const endX = Math.min(boardSize, startX + vw + 1);
    const endY = Math.min(boardSize, startY + vh + 1);

    for (let x = startX; x <= endX; x++) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
    for (let y = startY; y <= endY; y++) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
    ctx.stroke();
}

// --- Minimap Logic ---
function updateMinimap() {
    minimapCanvas.width = 150;
    minimapCanvas.height = 150;
    minimapCtx.drawImage(bufferCanvas, 0, 0, minimapCanvas.width, minimapCanvas.height);
}

function updateMinimapViewport() {
    const vpW = (canvas.width / scale) / boardSize * 150;
    const vpH = (canvas.height / scale) / boardSize * 150;
    const vpX = (offsetX / boardSize) * 150;
    const vpY = (offsetY / boardSize) * 150;

    minimapViewport.style.width = `${vpW}px`;
    minimapViewport.style.height = `${vpH}px`;
    minimapViewport.style.transform = `translate(${vpX}px, ${vpY}px)`;
}

// --- Interaction Math ---
function screenToWorld(sx, sy) {
    const worldX = sx / scale + offsetX;
    const worldY = sy / scale + offsetY;
    return { x: Math.floor(worldX), y: Math.floor(worldY) };
}

// --- Mouse Events ---
canvas.addEventListener('mousedown', e => {
    if (e.button === 0) {
        isPainting = true;
        paint(e.clientX, e.clientY);
    } else if (e.button === 1 || e.button === 2) {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }
});

canvas.addEventListener('mousemove', e => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    if (coordsDiv) coordsDiv.textContent = `X: ${x}, Y: ${y}`;

    if (isPainting) {
        paint(e.clientX, e.clientY);
    }
    if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;

        offsetX -= dx / scale;
        offsetY -= dy / scale;

        lastX = e.clientX;
        lastY = e.clientY;
        draw();
        updateMinimapViewport();
    }
});

const endInput = () => {
    isPainting = false;
    isDragging = false;
    canvas.style.cursor = currentMode === 'eraser' ? 'cell' : 'crosshair';
};
canvas.addEventListener('mouseup', endInput);
canvas.addEventListener('mouseleave', endInput);

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    const nextScale = scale * (1 + delta);

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const wx = mx / scale + offsetX;
    const wy = my / scale + offsetY;

    if (nextScale < 0.05) return;
    if (nextScale > 50) return;
    scale = nextScale;

    offsetX = wx - mx / scale;
    offsetY = wy - my / scale;

    draw();
    updateMinimapViewport();
}, { passive: false });

canvas.addEventListener('contextmenu', e => e.preventDefault());

if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        scale = 0.5;
        offsetX = boardSize / 2 - window.innerWidth / 2;
        offsetY = boardSize / 2 - window.innerHeight / 2;
        draw();
        updateMinimapViewport();
    });
}

// --- Painting ---
function paint(clientX, clientY) {
    const { x, y } = screenToWorld(clientX, clientY);
    if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
        let r, g, b;

        if (currentMode === 'eraser') {
            r = 255; g = 255; b = 255;
        } else {
            const hex = colorPicker.value;
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
        }

        const size = brushSize || 1;
        drawPixel(x, y, r, g, b, size);
        socket.emit('pixel', { x, y, r, g, b, size });
    }
}

function drawPixel(x, y, r, g, b, size) {
    // Fill rect on buffer
    bufferCtx.fillStyle = `rgb(${r},${g},${b})`;
    // Center brush
    const half = Math.floor(size / 2);
    bufferCtx.fillRect(x - half, y - half, size, size);

    draw();

    // Minimap - Debounce or simplified update
    minimapCtx.fillStyle = `rgb(${r},${g},${b})`;
    const mx = Math.floor(x / boardSize * 150);
    const my = Math.floor(y / boardSize * 150);
    // Draw slightly bigger on minimap if size is large
    // Scale size:
    const mSize = Math.max(1, (size / boardSize) * 150);
    minimapCtx.fillRect(mx - mSize / 2, my - mSize / 2, mSize, mSize);
}

// --- Socket ---
socket.on('connect', () => {
    if (statusDiv) {
        statusDiv.textContent = 'Connected';
        statusDiv.style.color = '#4ade80';
    }
});

socket.on('disconnect', () => {
    if (statusDiv) {
        statusDiv.textContent = 'Reconnecting...';
        statusDiv.style.color = '#f87171';
    }
});

socket.on('init', (buffer) => {
    if (statusDiv) statusDiv.textContent = 'Decanting pixels...';

    const uint8 = new Uint8Array(buffer);
    const imgData = bufferCtx.createImageData(boardSize, boardSize);
    const d = imgData.data;

    for (let i = 0; i < boardSize * boardSize; i++) {
        d[i * 4] = uint8[i * 3];
        d[i * 4 + 1] = uint8[i * 3 + 1];
        d[i * 4 + 2] = uint8[i * 3 + 2];
        d[i * 4 + 3] = 255;
    }

    bufferCtx.putImageData(imgData, 0, 0);
    draw();
    updateMinimap();
    if (statusDiv) statusDiv.textContent = 'Online';
});

socket.on('pixel', (data) => {
    drawPixel(data.x, data.y, data.r, data.g, data.b, data.size || 1);
});

socket.on('online_count', (count) => {
    if (onlineCountDiv) onlineCountDiv.textContent = `● ${count} Online`;
});
