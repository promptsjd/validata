/**
 * popup.js  —  entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns:
 *   - Shared state (_session)
 *   - DOM reference map (DOM)
 *   - Incoming message listener (session:ended, session:captured)
 *   - All addEventListener event wiring
 *   - _init() bootstrap
 *
 * Everything else lives in:
 *   popup.api.js     → msg() messaging helper
 *   popup.ui.js      → DOM builders, formatters, error/session display
 *   popup.actions.js → business logic (start/stop session, CRUD, export)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Shared state ───────────────────────────────────────────────────────────────
const _session = {
  active:       false,
  projectId:    null,
  captureCount: 0,
};

// ── DOM references ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const DOM = {
  statusDot:      $('status-dot'),
  sessionLabel:   $('session-label'),
  btnStart:       $('btn-start-session'),
  btnStop:        $('btn-stop-session'),
  btnAddProject:  $('btn-add-project'),
  projectList:    $('project-list'),
  emptyState:     $('empty-state'),
  errorBanner:    $('error-banner'),

  // Modal
  modalBackdrop:   $('modal-backdrop'),
  inputName:       $('input-project-name'),
  schemaTimestamp: $('schema-timestamp'),
  schemaUrl:       $('schema-url'),
  schemaComments:  $('schema-comments'),
  btnSaveDefault:  $('btn-save-default'),
  btnModalClose:   $('btn-modal-close'),
  btnModalCancel:  $('btn-modal-cancel'),
  btnModalCreate:  $('btn-modal-create'),

  // Context menu
  contextMenu:     $('context-menu'),
};

// ── Incoming messages from background.js ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.SESSION_ENDED) {
    _session.active    = false;
    _session.projectId = null;
    _setSessionUI(false);
  }

  if (message.type === MSG.SESSION_CAPTURED && _session.active) {
    _session.captureCount++;
    _updateSessionLabel();
    _renderProjects();
  }
});

// ── Event wiring ───────────────────────────────────────────────────────────────

DOM.btnStart.addEventListener('click',      _startSession);
DOM.btnStop.addEventListener('click',       _stopSession);
DOM.btnAddProject.addEventListener('click', _openModal);
DOM.btnModalClose.addEventListener('click',   _closeModal);
DOM.btnModalCancel.addEventListener('click',  _closeModal);
DOM.btnModalCreate.addEventListener('click',  _createProject);
DOM.btnSaveDefault.addEventListener('click',  _saveAsDefault);

DOM.inputName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  _createProject();
  if (e.key === 'Escape') _closeModal();
});

DOM.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === DOM.modalBackdrop) _closeModal();
});

DOM.contextMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const pid    = _contextProjectId;
  _hideContextMenu();

  if (action === 'export-csv')  await _exportProject(pid, 'csv');
  if (action === 'export-json') await _exportProject(pid, 'json');
  if (action === 'clear')       await _clearProjectData(pid);
  if (action === 'delete')      await _deleteProject(pid);
});

document.addEventListener('click', (e) => {
  if (!DOM.contextMenu.classList.contains('hidden') && !DOM.contextMenu.contains(e.target)) {
    _hideContextMenu();
  }
});

// ── Init ───────────────────────────────────────────────────────────────────────

async function _init() {
  try {
    const res = await msg(MSG.SESSION_QUERY);
    if (res.active) {
      _session.active = true;
      _setSessionUI(true);
    }
  } catch {
    // Not on a Reddit tab or content script not ready — silent init.
  }
  await _renderProjects();
}

_init();
