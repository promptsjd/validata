/**
 * reddit-parser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stateless utility module. Exposes `RedditParser` globally so visual-hud.js
 * (loaded in the same content-script context) can call it without any import
 * statement — content scripts share the same window scope when injected via
 * the manifest content_scripts array.
 *
 * Responsibilities
 * ────────────────
 *  1. Parse Reddit's human-readable relative/absolute time strings into ISO 8601.
 *  2. Extract the canonical post title from the active page.
 *  3. Sanitise the current URL by stripping tracker query parameters.
 *  4. Determine whether a clicked DOM node is a root post or a nested reply.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RedditParser = (() => {

  // ── Time parsing ───────────────────────────────────────────────────────────

  /**
   * RELATIVE_PATTERN matches strings like:
   *   "3 hours ago", "just now", "5 months ago", "1 year ago", "2 days ago"
   *
   * Reddit also renders absolute ISO-like strings in <time> element `datetime`
   * attributes — we handle those separately in parseTimestamp().
   */
  const RELATIVE_PATTERN = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i;

  /**
   * Unit → milliseconds map used to subtract from Date.now().
   */
  const UNIT_MS = {
    second: 1_000,
    minute: 60_000,
    hour:   3_600_000,
    day:    86_400_000,
    week:   604_800_000,
    month:  2_592_000_000,   // 30-day approximation
    year:   31_536_000_000,  // 365-day approximation
  };

  /**
   * parseTimestamp(element)
   * ──────────────────────
   * Given a DOM element (expected to be a <time> node or its ancestor),
   * attempts to resolve a precise ISO 8601 timestamp by checking, in order:
   *
   *   1. The element's own `datetime` attribute (Reddit renders this on <time>).
   *   2. The nearest ancestor <time datetime="..."> attribute.
   *   3. The element's trimmed innerText, parsed as a relative string.
   *   4. Falls back to the current time as a last resort.
   *
   * @param   {Element} element - Any DOM node near the timestamp text
   * @returns {string}  ISO 8601 string
   */
  function parseTimestamp(element) {
    // 1. Direct <time datetime> attribute — most reliable signal on Reddit.
    const timeEl = element.closest('time') || element.querySelector('time');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime');
      if (dt) {
        const parsed = new Date(dt);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
      }
      // Also try the innerText of the <time> element as a relative string.
      const relDate = _parseRelativeText(timeEl.textContent.trim());
      if (relDate) return relDate.toISOString();
    }

    // 2. Attempt to parse the element's own text content as relative time.
    const relDate = _parseRelativeText(element.textContent.trim());
    if (relDate) return relDate.toISOString();

    // 3. Final fallback — record the capture instant.
    return new Date().toISOString();
  }

  /**
   * parseRelativeString(text)
   * Public wrapper that converts a raw relative time string directly.
   * Used when visual-hud.js captures text without an associated DOM element.
   *
   * @param   {string} text - e.g. "3 hours ago"
   * @returns {string}      ISO 8601 string
   */
  function parseRelativeString(text) {
    const date = _parseRelativeText(text);
    return date ? date.toISOString() : new Date().toISOString();
  }

  /**
   * _parseRelativeText(text)
   * Internal. Parses relative strings via RELATIVE_PATTERN.
   * "just now" resolves to the current moment.
   *
   * @returns {Date|null}
   */
  function _parseRelativeText(text) {
    if (!text) return null;

    const lower = text.toLowerCase().trim();
    if (lower === 'just now') return new Date();

    const match = lower.match(RELATIVE_PATTERN);
    if (!match) return null;

    const amount = parseInt(match[1], 10);
    const unit   = match[2];
    const deltaMs = amount * (UNIT_MS[unit] || 0);
    return new Date(Date.now() - deltaMs);
  }

  // ── Post title extraction ──────────────────────────────────────────────────

  /**
   * getPostTitle()
   * Extracts the canonical post title from the active Reddit page.
   *
   * Strategy (applied in order — Reddit's DOM varies across old/new/redesign):
   *   1. <shreddit-post> custom element's `post-title` attribute (new Reddit).
   *   2. [data-test-id="post-content"] h1 (new Reddit fallback).
   *   3. document.title stripped of the " : r/<subreddit>" suffix.
   *
   * @returns {string} Sanitised post title, or an empty string on listing pages.
   */
  function getPostTitle() {
    // New Reddit web component
    const shreddit = document.querySelector('shreddit-post');
    if (shreddit) {
      const attr = shreddit.getAttribute('post-title');
      if (attr) return attr.trim();
    }

    // Redesign post content wrapper
    const postH1 = document.querySelector('[data-test-id="post-content"] h1');
    if (postH1) return postH1.textContent.trim();

    // Generic h1 inside a post page container
    const genericH1 = document.querySelector('h1[slot="title"], h1.title, div.Post h1');
    if (genericH1) return genericH1.textContent.trim();

    // document.title fallback — strip " : r/subreddit • Reddit" suffixes
    return document.title.replace(/\s*[:\|•·].+$/, '').trim();
  }

  // ── URL sanitiser ──────────────────────────────────────────────────────────

  /**
   * TRACKER_PARAMS are UTM and Reddit-specific tracking query parameters that
   * should be stripped from captured URLs to produce clean canonical links.
   */
  const TRACKER_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'ref', 'ref_source', 'ref_campaign', 'rdt',
    'fbclid', 'gclid', 'msclkid', 'twclid',
    '_branch_match_id', '_branch_referrer',
    'context', 'share_id',
  ]);

  /**
   * sanitiseURL(href)
   * Removes tracker query parameters from a URL string.
   * The pathname and hash are preserved intact.
   *
   * @param   {string} href - Raw URL (absolute or relative)
   * @returns {string}      Cleaned URL string; returns href unchanged on parse failure
   */
  function sanitiseURL(href) {
    try {
      const url = new URL(href, window.location.origin);
      TRACKER_PARAMS.forEach(param => url.searchParams.delete(param));
      // If no params remain, strip the trailing '?'
      return url.toString();
    } catch {
      return href;
    }
  }

  /**
   * getCanonicalURL()
   * Sanitises the current page URL.
   *
   * @returns {string}
   */
  function getCanonicalURL() {
    return sanitiseURL(window.location.href);
  }

  // ── Node type resolution ───────────────────────────────────────────────────

  /**
   * resolveNodeType(element)
   * Determines whether a clicked DOM element represents a top-level post body
   * or a nested reply/comment by walking the ancestor chain.
   *
   * Reddit comment threads use these structural markers (across old/new Reddit):
   *   - shreddit-comment          → new Reddit comment
   *   - .Comment, [data-type="comment"] → redesign comment
   *   - .entry.unvoted, .entry    → old Reddit comment entry
   *   - .Post, [data-click-id="background"] → post container
   *
   * Returns 'reply' unless the element is unambiguously part of a root post.
   *
   * @param   {Element} element
   * @returns {{ type: 'post'|'reply', parentId: string|null }}
   *   parentId is the data-fullname / id of the immediate parent comment when
   *   available; otherwise null (indicating direct child of the post).
   */
  function resolveNodeType(element) {
    // Walk up to find the nearest comment ancestor.
    const commentEl = element.closest(
      'shreddit-comment, .Comment, [data-type="comment"], .entry, div[id^="thing_t1_"]'
    );

    if (!commentEl) {
      // No comment ancestor found — treat as root post body.
      return { type: 'post', parentId: null };
    }

    // Determine the parent comment's identifier for relational linking.
    // new Reddit uses `parentid` attribute on <shreddit-comment>.
    const rawParentId = commentEl.getAttribute('parentid')
      || commentEl.getAttribute('data-parent-id')
      || commentEl.closest('[data-parent-id]')?.getAttribute('data-parent-id')
      || null;

    return { type: 'reply', parentId: rawParentId };
  }

  /**
   * extractCommentPermalink(element)
   * Finds the canonical permalink for a specific comment from its DOM context.
   * Falls back to the current page URL when no comment-level link is found.
   *
   * @param   {Element} element
   * @returns {string}
   */
  function extractCommentPermalink(element) {
    const commentEl = element.closest(
      'shreddit-comment, .Comment, [data-type="comment"], .entry, div[id^="thing_t1_"]'
    );

    if (commentEl) {
      // New Reddit: <a slot="commentPermalink"> or an internal share-link anchor.
      const permalinkEl = commentEl.querySelector(
        'a[slot="commentPermalink"], a.bylink, a[data-click-id="timestamp"]'
      );
      if (permalinkEl?.href) return sanitiseURL(permalinkEl.href);
    }

    return getCanonicalURL();
  }

  // ── Public surface ─────────────────────────────────────────────────────────
  return {
    parseTimestamp,
    parseRelativeString,
    getPostTitle,
    getCanonicalURL,
    sanitiseURL,
    resolveNodeType,
    extractCommentPermalink,
  };

})();

if (typeof window !== 'undefined') {
  window.RedditParser = RedditParser;
}
