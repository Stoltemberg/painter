/**
 * Chat Service — Message handling and rate limiting.
 * Extracted from server.js for modularity.
 */

const chatHistory = [];
const MAX_HISTORY = 20;

// Rate limiting
const chatRateLimit = new Map();
const CHAT_COOLDOWN = 1000; // 1 second
const MAX_MSG_LENGTH = 100;

/**
 * Check if a socket can send a chat message (rate limiting).
 * @param {string} socketId
 * @returns {boolean}
 */
function canChat(socketId) {
    const now = Date.now();
    const last = chatRateLimit.get(socketId) || 0;
    if (now - last < CHAT_COOLDOWN) return false;
    chatRateLimit.set(socketId, now);
    return true;
}

/**
 * Add a message to chat history.
 * @param {object} msg - { id, text, name }
 */
function addMessage(msg) {
    chatHistory.push(msg);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
}

/**
 * Get the current chat history.
 * @returns {object[]}
 */
function getHistory() {
    return [...chatHistory];
}

/**
 * Sanitize and truncate a message text.
 * @param {string} text
 * @returns {string}
 */
function sanitize(text) {
    return String(text).substring(0, MAX_MSG_LENGTH);
}

/**
 * Clean up rate limit tracking for a disconnected socket.
 * @param {string} socketId
 */
function cleanup(socketId) {
    chatRateLimit.delete(socketId);
}

module.exports = {
    MAX_MSG_LENGTH,
    canChat,
    addMessage,
    getHistory,
    sanitize,
    cleanup,
};
