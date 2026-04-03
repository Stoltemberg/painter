/**
 * Canvas Rendering Utilities
 * Helper functions for drawing operations on the pixel board.
 * 
 * NOTE: This module is designed as a reference for future full modularization.
 * Currently, the main script.js handles rendering inline.
 */

/**
 * Draw a grid overlay on the canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} vx - Viewport X
 * @param {number} vy - Viewport Y
 * @param {number} vw - Viewport width (in world units)
 * @param {number} vh - Viewport height (in world units)
 * @param {number} boardSize - Total board size
 * @param {number} scale - Current zoom scale
 */
export function drawGrid(ctx, vx, vy, vw, vh, boardSize, scale) {
    ctx.beginPath();
    ctx.lineWidth = 0.5 / scale;
    ctx.strokeStyle = '#ddd';

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

/**
 * Bresenham's line algorithm.
 * @param {number} x0 - Start X
 * @param {number} y0 - Start Y
 * @param {number} x1 - End X
 * @param {number} y1 - End Y
 * @returns {{x: number, y: number}[]} Array of points
 */
export function getLinePoints(x0, y0, x1, y1) {
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

/**
 * Convert screen coordinates to world (board) coordinates.
 * @param {number} sx - Screen X
 * @param {number} sy - Screen Y
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} scale - Current zoom
 * @param {number} offsetX - World offset X
 * @param {number} offsetY - World offset Y
 * @returns {{x: number, y: number}}
 */
export function screenToWorld(sx, sy, canvasWidth, canvasHeight, scale, offsetX, offsetY) {
    const x = (sx - canvasWidth / 2) / scale + offsetX;
    const y = (sy - canvasHeight / 2) / scale + offsetY;
    return { x: Math.floor(x), y: Math.floor(y) };
}
