// Guest Persistence
let guestUUID = localStorage.getItem('guestUUID');
if (!guestUUID) {
    guestUUID = crypto.randomUUID();
    localStorage.setItem('guestUUID', guestUUID);
}

const socket = io({
    query: { guestId: guestUUID }
});

// DOM Elements
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for opaque
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
const exportBtn = document.getElementById('exportBtn');
const soundBtn = document.getElementById('soundBtn');
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
        // TEMP: Just a toggle for now, no UI for picking stamps yet
        currentMode = 'stamp';
        canvas.style.cursor = 'grab'; // Placeholder cursor
        stampBtn.style.border = '2px solid #4ade80';

        if (brushBtn) brushBtn.style.border = '1px solid #555';
        if (eraserBtn) eraserBtn.style.border = '1px solid #555';
        if (pipetteBtn) pipetteBtn.style.border = '1px solid #555';

        // alert('Stamp Tool selected! (Logic to select shape implementing...)');
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

// UI Setup
if (nicknameInput) {
    nicknameInput.value = myNickname;
    nicknameInput.addEventListener('change', () => {
        myNickname = nicknameInput.value.substring(0, 15) || 'Guest';
        localStorage.setItem('painter_nickname', myNickname);
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
    if (e.key === 'h' && document.activeElement !== chatInput && document.activeElement !== nicknameInput) {
        uiLayer.classList.toggle('hidden-ui');
    }
});

// Audio Context
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// Cursors Map
const cursors = {}; // id -> element

// Offscreen buffer
const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d', { alpha: false });
bufferCanvas.width = boardSize;
bufferCanvas.height = boardSize;
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

// --- Teleport ---
if (teleBtn) {
    teleBtn.addEventListener('click', () => {
        const x = parseInt(teleX.value) || 0;
        const y = parseInt(teleY.value) || 0;
        // Center view on X, Y
        offsetX = x - (canvas.width / 2) / scale;
        offsetY = y - (canvas.height / 2) / scale;
        draw();
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

    if (scale > 15 || (typeof showGridOverride !== 'undefined' && showGridOverride)) {
        const vx = Math.max(0, offsetX);
        const vy = Math.max(0, offsetY);
        const vw = canvas.width / scale;
        const vh = canvas.height / scale;
        drawGrid(ctx, vx, vy, vw, vh);
    }
    ctx.restore();

    updateCursors();
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

        // Pan
        const dx = cx - lastX;
        const dy = cy - lastY;
        offsetX -= dx / scale;
        offsetY -= dy / scale;
        lastX = cx;
        lastY = cy;

        // Zoom
        if (touchStartDist > 0) {
            const newScale = touchStartScale * (dist / touchStartDist);
            // Limit zoom
            if (newScale > 0.05 && newScale < 50) {
                // To zoom around center (simplified)
                const rect = canvas.getBoundingClientRect();
                const mx = cx - rect.left;
                const my = cy - rect.top;
                const wx = mx / scale + offsetX;
                const wy = my / scale + offsetY;

                scale = newScale;
                offsetX = wx - mx / scale;
                offsetY = wy - my / scale;
            }
        }

        draw();
        updateMinimapViewport();
    }
}, { passive: false });

canvas.addEventListener('touchend', () => {
    isPainting = false;
    isDragging = false;
});


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
            // Quick visual feedback
            if (pipetteBtn) pipetteBtn.style.background = hex;
            setTimeout(() => { if (pipetteBtn) pipetteBtn.style.background = ''; }, 300);
        }
        return;
    }

    // STAMP LOGIC (V6)
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
                pixels.push({ x: px, y: py, r, g, b });
                drawPixel(px, py, r, g, b); // Optimistic
            }
        });

        if (pixels.length > 0) {
            ink -= pixels.length;
            if (inkValue) inkValue.textContent = Math.floor(ink);
            socket.emit('batch_pixels', pixels);
        }
        return;
    }

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

let lastCursorEmit = 0;
let lastPaintEmit = 0;

canvas.addEventListener('mousemove', e => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    lastWorldPos = { x, y }; // Track for Key Reactions
    if (coordsDiv) coordsDiv.textContent = `X: ${x}, Y: ${y}`;

    // Emit Cursor Position
    const now = Date.now();
    if (now - lastCursorEmit > 50) {
        socket.emit('cursor', { x: x + 0.5, y: y + 0.5, name: myNickname });
        lastCursorEmit = now;
    }

    if (isPainting) {
        paint(e.clientX, e.clientY);
    }
    if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        offsetY -= dy / scale;
        offsetX -= dx / scale;
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

        drawPixel(x, y, r, g, b);
        playPop(); // Local sound
        socket.emit('pixel', { x, y, r, g, b, size: 1 });
        lastPaintEmit = now;

        // Optimistic update
        ink--;
        if (inkValue) inkValue.textContent = ink;
        if (inkFill) inkFill.style.width = `${Math.min(100, (ink / maxInk) * 100)}%`;
    }
}

function drawPixel(x, y, r, g, b) {
    bufferCtx.fillStyle = `rgb(${r},${g},${b})`;
    bufferCtx.fillRect(x, y, 1, 1);
    draw();

    minimapCtx.fillStyle = `rgb(${r},${g},${b})`;
    const mx = Math.floor(x / boardSize * 150);
    const my = Math.floor(y / boardSize * 150);
    minimapCtx.fillRect(mx, my, 1, 1);
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
const loginBtn = document.getElementById('loginBtn');
const inkValue = document.getElementById('inkValue');
const inkFill = document.getElementById('inkFill');
let ink = 0;
let maxInk = 250;

async function initSupabase() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (config.supabaseUrl && config.supabaseKey) {
            supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
            console.log('Supabase Client Initialized');

            // Check Session
            const { data } = await supabase.auth.getSession();
            if (data.session) {
                handleUser(data.session.user);
            }

            // Auth Listener
            supabase.auth.onAuthStateChange((event, session) => {
                console.log('Auth State Change:', event, session);
                if (session) handleUser(session.user);
            });
        }
    } catch (e) {
        console.error('Failed to init Supabase:', e);
    }
}
initSupabase();

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
                socket.emit('auth', data.session.access_token);
            }
        });
    }
}

if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        if (loginBtn.textContent === 'Log Out') return;

        const email = prompt('Enter your email to log in (Magic Link):');
        if (email && supabase) {
            const { error } = await supabase.auth.signInWithOtp({ email });
            if (error) alert('Error: ' + error.message);
            else alert('Check your email for the login link!');
        }
    });
}

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
    // Could update boardSize dynamically here if we wanted
});

socket.on('board_chunk', (chunk) => {
    if (statusDiv) statusDiv.textContent = `Loading... ${Math.round(chunk.progress * 100)}%`;

    let data = chunk.data;
    // Decompress
    if (typeof pako !== 'undefined') {
        try {
            data = pako.ungzip(new Uint8Array(chunk.data));
        } catch (e) {
            data = new Uint8Array(chunk.data);
        }
    } else {
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
    draw();

    // Update minimap for this chunk (expensive? maybe just once at end?)
    // Let's do it every 10%
    if (chunk.progress * 100 % 10 < 2 || chunk.progress >= 0.99) {
        updateMinimap();
    }

    if (chunk.progress >= 0.99) {
        if (statusDiv) statusDiv.textContent = 'Online';
        console.log('Board loading complete.');
    }
});

socket.on('pixel', (data) => {
    drawPixel(data.x, data.y, data.r, data.g, data.b);
    playPop(); // Remote sound
});

// V6: Batch Pixels (Stamps)
socket.on('batch_pixels', (pixels) => {
    pixels.forEach(p => {
        // Draw directly to buffer without full redraw (optimization)
        bufferCtx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
        bufferCtx.fillRect(p.x, p.y, 1, 1);

        // Minimap
        minimapCtx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
        const mx = Math.floor(p.x / boardSize * 150);
        const my = Math.floor(p.y / boardSize * 150);
        minimapCtx.fillRect(mx, my, 1, 1);
    });
    draw(); // Redraw once at end
    playPop();
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

    draw();
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
        leaderboardDiv.style.display = 'none';
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

// V5: Grid Toggle
const gridBtn = document.getElementById('gridBtn');
if (gridBtn) {
    gridBtn.addEventListener('click', () => {
        showGridOverride = !showGridOverride;
        gridBtn.style.border = showGridOverride ? '2px solid #4ade80' : '1px solid #555';
        draw(); // Redraw immediately
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

// V6: Cursor Reactions
document.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const keyMap = {
        '1': '❤️',
        '2': '😂',
        '3': '😎',
        '4': '🔥'
    };

    if (keyMap[e.key]) {
        const emoji = keyMap[e.key];
        // Ensure lastWorldPos is defined (track it in mousemove if not already)
        // If undefined, maybe use center of screen or previous logic
        if (typeof lastWorldPos === 'undefined') return;

        socket.emit('reaction', {
            emoji: emoji,
            x: lastWorldPos.x,
            y: lastWorldPos.y
        });
        showReaction({ x: lastWorldPos.x, y: lastWorldPos.y, emoji, id: 'me' });
    }
});

// Helper for reactions
function showReaction(data) {
    const { x, y, emoji, id } = data;
    const div = document.createElement('div');
    div.textContent = emoji;
    div.style.position = 'absolute';
    div.style.left = '0';
    div.style.top = '0';
    div.style.fontSize = '24px';
    div.style.pointerEvents = 'none';
    div.style.zIndex = '1000';

    // Transform world to screen
    const screenX = (x * scale) + offsetX;
    const screenY = (y * scale) + offsetY;
    div.style.transform = `translate(${screenX}px, ${screenY}px)`;
    div.style.transition = 'transform 1s ease-out, opacity 1s ease-out';

    document.body.appendChild(div);

    // Animate
    requestAnimationFrame(() => {
        div.style.transform = `translate(${screenX}px, ${screenY - 50}px)`; // Float up
        div.style.opacity = '0';
    });

    setTimeout(() => {
        div.remove();
    }, 1000);
}
