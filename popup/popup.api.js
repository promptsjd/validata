/**
 * popup.api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Messaging layer. Single function that wraps chrome.runtime.sendMessage and
 * returns a Promise. Every message to background.js goes through here.
 *
 * background.js always responds with { ok: boolean, ...data }.
 * A false `ok` or a missing response is surfaced as a rejected Promise.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/**
 * msg(type, payload)
 * @param {string} type    - One of the MSG.* constants from constants.js
 * @param {Object} payload - Extra fields merged into the message object
 * @returns {Promise<Object>}
 */
function msg(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response) {
        return reject(new Error('No response received from background.'));
      }
      if (!response.ok) {
        return reject(new Error(response.error || 'Unknown error'));
      }
      resolve(response);
    });
  });
}
