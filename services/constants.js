/**
 * constants.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all chrome.runtime message type strings.
 * Used by background.js, popup.js, and visual-hud.js so a typo in any one
 * file produces a reference error rather than a silent failure.
 *
 * Loaded as a plain script (not an ES module) so it works in both:
 *   - content scripts  (injected via manifest content_scripts)
 *   - the side panel   (loaded via <script src> in popup.html)
 *   - background.js    (imported via importScripts or manifest background.scripts)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MSG = Object.freeze({
  // ── Session lifecycle (popup ↔ background) ──────────────────────────────
  SESSION_START:    'session:start',
  SESSION_STOP:     'session:stop',
  SESSION_QUERY:    'session:query',
  SESSION_ENDED:    'session:ended',
  SESSION_CAPTURED: 'session:captured',

  // ── HUD / content-script control (background ↔ content script) ─────────
  HUD_START:   'hud:start',
  HUD_STOP:    'hud:stop',
  HUD_PING:    'hud:ping',
  HUD_STOPPED: 'hud:stopped',

  // ── Project CRUD (popup ↔ background) ───────────────────────────────────
  PROJECT_CREATE:     'project:create',
  PROJECT_UPDATE:     'project:update',
  PROJECT_LIST:       'project:list',
  PROJECT_NODES:      'project:nodes',
  PROJECT_CLEAR_DATA: 'project:clearData',
  PROJECT_DELETE:     'project:delete',

  // ── Node capture (content script ↔ background) ─────────────────────────
  NODE_APPEND: 'node:append',

  // ── Export (popup ↔ background) ─────────────────────────────────────────
  EXPORT_CSV:  'export:csv',
  EXPORT_JSON: 'export:json',

  // ── Default schema config (popup ↔ background) ───────────────────────────
  SCHEMA_DEFAULT_GET: 'schema:default:get',
  SCHEMA_DEFAULT_SET: 'schema:default:set',
});

// Global assignment — used by popup.js and content scripts loaded as plain scripts
if (typeof window     !== 'undefined') window.MSG     = MSG;
if (typeof globalThis !== 'undefined') globalThis.MSG = MSG;
