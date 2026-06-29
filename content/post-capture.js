/**
 * post-capture.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Monitors Reddit SPA navigation and captures structured post data whenever
 * the user lands on a post page.
 *
 * The core correctness guarantee
 * ────────────────────────────────
 * Reddit's SPA reuses the same shreddit-post DOM element across navigations —
 * it updates its attributes in place rather than replacing the node. A naive
 * "wait for any post element" check therefore returns instantly with stale data
 * from the previous post.
 *
 * The fix: parse the post ID out of the URL (the alphanumeric segment after
 * /comments/) and poll until shreddit-post[permalink] (or the equivalent old-
 * Reddit anchor) actually contains that ID. Only then is the DOM safe to read.
 *
 * Navigation detection
 * ─────────────────────
 * Two complementary watchers (both cleaned up in stop()):
 *   1. MutationObserver on <title> — fires on every Reddit SPA navigation
 *   2. 500 ms URL polling — fallback for same-title consecutive posts
 *
 * Dependencies (loaded first via manifest injection order):
 *   services/storage.service.js  → window.StorageService
 *   content/reddit-parser.js     → window.RedditParser
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PostCapture = (() => {

  // ── State ─────────────────────────────────────────────────────────────────────
  const _state = {
    active:               false,
    projectId:            null,
    schemaConfig:         {},
    lastCapturedUrl:      null,
    lastCapturedNodeId:   null,   // used as parentId for captured comments
    titleObserver:        null,
    urlInterval:          null,
    lastPolledUrl:        null,
    commentClickHandler:  null,
    commentHoverHandler:  null,
    hoveredComment:       null,   // comment container element (for data extraction)
    hoveredHighlight:     null,   // element with the visual highlight applied
  };

  const COMMENT_SELECTOR = 'shreddit-comment, .Comment, [data-type="comment"], div[id^="thing_t1_"]';

  const HIGHLIGHT_COLOR          = '#6286C9';            /* 30% medium blue — hover  */
  const HIGHLIGHT_BG             = 'rgba(98,134,201,0.09)';
  const HIGHLIGHT_CAPTURED_COLOR = '#184397';            /* 10% deep navy — captured */

  // Captures the alphanumeric post ID from /comments/<id>/
  const POST_URL_RE = /\/r\/[^/]+\/comments\/([^/?#]+)/;

  function _getPostId(url) {
    const m = url.match(POST_URL_RE);
    return m ? m[1].toLowerCase() : null;
  }

  function _isPostPage(url) {
    return POST_URL_RE.test(url);
  }

  // ── DOM readiness check ───────────────────────────────────────────────────────

  /**
   * _isTargetPostLoaded(postId)
   * Returns true only when the post element currently in the DOM belongs to
   * the post we navigated to — not the previously rendered one.
   *
   * Checks in order:
   *   1. shreddit-post[permalink] contains the post ID (new Reddit)
   *   2. [data-fullname="t3_<postId>"] (Reddit redesign data attrs)
   *   3. #thing_t3_<postId>           (old Reddit)
   */
  function _isTargetPostLoaded(postId) {
    // ── New Reddit (shreddit web component) ───────────────────────────────────
    const shreddit = document.querySelector('shreddit-post');
    if (shreddit) {
      const candidates = [
        shreddit.getAttribute('permalink')     || '',
        shreddit.getAttribute('content-href')  || '',
        shreddit.getAttribute('post-id')       || '',
        shreddit.getAttribute('id')            || '',
      ];
      if (candidates.some(v => v.toLowerCase().includes(postId))) return true;
    }

    // ── Reddit redesign data attributes ──────────────────────────────────────
    if (document.querySelector(`[data-fullname="t3_${postId}"]`)) return true;
    if (document.querySelector(`[data-post-id="${postId}"]`))     return true;

    // ── Old Reddit ────────────────────────────────────────────────────────────
    if (document.getElementById(`thing_t3_${postId}`)) return true;

    return false;
  }

  /**
   * _waitForTargetPost(postId, maxMs)
   * Polls until the DOM reflects the correct post or the timeout expires.
   * Returns true on success, false on timeout.
   */
  async function _waitForTargetPost(postId, maxMs = 6000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (_isTargetPostLoaded(postId)) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  // ── Data extraction ───────────────────────────────────────────────────────────

  /**
   * _extractPostData()
   * Called only after _waitForTargetPost() confirms the DOM is current.
   * Reads title, body text, URL, and timestamp.
   */
  function _extractPostData() {
    const postTitle = RedditParser.getPostTitle();
    if (!postTitle) return null;

    const cfg = _state.schemaConfig;

    const url = cfg.captureUrl ? RedditParser.getCanonicalURL() : '';

    const bodyEl = (
      document.querySelector('shreddit-post [slot="text-body"]')           ||
      document.querySelector('[data-click-id="text"] .RichTextJSON-root')  ||
      document.querySelector('.expando .usertext-body .md')                 ||
      document.querySelector('[data-test-id="post-content"] .RichTextJSON-root')
    );
    const text = bodyEl ? bodyEl.textContent.trim() : '';

    const timeEl = (
      document.querySelector('shreddit-post time')               ||
      document.querySelector('[data-click-id="timestamp"] time') ||
      document.querySelector('.tagline time')
    );
    const timestampISO = cfg.captureTimestamp
      ? (timeEl ? RedditParser.parseTimestamp(timeEl) : new Date().toISOString())
      : '';

    return { postTitle, url, text, timestampISO };
  }

  // ── Post capture pipeline ─────────────────────────────────────────────────────

  async function _captureCurrentPost() {
    if (!_state.active) return;

    const currentUrl = window.location.href;
    if (!_isPostPage(currentUrl))              return;
    if (currentUrl === _state.lastCapturedUrl) return;

    const postId = _getPostId(currentUrl);
    if (!postId) return;

    const ready = await _waitForTargetPost(postId);
    if (!ready || !_state.active)          return;
    if (window.location.href !== currentUrl) return;

    const data = _extractPostData();
    if (!data) return;

    _state.lastCapturedUrl = currentUrl;

    try {
      const res = await new Promise(resolve =>
        chrome.runtime.sendMessage({
          type:      MSG.NODE_APPEND,
          projectId: _state.projectId,
          payload: {
            type:         'post',
            parentId:     null,
            text:         data.text,
            url:          data.url,
            postTitle:    data.postTitle,
            timestampISO: data.timestampISO,
          },
        }, resolve)
      );

      if (!res?.ok) throw new Error(res?.error || 'node:append failed');

      _state.lastCapturedNodeId = res.nodeId;

      window.dispatchEvent(new CustomEvent('validata:captured', {
        detail: { postTitle: data.postTitle },
      }));

    } catch (err) {
      console.error('[Validata] post capture failed:', err);
      _state.lastCapturedUrl = null;
    }
  }

  // ── Comment hover highlight ───────────────────────────────────────────────────

  function _highlightComment(el) {
    if (!el) return;
    el.__validataOutline = el.style.getPropertyValue('outline');
    el.__validataBg      = el.style.getPropertyValue('background-color');
    el.__validataCursor  = el.style.getPropertyValue('cursor');
    el.style.setProperty('outline',          `2px solid ${HIGHLIGHT_COLOR}`, 'important');
    el.style.setProperty('background-color', HIGHLIGHT_BG,                   'important');
    el.style.setProperty('cursor',           'pointer',             'important');
    _state.hoveredComment = el;
  }

  function _unhighlightComment(el) {
    if (!el || !('__validataOutline' in el)) return;
    el.style.removeProperty('outline');
    el.style.removeProperty('background-color');
    el.style.removeProperty('cursor');
    if (el.__validataOutline) el.style.setProperty('outline',          el.__validataOutline);
    if (el.__validataBg)      el.style.setProperty('background-color', el.__validataBg);
    if (el.__validataCursor)  el.style.setProperty('cursor',           el.__validataCursor);
    delete el.__validataOutline;
    delete el.__validataBg;
    delete el.__validataCursor;
    if (_state.hoveredComment === el) _state.hoveredComment = null;
  }

  function _flashCaptured(el) {
    if (!el) return;
    el.style.setProperty('outline', `2px solid ${HIGHLIGHT_CAPTURED_COLOR}`, 'important');
    setTimeout(() => {
      el.style.removeProperty('outline');
      if (el.__validataOutline) el.style.setProperty('outline', el.__validataOutline);
    }, 700);
  }

  // Returns the comment's own body element — excludes nested reply containers,
  // so the highlight covers only the text the user is about to capture.
  function _getCommentBody(commentEl) {
    return (
      commentEl.querySelector('[slot="comment"]')        ||
      commentEl.querySelector('.RichTextJSON-root')      ||
      commentEl.querySelector('.md')                     ||
      commentEl.querySelector('.usertext-body')          ||
      commentEl.querySelector('[data-click-id="text"]')  ||
      commentEl.querySelector('p')                       ||
      commentEl
    );
  }

  function _onCommentMouseover(e) {
    if (!_state.active || !_state.schemaConfig.captureComments) return;
    const commentEl = e.target.closest(COMMENT_SELECTOR);
    if (commentEl === _state.hoveredComment) return;
    _unhighlightComment(_state.hoveredHighlight);
    if (commentEl) {
      const bodyEl = _getCommentBody(commentEl);
      _highlightComment(bodyEl);
      _state.hoveredComment   = commentEl;
      _state.hoveredHighlight = bodyEl;
    } else {
      _state.hoveredComment   = null;
      _state.hoveredHighlight = null;
    }
  }

  // ── Comment capture (manual click) ───────────────────────────────────────────

  function _onCommentClick(e) {
    if (!_state.active || !_state.schemaConfig.captureComments) return;

    const commentEl = _state.hoveredComment || e.target.closest(COMMENT_SELECTOR);
    if (!commentEl) return;

    const bodyEl = _getCommentBody(commentEl);
    const text = bodyEl.textContent.trim();
    if (!text) return;

    const cfg = _state.schemaConfig;

    const timeEl = commentEl.querySelector('time');
    const timestampISO = cfg.captureTimestamp
      ? (timeEl ? RedditParser.parseTimestamp(timeEl) : new Date().toISOString())
      : '';

    const permalinkEl = commentEl.querySelector(
      'a[slot="commentPermalink"], a.bylink, a[data-click-id="timestamp"]'
    );
    const url = cfg.captureUrl
      ? (permalinkEl ? RedditParser.sanitiseURL(permalinkEl.href) : RedditParser.getCanonicalURL())
      : '';

    const flashEl = _state.hoveredHighlight || commentEl;

    chrome.runtime.sendMessage({
      type:      MSG.NODE_APPEND,
      projectId: _state.projectId,
      payload: {
        type:         'reply',
        parentId:     _state.lastCapturedNodeId || null,
        text,
        url,
        postTitle:    RedditParser.getPostTitle(),
        timestampISO,
      },
    }, (res) => {
      if (chrome.runtime.lastError) {
        console.error('[Validata] comment capture failed:', chrome.runtime.lastError.message);
        return;
      }
      _flashCaptured(flashEl);
      window.dispatchEvent(new CustomEvent('validata:captured', {
        detail: { postTitle: `[comment] ${text.slice(0, 50)}` },
      }));
    });
  }

  // ── Navigation watchers ───────────────────────────────────────────────────────

  function _startTitleObserver() {
    const titleEl = document.querySelector('title');
    if (!titleEl) return;
    _state.titleObserver = new MutationObserver(() => {
      setTimeout(_captureCurrentPost, 300);
    });
    _state.titleObserver.observe(titleEl, { childList: true, subtree: true, characterData: true });
  }

  function _startUrlPolling() {
    _state.lastPolledUrl = window.location.href;
    _state.urlInterval   = setInterval(() => {
      const current = window.location.href;
      if (current !== _state.lastPolledUrl) {
        _state.lastPolledUrl = current;
        setTimeout(_captureCurrentPost, 300);
      }
    }, 500);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  function start(projectId, schemaConfig = {}) {
    if (_state.active) return;
    _state.active             = true;
    _state.projectId          = projectId;
    _state.lastCapturedUrl    = null;
    _state.lastCapturedNodeId = null;
    _state.schemaConfig = {
      captureTimestamp: schemaConfig.captureTimestamp !== false,
      captureUrl:       schemaConfig.captureUrl       !== false,
      captureComments:  schemaConfig.captureComments  === true,
    };

    _startTitleObserver();
    _startUrlPolling();

    _state.commentClickHandler = _onCommentClick;
    _state.commentHoverHandler = _onCommentMouseover;
    document.addEventListener('click',     _state.commentClickHandler, true);
    document.addEventListener('mouseover', _state.commentHoverHandler, true);

    setTimeout(_captureCurrentPost, 300);
  }

  function stop() {
    _unhighlightComment(_state.hoveredHighlight);

    _state.active    = false;
    _state.projectId = null;

    if (_state.titleObserver) { _state.titleObserver.disconnect(); _state.titleObserver = null; }
    if (_state.urlInterval)   { clearInterval(_state.urlInterval); _state.urlInterval   = null; }

    document.removeEventListener('click',     _state.commentClickHandler, true);
    document.removeEventListener('mouseover', _state.commentHoverHandler, true);
    _state.commentClickHandler = null;
    _state.commentHoverHandler = null;
  }

  return { start, stop };

})();

if (typeof window !== 'undefined') window.PostCapture = PostCapture;
