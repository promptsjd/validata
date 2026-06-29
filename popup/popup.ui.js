/**
 * popup.ui.js
 * ─────────────────────────────────────────────────────────────────────────────
 * UI layer. Owns all DOM building and display logic:
 *   - Utility formatters (_esc, _formatDate, _formatNodeCount)
 *   - Error banner (_showError, _clearError)
 *   - Session status display (_setSessionUI, _updateSessionLabel)
 *   - Project card and body builder (_buildProjectCard, _loadProjectBody)
 *   - Context menu position + show/hide (_showContextMenu, _hideContextMenu)
 *
 * No chrome.runtime calls here — all messaging goes through popup.actions.js
 * or popup.api.js. All state reads come from the shared `_session` and `DOM`
 * objects defined in popup.js (the entry point, loaded last).
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Error banner ───────────────────────────────────────────────────────────────

function _showError(message) {
  DOM.errorBanner.textContent = message;
  DOM.errorBanner.classList.remove('hidden');
  setTimeout(() => DOM.errorBanner.classList.add('hidden'), 5000);
}

function _clearError() {
  DOM.errorBanner.classList.add('hidden');
}

// ── Session status display ─────────────────────────────────────────────────────

function _setSessionUI(active) {
  _session.active = active;
  if (!active) _session.captureCount = 0;
  DOM.statusDot.classList.toggle('active', active);
  _updateSessionLabel();
  DOM.btnStart.classList.toggle('hidden', active);
  DOM.btnStop.classList.toggle('hidden', !active);
  _renderProjects();
}

function _updateSessionLabel() {
  if (!_session.active) {
    DOM.sessionLabel.textContent = 'No active session';
    return;
  }
  const n = _session.captureCount;
  DOM.sessionLabel.textContent = n === 0
    ? 'Session running — browse Reddit to capture'
    : `${n} item${n === 1 ? '' : 's'} captured`;
}

// ── Project card ───────────────────────────────────────────────────────────────

/**
 * _buildProjectCard(project, startExpanded)
 * Builds one accordion card DOM node. Two expansion levels:
 *   Level 1: click project header → shows grouped post titles
 *   Level 2: click a post title   → shows up to 5 node snippets
 */
function _buildProjectCard(project, startExpanded) {
  const isActiveSession = (_session.active && _session.projectId === project.id);

  const card = document.createElement('div');
  card.className = `project-card${startExpanded ? ' expanded' : ''}${isActiveSession ? ' is-selected-session' : ''}`;
  card.dataset.projectId = project.id;

  const header = document.createElement('div');
  header.className = 'project-header';
  header.innerHTML = `
    <span class="project-chevron">▶</span>
    <div class="project-info">
      <div class="project-name">${_esc(project.name)}</div>
      <div class="project-meta">${_formatNodeCount(project)} · ${_formatDate(project.createdAt)}</div>
    </div>
    <div class="project-actions">
      <button class="project-use-btn${_session.projectId === project.id ? ' active' : ''}"
              data-project-id="${project.id}">
        ${isActiveSession ? 'Active' : 'Use'}
      </button>
      <button class="project-menu-btn" data-project-id="${project.id}" title="More options">⋮</button>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'project-body';
  body.innerHTML = '<div class="no-nodes">Loading…</div>';

  const cfg = project.schemaConfig || {};
  const locked = isActiveSession;
  const settings = document.createElement('div');
  settings.className = 'project-settings';
  settings.innerHTML = `
    <div class="project-settings-label">Capture settings</div>
    <div class="project-settings-toggles">
      <label class="project-setting-toggle${locked ? ' project-setting-toggle--locked' : ''}">
        <input type="checkbox" data-key="captureTimestamp" ${cfg.captureTimestamp !== false ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <span>Timestamp</span>
      </label>
      <label class="project-setting-toggle${locked ? ' project-setting-toggle--locked' : ''}">
        <input type="checkbox" data-key="captureUrl" ${cfg.captureUrl !== false ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <span>Post link</span>
      </label>
      <label class="project-setting-toggle${locked ? ' project-setting-toggle--locked' : ''}">
        <input type="checkbox" data-key="captureComments" ${cfg.captureComments ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <span>Comments</span>
      </label>
    </div>
    <div class="project-settings-notice">${locked ? 'Stop the session to make changes' : 'Changes apply to new captures'}</div>
  `;

  settings.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', async () => {
      const key     = input.dataset.key;
      const updated = { ...cfg, [key]: input.checked };
      try {
        await msg(MSG.PROJECT_UPDATE, { projectId: project.id, schemaConfig: updated });
        Object.assign(cfg, updated);
      } catch (err) {
        _showError(`Could not update settings: ${err.message}`);
        input.checked = !input.checked;
      }
    });
  });

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(settings);

  if (startExpanded) _loadProjectBody(project.id, body);

  header.addEventListener('click', (e) => {
    if (e.target.closest('.project-actions')) return;
    const isExpanded = card.classList.toggle('expanded');
    if (isExpanded && body.innerHTML.includes('Loading')) {
      _loadProjectBody(project.id, body);
    }
  });

  header.querySelector('.project-use-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_session.active) return;
    _session.projectId = project.id;
    DOM.btnStart.disabled = false;
    _renderProjects();
  });

  header.querySelector('.project-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    _showContextMenu(e, project.id, project.name);
  });

  return card;
}

/**
 * _loadProjectBody(projectId, bodyEl)
 * Fetches nodes and builds the grouped post-title / snippet tree.
 */
async function _loadProjectBody(projectId, bodyEl) {
  try {
    const res = await msg(MSG.PROJECT_NODES, { projectId });
    const nodes = res.nodes || [];

    if (nodes.length === 0) {
      bodyEl.innerHTML = '<div class="no-nodes">No captured nodes yet.</div>';
      return;
    }

    const grouped = new Map();
    for (const node of nodes) {
      const key = node.postTitle || '(untitled post)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(node);
    }

    const postList = document.createElement('div');
    postList.className = 'post-list';

    for (const [title, titleNodes] of grouped.entries()) {
      const postItem = document.createElement('div');
      postItem.className = 'post-item';

      const postHeader = document.createElement('div');
      postHeader.className = 'post-header';
      postHeader.innerHTML = `
        <span class="post-chevron">▶</span>
        <span class="post-title-text" title="${_esc(title)}">${_esc(title)}</span>
        <span class="post-count-badge">${titleNodes.length}</span>
      `;

      const replyList = document.createElement('div');
      replyList.className = 'reply-list';

      for (const node of titleNodes.slice(0, 5)) {
        const snip = document.createElement('div');
        snip.className = 'reply-snippet';
        const tag = node.type === 'post' ? 'tag-post' : 'tag-reply';
        snip.innerHTML = `<span class="reply-type-tag ${tag}">${node.type}</span> ${_esc(node.text)}`;
        replyList.appendChild(snip);
      }

      if (titleNodes.length > 5) {
        const more = document.createElement('div');
        more.className = 'no-nodes';
        more.textContent = `+${titleNodes.length - 5} more nodes…`;
        replyList.appendChild(more);
      }

      postHeader.addEventListener('click', () => postItem.classList.toggle('expanded'));
      postItem.appendChild(postHeader);
      postItem.appendChild(replyList);
      postList.appendChild(postItem);
    }

    bodyEl.innerHTML = '';
    bodyEl.appendChild(postList);

  } catch (err) {
    bodyEl.innerHTML = `<div class="no-nodes" style="color:var(--red)">${_esc(err.message)}</div>`;
  }
}

// ── Context menu ───────────────────────────────────────────────────────────────

let _contextProjectId   = null;
let _contextProjectName = null;

function _showContextMenu(e, projectId, projectName) {
  _contextProjectId   = projectId;
  _contextProjectName = projectName;

  const menu = DOM.contextMenu;
  menu.classList.remove('hidden');

  const rect  = e.target.getBoundingClientRect();
  const menuW = 170;
  const menuH = 110;
  const vh    = document.documentElement.clientHeight;

  let left = rect.right - menuW;
  let top  = rect.bottom + 4;
  if (left < 4) left = 4;
  if (top + menuH > vh) top = rect.top - menuH - 4;

  menu.style.left = `${left}px`;
  menu.style.top  = `${top}px`;
}

function _hideContextMenu() {
  DOM.contextMenu.classList.add('hidden');
  _contextProjectId   = null;
  _contextProjectName = null;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _formatNodeCount(project) {
  const posts    = project.postCount;
  const comments = project.replyCount;

  if (posts !== undefined) {
    const parts = [];
    if (posts    > 0) parts.push(`${posts} post${posts === 1 ? '' : 's'}`);
    if (comments > 0) parts.push(`${comments} comment${comments === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : '0 captured';
  }

  // Legacy projects with only nodeCount.
  const total = project.nodeCount || 0;
  return `${total} node${total === 1 ? '' : 's'}`;
}

function _formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '';
  }
}
