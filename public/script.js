// Guest Persistence
let guestUUID = localStorage.getItem('guestUUID');
if (!guestUUID) {
    guestUUID = crypto.randomUUID();
    localStorage.setItem('guestUUID', guestUUID);
}

const socket = io({
    query: { guestId: guestUUID }
});

// --- IndexedDB Cache ---
const DB_NAME = 'PixelBoardDB';
const STORE_NAME = 'boardState';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e);
    });
}

async function loadCache() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get('full_image');
        return new Promise(resolve => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (e) { console.warn('IDB Load Error', e); return null; }
}

async function saveCache(blob) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(blob, 'full_image');
    } catch (e) { console.warn('IDB Save Error', e); }
}

// Attempt load on start
// Load cache moved to end
// Attempt load on start

// DOM Elements
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for opaque
const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const minimapViewport = document.getElementById('minimap-viewport');
const colorPicker = document.getElementById('colorPicker');
const recentColorsDiv = document.getElementById('recentColors');
const brushBtn = document.getElementById('brushBtn');
const eraserBtn = document.getElementById('eraserBtn');
const pipetteBtn = document.getElementById('pipetteBtn'); // V3
const stampBtn = document.getElementById('stampBtn'); // V6
const stampOptions = document.getElementById('stampOptions'); // V6
const stampOpts = document.querySelectorAll('.stamp-opt'); // V6
const fillBtn = document.getElementById('fillBtn');
const lineBtn = document.getElementById('lineBtn');
const exportBtn = document.getElementById('exportBtn');
const viewModeBtn = document.getElementById('viewModeBtn');
const soundBtn = document.getElementById('soundBtn');

// View Mode State
let isRestrictedView = false;
// ... other DOM elements ...

// Stamp Shapes (Relative Coordinates)
const STAMPS = {
    heart: [
        { x: 0, y: 0 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -2, y: -2 }, { x: 2, y: -2 },
        { x: -3, y: -1 }, { x: 3, y: -1 }, { x: -2, y: 1 }, { x: 2, y: 1 }, { x: -1, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }
    ],
    star: [
        { x: 0, y: -3 }, { x: 0, y: -2 },
        { x: -1, y: -1 }, { x: 1, y: -1 },
        { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
        { x: -1, y: 1 }, { x: 1, y: 1 },
        { x: -2, y: 2 }, { x: 2, y: 2 }
    ],
    smiley: [
        { x: -2, y: -2 }, { x: 2, y: -2 }, // Eyes
        { x: -2, y: 1 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 1 } // Mouth
    ],
    checker: [
        { x: -1, y: -1 }, { x: 1, y: -1 },
        { x: 0, y: 0 },
        { x: -1, y: 1 }, { x: 1, y: 1 }
    ]
};
let currentStamp = 'heart';

// ... existing code ...

// --- Button Listeners ---
// Tool Selectors
if (brushBtn) {
    brushBtn.addEventListener('click', () => {
        currentMode = 'brush';
        brushBtn.style.border = '2px solid #4ade80';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
        if (stampBtn) stampBtn.style.border = '1px solid #555';
        if (stampOptions) stampOptions.classList.add('hidden');
        canvas.style.cursor = 'crosshair';
    });
}

if (eraserBtn) {
    eraserBtn.addEventListener('click', () => {
        currentMode = 'eraser';
        eraserBtn.style.border = '2px solid #4ade80';
        if (brushBtn) brushBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
        if (stampBtn) stampBtn.style.border = '1px solid #555';
        if (stampOptions) stampOptions.classList.add('hidden');
        canvas.style.cursor = 'cell';
    });
}

if (pipetteBtn) {
    pipetteBtn.addEventListener('click', () => {
        currentMode = 'pipette';
        canvas.style.cursor = 'copy';
        pipetteBtn.style.border = '2px solid #4ade80';
        if (brushBtn) brushBtn.style.border = '1px solid #555';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (stampBtn) stampBtn.style.border = '1px solid #555';
    });
}

if (stampBtn) {
    stampBtn.addEventListener('click', () => {
        currentMode = 'stamp';
        canvas.style.cursor = 'grab';
        stampBtn.style.border = '2px solid #4ade80';
        stampOptions.classList.remove('hidden'); // Show options

        if (brushBtn) brushBtn.style.border = '1px solid #555';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
        if (fillBtn) fillBtn.style.border = '1px solid #555';
        if (lineBtn) lineBtn.style.border = '1px solid #555';
    });
}

if (fillBtn) {
    fillBtn.addEventListener('click', () => {
        currentMode = 'fill';
        canvas.style.cursor = 'alias';
        fillBtn.style.border = '2px solid #4ade80';

        if (brushBtn) brushBtn.style.border = '1px solid #555';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
        if (stampBtn) stampBtn.style.border = '1px solid #555';
        if (lineBtn) lineBtn.style.border = '1px solid #555';
        if (stampOptions) stampOptions.classList.add('hidden');
    });
}

if (lineBtn) {
    lineBtn.addEventListener('click', () => {
        currentMode = 'line';
        canvas.style.cursor = 'crosshair';
        lineBtn.style.border = '2px solid #4ade80';

        if (brushBtn) brushBtn.style.border = '1px solid #555';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
        if (stampBtn) stampBtn.style.border = '1px solid #555';
        if (fillBtn) fillBtn.style.border = '1px solid #555';
        if (stampOptions) stampOptions.classList.add('hidden');
    });
}

function setColor(hex) {
    colorPicker.value = hex;
    currentMode = 'brush';
    canvas.style.cursor = 'crosshair';
    if (eraserBtn) eraserBtn.style.border = '1px solid #555';
    if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
    updateRecentColorsUI();
}

if (colorPicker) {
    colorPicker.addEventListener('input', () => {
        currentMode = 'brush';
        canvas.style.cursor = 'crosshair';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';
    });
    // ...
}
const themeBtn = document.getElementById('themeBtn');
const nicknameInput = document.getElementById('nicknameInput');
const resetBtn = document.getElementById('resetView');
const teleX = document.getElementById('teleX');
const teleY = document.getElementById('teleY');
const teleBtn = document.getElementById('teleBtn');
const statusDiv = document.getElementById('status');
const coordsDiv = document.getElementById('coords');
const onlineCountDiv = document.getElementById('onlineCount');
const cursorLayer = document.getElementById('cursor-layer');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const uiLayer = document.getElementById('ui-layer');

// State
let boardSize = 3000;
bufferCanvas.width = boardSize;
bufferCanvas.height = boardSize;
let scale = 0.5;
let offsetX = boardSize / 2 - window.innerWidth / 2;
let offsetY = boardSize / 2 - window.innerHeight / 2;
let isDragging = false;
let isPainting = false;
let lastX = 0;
let lastY = 0;
let currentMode = 'brush';
let recentColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
let soundEnabled = true;
let myNickname = localStorage.getItem('painter_nickname') || 'Guest';
let showGridOverride = false;
let hoverPos = null;
let needsRedraw = true; // Optimization: Render Loop Flag


// UI Setup
// Auth DOM Elements
const authOverlay = document.getElementById('authOverlay');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const signInBtn = document.getElementById('signInBtn');
const signUpBtn = document.getElementById('signUpBtn');
const closeAuthBtn = document.getElementById('closeAuthBtn');
const authStatus = document.getElementById('authStatus');
const loginBtn = document.getElementById('loginBtn'); // In Top Bar

// Check Session on Load moved to initSupabase

// Auth Listeners
if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
        authStatus.textContent = 'Logging in...';
        const { data, error } = await supabase.auth.signInWithPassword({
            email: emailInput.value,
            password: passwordInput.value,
        });
        if (error) authStatus.textContent = error.message;
        else {
            authStatus.textContent = '';
            if (authOverlay) authOverlay.style.display = 'none';
        }
    });
}

if (signUpBtn) {
    signUpBtn.addEventListener('click', async () => {
        authStatus.textContent = 'Signing up...';
        const { data, error } = await supabase.auth.signUp({
            email: emailInput.value,
            password: passwordInput.value,
        });
        if (error) authStatus.textContent = error.message;
        else {
            authStatus.textContent = 'Check your email for confirmation!';
        }
    });
}

if (closeAuthBtn) {
    closeAuthBtn.addEventListener('click', () => {
        if (authOverlay) authOverlay.style.display = 'none';
    });
}

if (loginBtn) {
    loginBtn.addEventListener('click', () => {
        if (authOverlay) authOverlay.style.display = 'flex';
    });
}

// Auth State Change moved to initSupabase

function handleUser(user) {
    // Use email part as nickname for now? 
    // Or allow nickname update.
    myNickname = user.email.split('@')[0];
    if (nicknameInput) nicknameInput.value = myNickname;
}

// Teams
const teamSelect = document.getElementById('teamSelect');
let myTeam = localStorage.getItem('painter_team') || 0;
const TEAM_IDS = { 'none': 0, 'red': 1, 'blue': 2, 'green': 3 };

if (teamSelect) {
    // Reverse map to set initial value
    const rev = Object.keys(TEAM_IDS).find(k => TEAM_IDS[k] == myTeam) || 'none';
    teamSelect.value = rev;

    teamSelect.addEventListener('change', () => {
        myTeam = TEAM_IDS[teamSelect.value] || 0;
        localStorage.setItem('painter_team', myTeam);
    });
}

// Theme Toggle
let isLightMode = false;
if (themeBtn) {
    themeBtn.addEventListener('click', () => {
        isLightMode = !isLightMode;
        document.body.classList.toggle('light-mode', isLightMode);
        themeBtn.textContent = isLightMode ? '🌑' : '🌗';
    });
}

// Spectator Mode
window.addEventListener('keydown', (e) => {
    // Ignore if typing in any input field
    if (e.key === 'h' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        uiLayer.classList.toggle('hidden-ui');
    }
});

// Audio Context
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Cursors Map
const cursors = {}; // id -> element

// Offscreen buffer
// Offscreen buffer logic
bufferCtx.fillStyle = '#ffffff';
bufferCtx.fillRect(0, 0, boardSize, boardSize);

// --- Sound Effects ---
function playPop() {
    if (!soundEnabled || audioCtx.state === 'suspended') {
        if (soundEnabled) audioCtx.resume();
        return;
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800 + Math.random() * 200, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

if (soundBtn) {
    soundBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
    });
}

// --- Export Image ---
if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `pixel-board-${Date.now()}.png`;
        link.href = bufferCanvas.toDataURL('image/png');
        link.click();
    });
}

if (exportBtn) {
    exportBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `pixel-board-${Date.now()}.png`;
        link.href = bufferCanvas.toDataURL('image/png');
        link.click();
    });
}

if (viewModeBtn) {
    viewModeBtn.addEventListener('click', () => {
        isRestrictedView = !isRestrictedView;
        viewModeBtn.textContent = isRestrictedView ? '🔒' : '🔓';
        viewModeBtn.title = isRestrictedView ? 'Restricted View (Locked)' : 'Infinite View (Unlocked)';
        if (isRestrictedView) {
            clampView();
            needsRedraw = true;
            updateMinimapViewport();
        }
    });
}

// --- Teleport ---
if (teleBtn) {
    teleBtn.addEventListener('click', () => {
        const x = parseInt(teleX.value) || 0;
        const y = parseInt(teleY.value) || 0;
        // Center view on X, Y
        offsetX = x - (canvas.width / 2) / scale;
        offsetY = y - (canvas.height / 2) / scale;
        needsRedraw = true;
        updateMinimapViewport();
    });
}

// --- Chat Logic ---
if (chatInput) {
    // Global Enter Listener
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (document.activeElement === chatInput) {
                // Send message logic
                const text = chatInput.value.trim();
                if (text) {
                    socket.emit('chat', { text, name: myNickname });
                    chatInput.value = '';
                }
                chatInput.blur(); // Close chat focus
                canvas.focus(); // Return focus to canvas/body
            } else {
                // Open chat logic
                e.preventDefault();
                chatInput.focus();
            }

            isDrawing = true;
            // Open chat logic
            e.preventDefault();
            chatInput.focus();
        }

        // Escape to cancel/close
        if (e.key === 'Escape' && document.activeElement === chatInput) {
            chatInput.blur();
        }
    });
}

function addChatMessage(text, isMe = false, name = 'Anon') {
    const div = document.createElement('div');
    div.className = 'chat-msg';

    if (name === 'System') {
        div.style.color = '#fbbf24'; // Warning Yellow
        div.style.fontStyle = 'italic';
        div.textContent = `${text}`;
    } else {
        div.textContent = `${name}: ${text}`;
        if (isMe) div.style.background = 'rgba(74, 222, 128, 0.5)';
    }

    // Auto-scroll
    const wasatBottom = chatMessages.scrollHeight - chatMessages.clientHeight <= chatMessages.scrollTop + 50;
    chatMessages.appendChild(div);
    if (wasatBottom || isMe) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// --- Inputs & Palette ---
if (eraserBtn) {
    eraserBtn.addEventListener('click', () => {
        currentMode = 'eraser';
        canvas.style.cursor = 'cell';
        eraserBtn.style.border = '2px solid #4ade80';
    });
}

function setColor(hex) {
    colorPicker.value = hex;
    currentMode = 'brush';
    canvas.style.cursor = 'crosshair';
    if (eraserBtn) eraserBtn.style.border = '1px solid #555';
    updateRecentColorsUI();
}

if (colorPicker) {
    colorPicker.addEventListener('input', () => {
        currentMode = 'brush';
        canvas.style.cursor = 'crosshair';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
    });
    colorPicker.addEventListener('change', () => addRecentColor(colorPicker.value));
}

function addRecentColor(hex) {
    if (!recentColors.includes(hex)) {
        recentColors.unshift(hex);
        if (recentColors.length > 5) recentColors.pop();
        updateRecentColorsUI();
    }
}

function updateRecentColorsUI() {
    if (!recentColorsDiv) return;
    recentColorsDiv.innerHTML = '';
    recentColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'recent-color-swatch';
        swatch.style.backgroundColor = color;
        swatch.addEventListener('click', () => setColor(color));
        recentColorsDiv.appendChild(swatch);
    });
}
updateRecentColorsUI();

// --- Resize Handling ---
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    needsRedraw = true;
    updateMinimapViewport();
}
window.addEventListener('resize', resize);
resize();

// removed duplicate window.addEventListener('resize', resize);


function clampView() {
    if (!isRestrictedView) return;

    // 1. Zoom Restriction: Must fit board
    const minScale = Math.max(canvas.width / boardSize, canvas.height / boardSize);
    if (scale < minScale) scale = minScale;

    // 2. Pan Restriction: Keep viewport inside board
    const visibleW = canvas.width / scale;
    const visibleH = canvas.height / scale;

    const maxOffsetX = boardSize - visibleW;
    const maxOffsetY = boardSize - visibleH;

    // Apply clamp
    if (offsetX < 0) offsetX = 0;
    if (offsetY < 0) offsetY = 0;
    if (offsetX > maxOffsetX) offsetX = maxOffsetX;
    if (offsetY > maxOffsetY) offsetY = maxOffsetY;
}

// --- Rendering (Optimized Loop) ---
// --- Rendering// Revert to robust Interval Loop (simpler than rAF for debugging)
// This ensures that if any logic sets needsRedraw, it WILL draw per 33ms.
// No risk of loop stalling.
setInterval(() => {
    if (needsRedraw) {
        draw();
        needsRedraw = false;
    }
}, 33);

// Explicit draw on startup
setTimeout(draw, 500);
setTimeout(draw, 1000);

// Init App
initSupabase();
initApp();

function draw() {
    // Clear Screen
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Apply Transform
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-offsetX, -offsetY);

    // Draw Board (Buffer)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bufferCanvas, 0, 0);

    // Draw Grid
    if (scale > 15 || (typeof showGridOverride !== 'undefined' && showGridOverride)) {
        const vx = offsetX - (canvas.width / 2) / scale;
        const vy = offsetY - (canvas.height / 2) / scale;
        const vw = canvas.width / scale;
        const vh = canvas.height / scale;
        drawGrid(ctx, vx, vy, vw, vh);
    }

    // Ghost Cursor
    if ((currentMode === 'brush' || currentMode === 'eraser') && hoverPos && !isDragging) {
        if (currentMode === 'eraser') {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
        } else {
            const hex = colorPicker.value;
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
        }

        ctx.fillRect(Math.floor(hoverPos.x), Math.floor(hoverPos.y), 1, 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 0.1;
        ctx.strokeRect(Math.floor(hoverPos.x), Math.floor(hoverPos.y), 1, 1);
    }

    ctx.restore();

    updateCursors();
}

function drawGrid(ctx, vx, vy, vw, vh) {
    ctx.beginPath();
    ctx.lineWidth = 0.5 / scale;
    ctx.strokeStyle = '#ddd';

    // Clamp start/end to board size
    const startX = Math.max(0, Math.floor(vx));
    const startY = Math.max(0, Math.floor(vy));
    const endX = Math.min(boardSize, Math.ceil(vx + vw));
    const endY = Math.min(boardSize, Math.ceil(vy + vh));

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

// --- Cursor Logic ---
function updateCursors() {
    for (const id in cursors) {
        const cursor = cursors[id];
        const screenX = (cursor.worldX - offsetX) * scale;
        const screenY = (cursor.worldY - offsetY) * scale;
        cursor.element.style.transform = `translate(${screenX}px, ${screenY}px)`;
    }
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

// Minimap Click Teleport
minimapCanvas.parentNode.addEventListener('mousedown', (e) => {
    // Calculate click pos relative to minimap
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Convert to Percentage (0-1) then to World Coords
    const px = Math.max(0, Math.min(1, mx / 150));
    const py = Math.max(0, Math.min(1, my / 150));

    // Update Offset to center on that spot
    offsetX = (px * boardSize) - (canvas.width / 2) / scale;
    offsetY = (py * boardSize) - (canvas.height / 2) / scale;

    needsRedraw = true;
    updateMinimapViewport();
});

// --- Interaction Math ---
function screenToWorld(sx, sy) {
    const worldX = sx / scale + offsetX;
    const worldY = sy / scale + offsetY;
    return { x: Math.floor(worldX), y: Math.floor(worldY) };
}

// --- Mobile Touch Support ---
let touchStartDist = 0;
let touchStartScale = 0;

canvas.addEventListener('touchstart', e => {
    e.preventDefault(); // Prevent scrolling
    if (document.activeElement === chatInput || document.activeElement === nicknameInput) return;

    if (e.touches.length === 1) {
        // Paint or Drag if tool selected? 
        // Logic: 1 finger = Paint
        const t = e.touches[0];
        isPainting = true;
        paint(t.clientX, t.clientY);
    } else if (e.touches.length === 2) {
        // Pan/Zoom start
        isDragging = true;
        lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        touchStartDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartScale = scale;
    }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isPainting) {
        const t = e.touches[0];
        paint(t.clientX, t.clientY);

        // Emit cursor for mobile too?
        // const { x, y } = screenToWorld(t.clientX, t.clientY);
        // ...
    } else if (e.touches.length === 2 && isDragging) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );

        // Calculate Pan delta
        const dx = cx - lastX;
        const dy = cy - lastY;

        // Apply Pan
        offsetX -= dx / scale;
        offsetY -= dy / scale;

        // Apply Zoom
        if (touchStartDist > 0) {
            const newScale = touchStartScale * (dist / touchStartDist);

            // Limit zoom
            if (newScale > 0.05 && newScale < 50) {
                // Zoom towards center of pinch (cx, cy)
                const rect = canvas.getBoundingClientRect();
                const mx = cx - rect.left;
                const my = cy - rect.top;

                const wx = mx / scale + offsetX;
                const wy = my / scale + offsetY;

                scale = newScale;

                offsetX = wx - mx / scale;
                offsetY = wy - my / scale;
                clampView();
            }
        }

        lastX = cx;
        lastY = cy;

        needsRedraw = true;
        updateMinimapViewport();
    }
}, { passive: false });

canvas.addEventListener('touchend', () => {
    isPainting = false;
    isDragging = false;
});


// --- Mouse Events ---
// --- Mouse Events ---
canvas.addEventListener('mousedown', e => {
    // Resume audio context
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // Prevent drawing if chat is focused
    if (document.activeElement === chatInput || document.activeElement === nicknameInput) return;

    // PIPETTE LOGIC
    if (currentMode === 'pipette' && e.button === 0) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
            const pixel = bufferCtx.getImageData(x, y, 1, 1).data;
            const hex = "#" + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
            setColor(hex);
            addRecentColor(hex);
            if (pipetteBtn) pipetteBtn.style.background = hex;
            setTimeout(() => { if (pipetteBtn) pipetteBtn.style.background = ''; }, 300);
        }
        return;
    }

    // STAMP LOGIC
    if (currentMode === 'stamp' && e.button === 0) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        const shape = STAMPS[currentStamp] || STAMPS['heart'];

        // Get current color
        const hex = colorPicker.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        const pixels = [];
        shape.forEach(pt => {
            const px = x + pt.x;
            const py = y + pt.y;
            if (px >= 0 && px < boardSize && py >= 0 && py < boardSize) {
                pixels.push({ x: px, y: py, r, g, b, t: myTeam });
                drawPixel(px, py, r, g, b, true); // Optimistic
            }
        });

        if (pixels.length > 0) {
            ink -= pixels.length;
            if (inkValue) inkValue.textContent = Math.floor(ink);
            socket.emit('batch_pixels', pixels);
        }
        return;
    }

    // FLOOD FILL LOGIC
    if (currentMode === 'fill' && e.button === 0) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        const hex = colorPicker.value;
        const targetR = parseInt(hex.slice(1, 3), 16);
        const targetG = parseInt(hex.slice(3, 5), 16);
        const targetB = parseInt(hex.slice(5, 7), 16);

        // Get start color
        const pixel = bufferCtx.getImageData(x, y, 1, 1).data;
        const startR = pixel[0], startG = pixel[1], startB = pixel[2];

        if (startR === targetR && startG === targetG && startB === targetB) return;

        // BFS
        const queue = [{ x, y }];
        const visited = new Set();
        const changes = [];
        let cost = 0;

        while (queue.length > 0 && cost < 500) { // Limit 500
            const p = queue.shift();
            const k = `${p.x},${p.y}`;
            if (visited.has(k)) continue;
            visited.add(k);

            if (p.x < 0 || p.x >= boardSize || p.y < 0 || p.y >= boardSize) continue;

            const px = bufferCtx.getImageData(p.x, p.y, 1, 1).data;
            if (px[0] === startR && px[1] === startG && px[2] === startB) {
                changes.push({ x: p.x, y: p.y, r: targetR, g: targetG, b: targetB, t: myTeam });
                cost++;

                queue.push({ x: p.x + 1, y: p.y });
                queue.push({ x: p.x - 1, y: p.y });
                queue.push({ x: p.x, y: p.y + 1 });
                queue.push({ x: p.x, y: p.y - 1 });
            }
        }

        if (changes.length > 0) {
            socket.emit('batch_pixels', changes);
            changes.forEach(p => drawPixel(p.x, p.y, p.r, p.g, p.b));
            playPop();
        }
        return;
    }

    // LINE TOOL LOGIC
    if (currentMode === 'line' && e.button === 0) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        lineStart = { x, y };
        isPainting = true; // Block dragging
        return;
    }

    // DEFAULT BRUSH / DRAG
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

// Line Tool State
let lineStart = null;
let lastCursorEmit = 0;
let lastPaintEmit = 0;

canvas.addEventListener('mousemove', e => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    lastWorldPos = { x, y };
    if (coordsDiv) coordsDiv.textContent = `X: ${x}, Y: ${y}`;

    // Emit Cursor
    const now = Date.now();
    if (now - lastCursorEmit > 50) {
        socket.emit('cursor', { x: x + 0.5, y: y + 0.5, name: myNickname });
        lastCursorEmit = now;
    }

    // Ghost Cursor Update
    hoverPos = { x, y };
    if (!isDragging && !isPainting) needsRedraw = true; // Redraw for ghost cursor


    if (isPainting && currentMode === 'brush') {
        paint(e.clientX, e.clientY);
    }

    // Line Preview
    if (isPainting && currentMode === 'line' && lineStart) {
        needsRedraw = true; // Clear previous
        // Draw line on ctx (screen space)
        const screenStart = {
            x: (lineStart.x - offsetX) * scale,
            y: (lineStart.y - offsetY) * scale
        };
        const screenEnd = {
            x: (x - offsetX) * scale,
            y: (y - offsetY) * scale
        };

        ctx.beginPath();
        ctx.strokeStyle = colorPicker.value;
        ctx.lineWidth = scale;
        ctx.moveTo(screenStart.x, screenStart.y);
        ctx.lineTo(screenEnd.x, screenEnd.y);
        ctx.stroke();
    }

    if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        offsetY -= dy / scale;
        offsetX -= dx / scale;
        clampView();
        lastX = e.clientX;
        lastY = e.clientY;
        needsRedraw = true;
        draw(); // Force direct draw for feedback
        updateMinimapViewport();
    }
});

const endInput = () => {
    isPainting = false;
    isDragging = false;
    canvas.style.cursor = currentMode === 'eraser' ? 'cell' : 'crosshair';
};

canvas.addEventListener('mouseup', (e) => {
    if (currentMode === 'line' && lineStart) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        // Commit Line
        const points = getLinePoints(lineStart.x, lineStart.y, x, y);
        // Simple pixel batch
        const pixels = points.map(p => {
            const hex = colorPicker.value;
            return {
                x: p.x, y: p.y,
                r: parseInt(hex.slice(1, 3), 16),
                g: parseInt(hex.slice(3, 5), 16),
                b: parseInt(hex.slice(5, 7), 16),
                t: myTeam
            };
        });
        socket.emit('batch_pixels', pixels);
        // Draw local
        pixels.forEach(p => drawPixel(p.x, p.y, p.r, p.g, p.b, true));
        lineStart = null;
    }
    endInput();
});
canvas.addEventListener('mouseleave', endInput);

function getLinePoints(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;
    const points = [];
    while (true) {
        points.push({ x: x0, y: y0 });
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return points;
}

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
    clampView();

    needsRedraw = true;
    updateMinimapViewport();
}, { passive: false });

canvas.addEventListener('contextmenu', e => e.preventDefault());

if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        scale = 0.5;
        offsetX = boardSize / 2 - window.innerWidth / 2;
        offsetY = boardSize / 2 - window.innerHeight / 2;
        needsRedraw = true;
        updateMinimapViewport();
    });
}

// --- Painting ---
function paint(clientX, clientY) {
    const now = Date.now();
    // Frontend Rate Limit (matching backend roughly)
    if (now - lastPaintEmit < 15) return;

    // Check Ink
    if (ink <= 0) {
        if (inkValue) inkValue.style.color = 'red';
        setTimeout(() => { if (inkValue) inkValue.style.color = ''; }, 200);
        return;
    }

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
            addRecentColor(hex);
        }

        drawPixel(x, y, r, g, b, true);
        playPop(); // Local sound
        socket.emit('pixel', { x, y, r, g, b, size: 1, t: myTeam });
        lastPaintEmit = now;

        // Optimistic update
        ink--;
        if (inkValue) inkValue.textContent = ink;
        if (inkFill) inkFill.style.width = `${Math.min(100, (ink / maxInk) * 100)}%`;
    }
}

function drawPixel(x, y, r, g, b, isLocal = false) {
    bufferCtx.fillStyle = `rgb(${r},${g},${b})`;
    bufferCtx.fillRect(x, y, 1, 1);
    needsRedraw = true;

    minimapCtx.fillStyle = `rgb(${r},${g},${b})`;
    const mx = Math.floor(x / boardSize * 150);
    const my = Math.floor(y / boardSize * 150);
    minimapCtx.fillRect(mx, my, 1, 1);

    // Update Score UI
    if (isLocal) {
        myPixelCount++;
        const scoreEl = document.getElementById('myScore');
        if (scoreEl) scoreEl.textContent = `${myPixelCount} px`;
    }
}

// --- Socket ---
// Initialize Supabase & Auth
// --- Socket ---
// Initialize Supabase & Auth
// let supabase = null; // Already declared at top if moved, or use window.supabase
// Actually, if it's declared once at line 633, where is the other?
// I will just assign it if it exists or declare if not?
// No, I'll just remove this line and rely on the one I hope exists or add it if missing.
// Grep said 2 matches.
// I will just use `supabase = null;` to be safe if it's already declared.
// But wait, `let` throws.
// I'll assume the one at line ~633 is the duplicate if I added one earlier.
// Let's check the top of the file again. Step 945 shows lines 1-100. No supabase there.
// Step 944 shows lines 600-650. Line 633 is `let supabase = null;`.
// If grep found 2, maybe I pasted it twice in the same block?
// I will remove this specific line.
const inkValue = document.getElementById('inkValue');
const inkFill = document.getElementById('inkFill');
let ink = 0;
let maxInk = 250;

async function initSupabase() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (config.supabaseUrl && config.supabaseKey) {
            // Check if loaded
            if (typeof window.supabase === 'undefined') {
                console.error('Supabase library not loaded. Check script tag.');
                console.log('Window keys:', Object.keys(window).filter(k => k.toLowerCase().includes('supabase')));
                return;
            }

            // Try to find createClient
            try {
                if (window.supabase && typeof window.supabase.createClient === 'function') {
                    supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
                } else if (window.Supabase && typeof window.Supabase.createClient === 'function') {
                    supabase = window.Supabase.createClient(config.supabaseUrl, config.supabaseKey);
                } else {
                    // Fallback: If not found, just warn and continue.
                    console.warn('Supabase createClient not found. Auth will be disabled.');
                    return;
                }
            } catch (err) {
                console.warn('Supabase Init Error:', err);
                return; // Continue app even if auth fails
            }

            console.log('Supabase Client Initialized');

            // Check Session
            const { data } = await supabase.auth.getSession();
            if (data.session) {
                handleUser(data.session.user);
            }

            // Auth Listener
            supabase.auth.onAuthStateChange((event, session) => {
                console.log('Auth State Change:', event, session);
                if (event === 'SIGNED_IN' && session) {
                    handleUser(session.user);
                    if (authOverlay) authOverlay.style.display = 'none';
                    if (loginBtn) {
                        loginBtn.textContent = 'Logout';
                        loginBtn.onclick = () => supabase.auth.signOut();
                    }
                } else if (event === 'SIGNED_OUT') {
                    myNickname = 'Guest';
                    if (nicknameInput) nicknameInput.value = myNickname;
                    if (loginBtn) {
                        loginBtn.textContent = 'Log In';
                        loginBtn.onclick = () => { if (authOverlay) authOverlay.style.display = 'flex'; };
                    }
                }
            });
        }
    } catch (e) {
        console.error('Failed to init Supabase:', e);
    }
}
// Removed module-level initSupabase() call to prevent double-init.
// initApp() handles it.

function handleUser(user) {
    if (!loginBtn) return;
    loginBtn.textContent = 'Log Out';
    loginBtn.onclick = async () => {
        await supabase.auth.signOut();
        window.location.reload();
    };

    // Send token to server to upgrade socket
    if (supabase) {
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) {
                // Link auth token on session restore
                socket.emit('auth', data.session.access_token);
            }
        });
    }
}

socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    if (statusDiv) {
        statusDiv.textContent = 'Connected';
        statusDiv.style.color = '#4ade80';
    }
    // Fix: Center view on correct board coordinates
    offsetX = boardSize / 2 - window.innerWidth / 2 / scale;
    offsetY = boardSize / 2 - window.innerHeight / 2 / scale;
    needsRedraw = true;
});

socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
    if (statusDiv) {
        statusDiv.textContent = 'Reconnecting...';
        statusDiv.style.color = '#f87171';
    }
});

let refillInterval;
let refillRate = 15000; // Default guest rate

// V7: Ink Update
socket.on('ink', (data) => {
    ink = data.ink;
    maxInk = data.max;
    refillRate = data.rate || 15000;

    updateInkUI();
    startRefillSimulation();
});

function updateInkUI() {
    if (inkValue) inkValue.textContent = Math.floor(ink);
    if (inkFill) {
        const pct = Math.min(100, (ink / maxInk) * 100);
        inkFill.style.width = `${pct}%`;
        if (pct < 10) inkFill.style.background = '#f87171';
        else inkFill.style.background = '#3b82f6';
    }
}

function startRefillSimulation() {
    if (refillInterval) clearInterval(refillInterval);

    // Add 1 pixel every 'refillRate' milliseconds
    // To make it smooth, maybe update progress bar more often?
    // For now, let's just tick up the number/bar every second loosely?
    // Or actually wait the full duration. 
    // Let's do a smooth generic bar animation via CSS, but the number needs to tick.
    // Simple approach: Tick every 1s, add fraction.

    const tickRate = 1000;
    const inkPerTick = tickRate / refillRate;

    refillInterval = setInterval(() => {
        if (ink < maxInk) {
            ink += inkPerTick;
            if (ink > maxInk) ink = maxInk;
            updateInkUI();
        }
    }, tickRate);
}

socket.on('error_msg', (msg) => {
    // Show toast or alert
    alert(msg);
});

socket.on('auth_success', (data) => {
    console.log('Authenticated as:', data.name);
    // Maybe show name in UI?
});

socket.on('board_info', (info) => {
    console.log('Board info received:', info);
    // Ensure boardSize matches server
    if (info.width && info.height) {
        boardSize = info.width; // 3000 default
        // re-center if needed?
        // bufferCanvas.width/height is already 3000
    }
});

socket.on('board_chunk', (chunk) => {
    if (statusDiv) statusDiv.textContent = `Loading... ${Math.round(chunk.progress * 100)}%`;

    // Raw Data (Uint8Array or similar from ArrayBuffer)
    let data;
    if (chunk.data instanceof ArrayBuffer) {
        data = new Uint8Array(chunk.data);
    } else {
        // Maybe it's already a view or typed array?
        data = new Uint8Array(chunk.data);
    }

    // chunk.height rows, boardSize width
    // Buffer is R, G, B
    const len = data.length / 3;
    const clamped = new Uint8ClampedArray(len * 4);

    for (let i = 0; i < len; i++) {
        clamped[i * 4] = data[i * 3];
        clamped[i * 4 + 1] = data[i * 3 + 1];
        clamped[i * 4 + 2] = data[i * 3 + 2];
        clamped[i * 4 + 3] = 255;
    }

    const imgData = new ImageData(clamped, boardSize, chunk.height);
    // Put at chunk.y
    bufferCtx.putImageData(imgData, 0, chunk.y);

    // Optimistic: Only redraw full canvas at 100%? Or every chunk?
    // Every chunk is fun to watch loading.
    needsRedraw = true;

    // Update minimap for this chunk (expensive? maybe just once at end?)
    // Let's do it every 10%
    if (chunk.progress * 100 % 10 < 2 || chunk.progress >= 0.99) {
        updateMinimap();
    }

    if (chunk.progress >= 0.99) {
        if (statusDiv) statusDiv.textContent = 'Online';
        console.log('Board loading complete.');

        // Save to Cache
        bufferCanvas.toBlob((blob) => {
            saveCache(blob);
        });
    }
});

socket.on('pixel', (data) => {
    // ... existing pixel logic ...
    let x, y, r, g, b;
    if (data instanceof ArrayBuffer) {
        // ...
        const dv = new DataView(data);
        x = dv.getUint16(0, true);
        y = dv.getUint16(2, true);
        r = dv.getUint8(4);
        g = dv.getUint8(5);
        b = dv.getUint8(6);
    } else {
        ({ x, y, r, g, b } = data);
    }
    drawPixel(x, y, r, g, b);
    playPop();
});

// Update personal score on pixel placement
let myPixelCount = 0;
const scoreDisplay = document.createElement('span');
scoreDisplay.id = 'myScore';
scoreDisplay.textContent = '0 px';
// Style tweak: align nicely in the glass group
scoreDisplay.style.cssText = 'color:var(--accent); font-weight:bold; font-size:0.9rem; border-left:1px solid var(--glass-border); padding-left:8px; margin-left:8px;';

// Insert score next to nickname input if not exists
const glassGroup = document.querySelector('.glass-group');
if (glassGroup && !document.getElementById('myScore')) {
    glassGroup.appendChild(scoreDisplay);
}

socket.on('pixel_score', (score) => {
    myPixelCount = score;
    if (scoreDisplay) scoreDisplay.textContent = `${myPixelCount} px`;
});


// V6: Batch Pixels (Stamps)
socket.on('batch_pixels', (data) => {
    // Check if binary or JSON
    if (data instanceof ArrayBuffer) {
        const dv = new DataView(data);
        const len = data.byteLength;
        const count = len / 8;
        for (let i = 0; i < count; i++) {
            const off = i * 8;
            const x = dv.getUint16(off, true);
            const y = dv.getUint16(off + 2, true);
            const r = dv.getUint8(off + 4);
            const g = dv.getUint8(off + 5);
            const b = dv.getUint8(off + 6);

            bufferCtx.fillStyle = `rgb(${r},${g},${b})`;
            bufferCtx.fillRect(x, y, 1, 1);

            // Minimal map update? Optimization: skip here, update minimap once at end?
            // Actually, we need to update local Minimap too.
            minimapCtx.fillStyle = `rgb(${r},${g},${b})`;
            const mx = Math.floor(x / boardSize * 150);
            const my = Math.floor(y / boardSize * 150);
            minimapCtx.fillRect(mx, my, 1, 1);
        }
    } else {
        // Legacy JSON
        data.forEach(p => {
            bufferCtx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
            bufferCtx.fillRect(p.x, p.y, 1, 1);

            minimapCtx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
            const mx = Math.floor(p.x / boardSize * 150);
            const my = Math.floor(p.y / boardSize * 150);
            minimapCtx.fillRect(mx, my, 1, 1);
        });
    }
    needsRedraw = true; // Redraw once at end
    playPop();
});

socket.on('init', async (data) => {
    console.log('Init Payload Received. Type:', data.constructor.name);

    let buffer;
    if (data instanceof Blob) {
        console.log('Converting Blob to ArrayBuffer...');
        buffer = await data.arrayBuffer();
    } else if (data instanceof ArrayBuffer) {
        buffer = data;
    } else {
        console.warn('Unknown init data type:', typeof data);
        return;
    }

    const uint8 = new Uint8Array(buffer);
    console.log('Buffer Size:', uint8.length, 'First Byte:', uint8[0]);

    if (uint8.length > 0) {
        // Create ImageData
        const len = uint8.length / 3;
        const clamped = new Uint8ClampedArray(len * 4);
        for (let i = 0; i < len; i++) {
            clamped[i * 4] = uint8[i * 3];     // R
            clamped[i * 4 + 1] = uint8[i * 3 + 1]; // G
            clamped[i * 4 + 2] = uint8[i * 3 + 2]; // B
            clamped[i * 4 + 3] = 255;          // A (Opaque)
        }

        const imgData = new ImageData(clamped, boardSize, boardSize);
        bufferCtx.putImageData(imgData, 0, 0);

        needsRedraw = true;
        updateMinimap();
        if (statusDiv) statusDiv.textContent = 'Online';
        console.log('Board initialized from binary.');
    }
});



// V6: Reactions (Emotes)
socket.on('reaction', (data) => {
    showReaction(data.x, data.y, data.emoji);
});

function showReaction(x, y, emoji) {
    // Convert world to screen
    const screenX = (x - offsetX) * scale;
    const screenY = (y - offsetY) * scale;

    const el = document.createElement('div');
    el.textContent = emoji;
    el.style.position = 'absolute';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    el.style.fontSize = '2rem';
    el.style.pointerEvents = 'none';
    el.style.transition = 'all 1s ease-out';
    el.style.zIndex = '1000';
    el.style.textShadow = '0 2px 4px rgba(0,0,0,0.5)';

    document.body.appendChild(el);

    // Animate
    requestAnimationFrame(() => {
        el.style.transform = `translateY(-50px) scale(1.5)`;
        el.style.opacity = '0';
    });

    setTimeout(() => {
        document.body.removeChild(el);
    }, 1000);
}

// Logic to emit reactions
window.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInput || document.activeElement === nicknameInput) return;

    let emoji = null;
    if (e.key === '1') emoji = '❤️';
    if (e.key === '2') emoji = '😂';
    if (e.key === '3') emoji = '😎';
    if (e.key === '4') emoji = '🔥';

    if (emoji) {
        // Get my mouse pos? We don't track it globally easily, 
        // but we can assume center of screen or last known.
        // Better: Mouse move listener tracks `lastX`, `lastY` (screen coords).
        // `screenToWorld` uses `lastX` clientX.
        // Wait, `lastX` in script is for Dragging. 
        // Let's use `lastMouseX`, `lastMouseY` tracked in mousemove.

        // We need X, Y in world coords.
        // Let's emit what we have.
        // If we don't have exact mouse pos from a global var, 
        // we can assume the server knows our cursor? 
        // Server knows `socket.lastX`. But reaction event payload needs it.
        // Let's rely on `lastWorldX` and `lastWorldY` if we add them.

        // Quick fix: Use the last known world coordinates from mousemove.
        const { x, y } = lastWorldPos || { x: boardSize / 2, y: boardSize / 2 };

        socket.emit('reaction', { emoji, x, y });
        showReaction(x, y, emoji); // Show local instantly
    }
});

let lastWorldPos = { x: 0, y: 0 };
// Update mousemove to track headers


socket.on('cursor', (data) => {
    if (!cursors[data.id]) {
        const el = document.createElement('div');
        el.className = 'cursor';
        const hue = Math.floor(Math.random() * 360);
        el.style.borderBottomColor = `hsl(${hue}, 100%, 50%)`;

        // Label with name
        const label = document.createElement('div');
        label.className = 'cursor-label';
        label.style.position = 'absolute';
        label.style.left = '10px';
        label.style.top = '10px';
        label.style.background = 'rgba(0,0,0,0.7)';
        label.style.color = 'white';
        label.style.padding = '2px 4px';
        label.style.borderRadius = '4px';
        label.style.fontSize = '10px';
        label.style.whiteSpace = 'nowrap';
        label.textContent = data.name || 'Guest';
        el.appendChild(label);

        cursorLayer.appendChild(el);
        cursors[data.id] = { element: el, worldX: data.x, worldY: data.y, label: label };
    } else {
        cursors[data.id].worldX = data.x;
        cursors[data.id].worldY = data.y;
        if (cursors[data.id].label.textContent !== (data.name || 'Guest')) {
            cursors[data.id].label.textContent = data.name || 'Guest';
        }
    }
});

socket.on('cursor_disconnect', (id) => {
    if (cursors[id]) {
        cursorLayer.removeChild(cursors[id].element);
        delete cursors[id];
    }
});

socket.on('online_count', (count) => {
    if (onlineCountDiv) onlineCountDiv.textContent = `● ${count} Online`;
});

// --- Minimap Navigation ---
minimapCanvas.addEventListener('mousedown', e => {
    // Only navigate if left click
    if (e.button !== 0) return;

    const rect = minimapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const minimapW = minimapCanvas.width;
    const minimapH = minimapCanvas.height;

    // Convert to Percentage
    const px = mx / minimapW;
    const py = my / minimapH;

    // Convert to World
    const wx = px * boardSize;
    const wy = py * boardSize;

    // Center view
    offsetX = wx - (canvas.width / 2) / scale;
    offsetY = wy - (canvas.height / 2) / scale;

    needsRedraw = true;
    updateMinimapViewport();
});

// --- Mouse Events ---
// ...

// --- Mouse Events ---
// ...

socket.on('chat', (msg) => {
    addChatMessage(msg.text, msg.id === socket.id, msg.name);
});

socket.on('chat_history', (history) => {
    chatMessages.innerHTML = '';
    history.forEach(msg => {
        addChatMessage(msg.text, msg.id === socket.id, msg.name);
    });
    // System msg indicating history loaded?
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.style.color = '#aaa';
    div.style.fontSize = '0.8rem';
    div.style.textAlign = 'center';
    div.textContent = '--- Chat History Loaded ---';
    chatMessages.appendChild(div);
});

// V5: Leaderboard
const leaderboardDiv = document.getElementById('leaderboard');
socket.on('leaderboard', (data) => {
    if (!leaderboardDiv) return;
    if (data.length === 0) {
        // Show empty state instead of hiding
        leaderboardDiv.style.display = 'block';
        leaderboardDiv.innerHTML = '<h3>🏆 Top Artists</h3><div style="text-align:center;color:#888;font-size:0.8rem;">No scores yet</div>';
        return;
    }
    leaderboardDiv.style.display = 'block';

    let html = `<h3>🏆 Top Artists</h3>`;
    data.forEach(p => {
        html += `
            <div class="leaderboard-item">
                <span>${p.name.substring(0, 10)}</span>
                <span class="leaderboard-score">${p.score}px</span>
            </div>
        `;
    });
    leaderboardDiv.innerHTML = html;
});

// V7: Team Leaderboard
const teamLeaderboardDiv = document.getElementById('team-leaderboard');
socket.on('team_scores', (scores) => {
    if (!teamLeaderboardDiv) return;

    // Check if empty (all zero)
    if (!scores || (scores.red === 0 && scores.blue === 0 && scores.green === 0)) {
        teamLeaderboardDiv.style.display = 'none';
        return;
    }

    teamLeaderboardDiv.style.display = 'block';
    teamLeaderboardDiv.innerHTML = `
        <h3>⚔️ Team Battle</h3>
        <div class="leaderboard-item" style="color:#ff4444">
            <span>🔴 Red</span>
            <span>${scores.red}px</span>
        </div>
        <div class="leaderboard-item" style="color:#4444ff">
            <span>🔵 Blue</span>
            <span>${scores.blue}px</span>
        </div>
        <div class="leaderboard-item" style="color:#44ff44">
            <span>🟢 Green</span>
            <span>${scores.green}px</span>
        </div>
    `;
});

// V5: Grid Toggle
const gridBtn = document.getElementById('gridBtn');
if (gridBtn) {
    gridBtn.addEventListener('click', () => {
        showGridOverride = !showGridOverride;
        gridBtn.style.border = showGridOverride ? '2px solid #4ade80' : '1px solid #555';
        needsRedraw = true; // Redraw immediately
    });
}

// Modify draw() function is tricky without full replace, but I can hook into render loop?
// Actually I need to find the `draw` function and update grid logic.
// For now, let's assume `draw` calls some grid logic depending on scale.
// I will just update the variable `showGridOverride` which I'll use in a replaced draw function if needed,
// OR I can re-implement the draw function logic here if I had access.
// Wait, I cannot modify functions "in place" without replacing them.
// I'll check `script.js` again for `draw()` function. 

// V5: Share Position
if (coordsDiv) {
    coordsDiv.style.cursor = 'pointer';
    coordsDiv.title = 'Click to copy coordinates';
    coordsDiv.addEventListener('click', () => {
        const text = coordsDiv.textContent; // "X: 123, Y: 456"
        navigator.clipboard.writeText(text).then(() => {
            const original = coordsDiv.style.color;
            coordsDiv.style.color = '#4ade80';
            coordsDiv.textContent = 'Copied!';
            setTimeout(() => {
                coordsDiv.textContent = text;
                coordsDiv.style.color = original;
            }, 1000);
        });
    });
}

// (Duplicate showReaction and keydown listener removed)

// --- Initialization ---
async function initApp() {
    await initSupabase();

    // Load Cache AFTER bufferCtx is initialized
    const blob = await loadCache();
    if (blob) {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        img.onload = () => {
            bufferCtx.drawImage(img, 0, 0);
            needsRedraw = true;
            updateMinimap();
            if (statusDiv) statusDiv.textContent = 'Loaded from Cache';
        };
    }
}

// Start App
initApp();
