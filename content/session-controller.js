/**
 * session-controller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the PostCapture lifecycle in response to messages from background.js
 * and forwards capture events to the side panel via chrome.runtime.sendMessage.
 *
 * No DOM is injected into the host page — all session feedback is shown inside
 * the side panel itself.
 *
 * Message contract (background.js → this script):
 *   MSG.HUD_START  { projectId, projectName, schemaConfig } → start PostCapture
 *   MSG.HUD_STOP                                            → stop PostCapture
 *   MSG.HUD_PING                                            → reply with active state
 *
 * Message contract (this script → background.js → side panel):
 *   MSG.SESSION_CAPTURED { postTitle }  → panel increments capture count
 *
 * Dependencies (loaded before this script via manifest injection order):
 *   services/constants.js        → window.MSG
 *   services/storage.service.js  → window.StorageService
 *   content/reddit-parser.js     → window.RedditParser
 *   content/post-capture.js      → window.PostCapture
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SessionController = (() => {

  const _state = {
    active:     false,
    projectId:  null,
    onCaptured: null,
  };

  function start(meta) {
    if (_state.active) return;
    _state.active    = true;
    _state.projectId = meta.projectId;

    _state.onCaptured = (e) => {
      chrome.runtime.sendMessage({
        type:      MSG.SESSION_CAPTURED,
        postTitle: e.detail?.postTitle || '',
      }).catch(() => {});
    };

    window.addEventListener('validata:captured', _state.onCaptured);
    PostCapture.start(meta.projectId, meta.schemaConfig || {});
  }

  function stop() {
    if (!_state.active) return;

    PostCapture.stop();

    if (_state.onCaptured) {
      window.removeEventListener('validata:captured', _state.onCaptured);
      _state.onCaptured = null;
    }

    _state.active    = false;
    _state.projectId = null;
  }

  function isActive() { return _state.active; }

  return { start, stop, isActive };

})();

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case MSG.HUD_START:
      SessionController.start({
        projectId:   message.projectId,
        projectName: message.projectName,
        schemaConfig: message.schemaConfig,
      });
      sendResponse({ ok: true });
      return false;

    case MSG.HUD_STOP:
      SessionController.stop();
      sendResponse({ ok: true });
      return false;

    case MSG.HUD_PING:
      sendResponse({ active: SessionController.isActive() });
      return false;

    default:
      return false;
  }
});

if (typeof window !== 'undefined') {
  window.SessionController = SessionController;
  window.__validataReady   = true;
}
