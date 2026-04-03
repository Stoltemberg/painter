/**
 * Protected Zones Service — CRUD for zone protection on the board.
 * Extracted from server.js for modularity.
 */
const fs = require('fs');
const path = require('path');

const ZONES_FILE = path.join(__dirname, '..', 'zones.json');

let protectedZones = [];

/**
 * Load zones from local file.
 */
function loadZones() {
    if (fs.existsSync(ZONES_FILE)) {
        try {
            protectedZones = JSON.parse(fs.readFileSync(ZONES_FILE, 'utf8'));
            console.log(`Loaded ${protectedZones.length} protected zones.`);
        } catch (err) {
            console.warn('Zones parse error:', err.message);
            protectedZones = [];
        }
    }
}

/**
 * Save zones to local file.
 */
function saveZones() {
    try {
        fs.writeFileSync(ZONES_FILE, JSON.stringify(protectedZones, null, 2));
    } catch (err) {
        console.error('Zones save error:', err.message);
    }
}

/**
 * Check if a coordinate is inside any protected zone.
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function isProtected(x, y) {
    for (const zone of protectedZones) {
        if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h) {
            return true;
        }
    }
    return false;
}

/**
 * Add a new protected zone.
 * @param {object} zone - { x, y, w, h, label }
 */
function addZone(zone) {
    protectedZones.push(zone);
    saveZones();
}

/**
 * Remove a protected zone by index.
 * @param {number} index
 * @returns {boolean} Whether the zone was removed
 */
function removeZone(index) {
    if (index >= 0 && index < protectedZones.length) {
        protectedZones.splice(index, 1);
        saveZones();
        return true;
    }
    return false;
}

/**
 * Register admin zone API routes.
 * @param {import('express').Application} app
 * @param {Function} basicAuth - Auth middleware
 */
function registerZoneRoutes(app, basicAuth) {
    app.get('/api/zones', basicAuth, (req, res) => {
        res.json(protectedZones);
    });

    app.post('/api/zones', basicAuth, express.json(), (req, res) => {
        const { x, y, w, h, label } = req.body;
        if (x == null || y == null || w == null || h == null) {
            return res.status(400).json({ error: 'Missing x, y, w, h' });
        }
        addZone({ x: Number(x), y: Number(y), w: Number(w), h: Number(h), label: label || '' });
        res.json({ ok: true, zones: protectedZones });
    });

    app.delete('/api/zones/:index', basicAuth, (req, res) => {
        const idx = parseInt(req.params.index);
        if (removeZone(idx)) {
            res.json({ ok: true, zones: protectedZones });
        } else {
            res.status(404).json({ error: 'Zone not found' });
        }
    });
}

// Need express for json() middleware in routes
const express = require('express');

module.exports = {
    get zones() { return protectedZones; },
    loadZones,
    saveZones,
    isProtected,
    addZone,
    removeZone,
    registerZoneRoutes,
};
