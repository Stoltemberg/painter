/**
 * Toast Notification System
 * Provides non-blocking toast notifications as a replacement for alert().
 * 
 * Usage:
 *   import { showToast } from './js/toast.js';
 *   showToast('Hello!', 'success');
 *   showToast('Error occurred', 'error', 5000);
 * 
 * Types: 'info' (default), 'error', 'success', 'warning'
 */

let _container = null;

function getContainer() {
    if (!_container) {
        _container = document.getElementById('toast-container');
        if (!_container) {
            _container = document.createElement('div');
            _container.id = 'toast-container';
            document.body.appendChild(_container);
        }
    }
    return _container;
}

/**
 * Show a toast notification.
 * @param {string} message - The message to display
 * @param {'info'|'error'|'success'|'warning'} type - Toast type
 * @param {number} duration - Duration in ms before auto-dismiss
 */
export function showToast(message, type = 'info', duration = 3000) {
    const container = getContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => {
        toast.classList.add('toast-show');
    });

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, duration);
}
