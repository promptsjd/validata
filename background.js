/**
 * background.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stateless MV3 service worker. Central message router.
 *
 * Storage operations are delegated entirely to storage.service.js (imported
 * as an ES module). This file owns only:
 *   1. Side-panel open on toolbar click
 *   2. Tab helpers for forwarding HUD commands to content scripts
 *   3. The chrome.runtime message switch
 *
 * Message routing table
 * ─────────────────────
 *  Sender        │ Message type   │ Handler
 *  ──────────────┼────────────────┼───────────────────────────────────────────
 *  popup.js      │ session:start  │ Forward hud:start to active Reddit tab
 *  popup.js      │ session:stop   │ Forward hud:stop  to active Reddit tab
 *  popup.js      │ session:query  │ Forward hud:ping  to active Reddit tab
 *  content script│ node:append    │ storage.appendNode
 *  popup.js      │ project:create │ storage.initProject
 *  popup.js      │ project:list   │ storage.getAllProjects
 *  popup.js      │ project:nodes  │ storage.getNodes
 *  popup.js      │ project:clear  │ storage.clearProjectData
 *  popup.js      │ project:delete │ storage.deleteProject
 *  popup.js      │ export:csv     │ storage.exportToCSV
 *  popup.js      │ export:json    │ storage.exportToJSON
 *  content script│ session:captured│ Relay to side panel
 *  content script│ hud:stopped    │ Relay session:ended to side panel
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  initProject,
  updateProject,
  getAllProjects,
  getNodes,
  appendNode,
  clearProjectData,
  deleteProject,
  exportToCSV,
  exportToJSON,
  getDefaultSchema,
  setDefaultSchema,
} from './services/storage.service.js';

const MSG = Object.freeze({
  SESSION_START:    'session:start',
  SESSION_STOP:     'session:stop',
  SESSION_QUERY:    'session:query',
  SESSION_ENDED:    'session:ended',
  SESSION_CAPTURED: 'session:captured',
  HUD_START:   'hud:start',
  HUD_STOP:    'hud:stop',
  HUD_PING:    'hud:ping',
  HUD_STOPPED: 'hud:stopped',
  NODE_APPEND:        'node:append',
  PROJECT_CREATE:     'project:create',
  PROJECT_UPDATE:     'project:update',
  PROJECT_LIST:       'project:list',
  PROJECT_NODES:      'project:nodes',
  PROJECT_CLEAR_DATA: 'project:clearData',
  PROJECT_DELETE:     'project:delete',
  EXPORT_CSV:  'export:csv',
  EXPORT_JSON: 'export:json',
  SCHEMA_DEFAULT_GET: 'schema:default:get',
  SCHEMA_DEFAULT_SET: 'schema:default:set',
});

// ── Open side panel on toolbar icon click ─────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Tab helpers (HUD commands only) ───────────────────────────────────────────

async function _getActiveRedditTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found.');
  if (!tab.url || !tab.url.includes('reddit.com')) {
    throw new Error('Navigate to a Reddit page first, then start a session.');
  }
  return tab;
}

function _sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(response);
    });
  });
}

/**
 * _ensureContentScripts(tabId)
 * Checks whether content scripts are loaded by reading the flag that
 * visual-hud.js sets (window.__validataReady). Using executeScript is more
 * reliable than a message ping, which can race with listener registration
 * and cause double-injection.
 */
async function _ensureContentScripts(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__validataReady === true,
  });

  if (result) return;

  const files = [
    'services/constants.js',
    'content/reddit-parser.js',
    'content/post-capture.js',
    'content/session-controller.js',
  ];

  for (const file of files) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  }
}

// ── Message listener ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  _handleAsync(message, sender, sendResponse);
  return true;
});

async function _handleAsync(message, sender, sendResponse) {
  try {
    switch (message.type) {

      // ── HUD / session (require active Reddit tab) ─────────────────────────

      case MSG.SESSION_START: {
        const tab = await _getActiveRedditTab();
        await _ensureContentScripts(tab.id);
        const response = await _sendToTab(tab.id, {
          type:         MSG.HUD_START,
          projectId:    message.projectId,
          projectName:  message.projectName,
          schemaConfig: message.schemaConfig || {},
        });
        sendResponse({ ok: true, ...response });
        break;
      }

      case MSG.SESSION_STOP: {
        const tab = await _getActiveRedditTab();
        await _ensureContentScripts(tab.id);
        const response = await _sendToTab(tab.id, { type: MSG.HUD_STOP });
        sendResponse({ ok: true, ...response });
        break;
      }

      case MSG.SESSION_QUERY: {
        const tab = await _getActiveRedditTab();
        await _ensureContentScripts(tab.id);
        const response = await _sendToTab(tab.id, { type: MSG.HUD_PING });
        sendResponse({ ok: true, active: response?.active ?? false });
        break;
      }

      case MSG.HUD_STOPPED: {
        chrome.runtime.sendMessage({ type: MSG.SESSION_ENDED }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // Content script notifies the side panel whenever a node is captured.
      case MSG.SESSION_CAPTURED: {
        chrome.runtime.sendMessage({
          type:      MSG.SESSION_CAPTURED,
          postTitle: message.postTitle,
        }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // ── Storage ───────────────────────────────────────────────────────────

      case MSG.NODE_APPEND: {
        const node = await appendNode(message.projectId, message.payload);
        sendResponse({ ok: true, nodeId: node.id });
        break;
      }

      case MSG.PROJECT_CREATE: {
        const project = await initProject(message.name, message.schemaConfig);
        sendResponse({ ok: true, project });
        break;
      }

      case MSG.PROJECT_UPDATE: {
        const project = await updateProject(message.projectId, message.schemaConfig);
        sendResponse({ ok: true, project });
        break;
      }

      case MSG.PROJECT_LIST: {
        const projects = await getAllProjects();
        sendResponse({ ok: true, projects });
        break;
      }

      case MSG.PROJECT_NODES: {
        const nodes = await getNodes(message.projectId);
        sendResponse({ ok: true, nodes });
        break;
      }

      case MSG.PROJECT_CLEAR_DATA: {
        await clearProjectData(message.projectId);
        sendResponse({ ok: true });
        break;
      }

      case MSG.PROJECT_DELETE: {
        await deleteProject(message.projectId);
        sendResponse({ ok: true });
        break;
      }

      case MSG.EXPORT_CSV: {
        const csv = await exportToCSV(message.projectId);
        sendResponse({ ok: true, csv });
        break;
      }

      case MSG.EXPORT_JSON: {
        const json = await exportToJSON(message.projectId);
        sendResponse({ ok: true, json });
        break;
      }

      case MSG.SCHEMA_DEFAULT_GET: {
        const defaults = await getDefaultSchema();
        sendResponse({ ok: true, defaults });
        break;
      }

      case MSG.SCHEMA_DEFAULT_SET: {
        await setDefaultSchema(message.schemaConfig);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }

  } catch (err) {
    console.error('[Validata BG]', message.type, err);
    sendResponse({ ok: false, error: err.message });
  }
}
