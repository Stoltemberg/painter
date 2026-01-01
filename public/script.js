const socket = io();

// DOM Elements
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapViewport = document.getElementById('minimap-viewport');
const colorPicker = document.getElementById('colorPicker');
const statusDiv = document.getElementById('status');
const resetBtn = document.getElementById('resetView');
const coordsDiv = document.getElementById('coords');
const onlineCountDiv = document.getElementById('onlineCount');

// State
let boardSize = 3000;
let scale = 0.5; // Start zoomed out a bit
let offsetX = boardSize / 2 - window.innerWidth / 2; // Center view initially
let offsetY = boardSize / 2 - window.innerHeight / 2;
let isDragging = false;
let isPainting = false;
let lastX = 0;
let lastY = 0;

// Offscreen buffer
const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d', { alpha: false }); // Optimization
bufferCanvas.width = boardSize;
bufferCanvas.height = boardSize;
// Fill white initially
bufferCtx.fillStyle = '#ffffff';
bufferCtx.fillRect(0, 0, boardSize, boardSize);

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
    // 1. Clear Screen
    // ctx.clearRect(0, 0, canvas.width, canvas.height); // Not strictly needed if we cover everything

    // Background (if looking out of bounds)
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Apply Transform:
    // We want (offsetX, offsetY) in the world to be at (0,0) on screen? No.
    // Let's define offset as Top-Left of the Viewport in World Coordinates.

    // transform(scale, 0, 0, scale, -offsetX * scale, -offsetY * scale)
    ctx.translate(-offsetX * scale, -offsetY * scale);
    ctx.scale(scale, scale);

    // Filter Optimization: Nearest Neighbor for pixel art look
    ctx.imageSmoothingEnabled = false;

    // Draw only visible part of buffer?
    // Optimization: drawImage with src/dst rects
    // Viewport in world:
    const vx = Math.max(0, offsetX);
    const vy = Math.max(0, offsetY);
    const vw = canvas.width / scale;
    const vh = canvas.height / scale;

    // We can just draw the whole thing if optimization is tricky, but let's try clipping
    // The browser usually handles offscreen clipping well.
    ctx.drawImage(bufferCanvas, 0, 0);

    // Grid Lines (if zoomed in)
    if (scale > 15) {
        drawGrid(ctx, vx, vy, vw, vh);
    }

    ctx.restore();
}

function drawGrid(ctx, vx, vy, vw, vh) {
    ctx.beginPath();
    ctx.lineWidth = 0.5 / scale; // Constant visual width
    ctx.strokeStyle = '#ddd';

    const startX = Math.floor(vx);
    const startY = Math.floor(vy);
    const endX = Math.min(boardSize, startX + vw + 1);
    const endY = Math.min(boardSize, startY + vh + 1);

    for (let x = startX; x <= endX; x++) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y++) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
    }
    ctx.stroke();
}

// --- Minimap Logic ---
function updateMinimap() {
    // Rescale buffer to minimap
    // Minimap size is 150x150 for 3000x3000 board -> 1:20 ratio
    minimapCanvas.width = 150;
    minimapCanvas.height = 150;

    // Draw buffer to minimap (cheap resize)
    minimapCtx.drawImage(bufferCanvas, 0, 0, minimapCanvas.width, minimapCanvas.height);
}

function updateMinimapViewport() {
    // Viewport size relative to board size
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

// --- Inputs ---
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
    // Update Coords
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    coordsDiv.textContent = `X: ${x}, Y: ${y}`;

    if (isPainting) {
        paint(e.clientX, e.clientY);
    }
    if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;

        offsetX -= dx / scale;
        offsetY -= dy / scale;

        // Clamp offset ??
        // Let's allow panning outside a bit

        lastX = e.clientX;
        lastY = e.clientY;
        draw();
        updateMinimapViewport();
    }
});

const endInput = () => {
    isPainting = false;
    isDragging = false;
    canvas.style.cursor = 'crosshair';
};
canvas.addEventListener('mouseup', endInput);
canvas.addEventListener('mouseleave', endInput);

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const delta = e.deltaY > 0 ? -zoomIntensity : zoomIntensity;
    const nextScale = scale * (1 + delta);

    // Zoom towards mouse
    // mouseWorld = mouseScreen / scale + offset
    // newOffset = mouseWorld - mouseScreen / newScale

    // 1. Get world pos of cursor
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const wx = mx / scale + offsetX;
    const wy = my / scale + offsetY;

    // 2. Set new scale
    if (nextScale < 0.05) return; // limit min zoom
    if (nextScale > 50) return; // limit max zoom
    scale = nextScale;

    // 3. Recalculate offset to keep wx, wy at mX, mY
    offsetX = wx - mx / scale;
    offsetY = wy - my / scale;

    draw();
    updateMinimapViewport();
}, { passive: false });

// Prevent context menu
canvas.addEventListener('contextmenu', e => e.preventDefault());

resetBtn.addEventListener('click', () => {
    scale = 0.5;
    offsetX = boardSize / 2 - window.innerWidth / 2;
    offsetY = boardSize / 2 - window.innerHeight / 2;
    draw();
    updateMinimapViewport();
});

// --- Painting ---
function paint(clientX, clientY) {
    const { x, y } = screenToWorld(clientX, clientY);
    if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
        const hex = colorPicker.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        drawPixel(x, y, r, g, b);
        socket.emit('pixel', { x, y, r, g, b });
    }
}

function drawPixel(x, y, r, g, b) {
    // Fill 1x1 rect on buffer
    bufferCtx.fillStyle = `rgb(${r},${g},${b})`;
    bufferCtx.fillRect(x, y, 1, 1);

    // Optimization: don't redraw full screen every pixel?
    // For now, simple redraw is safe.
    draw();

    // Update minimap occasionally? 
    // Updating every pixel is expensive on minimap resize.
    // Let's debounce or update small rect?
    // For MVP, update minimap every pixel is visually nice but maybe heavy.
    // Let's do it:
    minimapCtx.fillStyle = `rgb(${r},${g},${b})`;
    // Scale coords to minimap
    const mx = Math.floor(x / boardSize * 150);
    const my = Math.floor(y / boardSize * 150);
    minimapCtx.fillRect(mx, my, 1, 1);
}

// --- Socket ---
socket.on('connect', () => {
    statusDiv.textContent = 'Connected';
    statusDiv.style.color = '#4ade80';
});

socket.on('disconnect', () => {
    statusDiv.textContent = 'Reconnecting...';
    statusDiv.style.color = '#f87171';
});

socket.on('init', (buffer) => {
    // buffer is ArrayBuffer
    statusDiv.textContent = 'Decanting pixels...';

    const uint8 = new Uint8Array(buffer);
    // Create ImageData
    const imgData = bufferCtx.createImageData(boardSize, boardSize);
    const d = imgData.data;

    // Convert R,G,B (buffer) to R,G,B,A (imageData)
    // Buffer index: i * 3
    // Image index: i * 4
    for (let i = 0; i < boardSize * boardSize; i++) {
        d[i * 4] = uint8[i * 3];
        d[i * 4 + 1] = uint8[i * 3 + 1];
        d[i * 4 + 2] = uint8[i * 3 + 2];
        d[i * 4 + 3] = 255; // Alpha
    }

    bufferCtx.putImageData(imgData, 0, 0);
    draw();
    updateMinimap();
    statusDiv.textContent = 'Online';
});

socket.on('pixel', (data) => {
    // {x, y, r, g, b}
    drawPixel(data.x, data.y, data.r, data.g, data.b);
});

socket.on('online_count', (count) => {
    onlineCountDiv.textContent = `● ${count} Online`;
});
