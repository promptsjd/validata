/**
 * popup.actions.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Business logic layer. Owns all user-initiated actions:
 *   - Session start / stop
 *   - Project list rendering (fetches data, delegates DOM building to popup.ui.js)
 *   - Project export, clear, delete
 *   - New project modal open / close / create
 *
 * All chrome.runtime messaging goes through msg() from popup.api.js.
 * All DOM mutations go through helpers in popup.ui.js.
 * State is read/written on the shared _session object from popup.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Session ────────────────────────────────────────────────────────────────────

async function _startSession() {
  if (!_session.projectId) {
    _showError('Select a project by clicking "Use" before starting a session.');
    return;
  }
  _clearError();
  try {
    const listRes = await msg(MSG.PROJECT_LIST);
    const project = (listRes.projects || []).find(p => p.id === _session.projectId);
    if (!project) throw new Error('Selected project not found.');

    await msg(MSG.SESSION_START, {
      projectId:    _session.projectId,
      projectName:  project.name,
      schemaConfig: project.schemaConfig || {},
    });
    _setSessionUI(true);
  } catch (err) {
    _showError(`Could not start session: ${err.message}`);
  }
}

async function _stopSession() {
  try {
    await msg(MSG.SESSION_STOP);
  } catch {
    // Tab may have navigated away — still reset the panel UI.
  }
  _setSessionUI(false);
}

// ── Project list ───────────────────────────────────────────────────────────────

/**
 * _renderProjects()
 * Fetches the project list and re-renders the full accordion.
 * Preserves which cards were expanded before the re-render.
 */
async function _renderProjects() {
  let projects = [];
  try {
    const res = await msg(MSG.PROJECT_LIST);
    projects = res.projects || [];
  } catch (err) {
    DOM.projectList.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'empty-state';
    note.textContent = 'Open a Reddit tab to manage projects.';
    DOM.projectList.appendChild(note);
    DOM.emptyState.classList.add('hidden');
    DOM.btnStart.disabled = true;
    return;
  }

  const expandedIds = new Set(
    [...DOM.projectList.querySelectorAll('.project-card.expanded')]
      .map(el => el.dataset.projectId)
  );

  DOM.projectList.innerHTML = '';

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No projects yet. Create one to begin capturing.';
    DOM.projectList.appendChild(empty);
    DOM.btnStart.disabled = true;
    return;
  }

  DOM.btnStart.disabled = (_session.projectId === null);

  for (const project of projects) {
    DOM.projectList.appendChild(_buildProjectCard(project, expandedIds.has(project.id)));
  }
}

// ── Export ─────────────────────────────────────────────────────────────────────

async function _exportProject(projectId, format) {
  _clearError();
  try {
    let content, mimeType, ext;
    if (format === 'csv') {
      const res = await msg(MSG.EXPORT_CSV, { projectId });
      content  = res.csv;
      mimeType = 'text/csv';
      ext      = 'csv';
    } else {
      const res = await msg(MSG.EXPORT_JSON, { projectId });
      content  = res.json;
      mimeType = 'application/json';
      ext      = 'json';
    }

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `validata-${projectId.slice(0, 8)}-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    _showError(`Export failed: ${err.message}`);
  }
}

// ── Project data management ────────────────────────────────────────────────────

async function _clearProjectData(projectId) {
  if (_session.active && _session.projectId === projectId) {
    _showError('Stop the active session before clearing its data.');
    return;
  }
  _clearError();
  try {
    await msg(MSG.PROJECT_CLEAR_DATA, { projectId });
    await _renderProjects();
  } catch (err) {
    _showError(`Clear failed: ${err.message}`);
  }
}

async function _deleteProject(projectId) {
  if (_session.active && _session.projectId === projectId) {
    _showError('Stop the active session before deleting its project.');
    return;
  }
  _clearError();
  try {
    await msg(MSG.PROJECT_DELETE, { projectId });
    if (_session.projectId === projectId) {
      _session.projectId = null;
      DOM.btnStart.disabled = true;
    }
    await _renderProjects();
  } catch (err) {
    _showError(`Delete failed: ${err.message}`);
  }
}

// ── New project modal ──────────────────────────────────────────────────────────

async function _openModal() {
  let defaults = { captureTimestamp: true, captureUrl: true, captureComments: false };
  try {
    const res = await msg(MSG.SCHEMA_DEFAULT_GET);
    if (res.defaults) defaults = res.defaults;
  } catch { /* fall back to hardcoded defaults */ }

  DOM.inputName.value         = '';
  DOM.schemaTimestamp.checked = defaults.captureTimestamp !== false;
  DOM.schemaUrl.checked       = defaults.captureUrl       !== false;
  DOM.schemaComments.checked  = defaults.captureComments  === true;
  DOM.modalBackdrop.classList.remove('hidden');
  DOM.inputName.focus();
}

async function _saveAsDefault() {
  const schemaConfig = {
    captureTimestamp: DOM.schemaTimestamp.checked,
    captureUrl:       DOM.schemaUrl.checked,
    captureComments:  DOM.schemaComments.checked,
  };
  try {
    await msg(MSG.SCHEMA_DEFAULT_SET, { schemaConfig });
    DOM.btnSaveDefault.textContent = 'Saved!';
    setTimeout(() => { DOM.btnSaveDefault.textContent = 'Save as default'; }, 1500);
  } catch (err) {
    _showError(`Could not save defaults: ${err.message}`);
  }
}

function _closeModal() {
  DOM.modalBackdrop.classList.add('hidden');
  _clearError();
}

async function _createProject() {
  const name = DOM.inputName.value.trim();
  if (!name) { _showError('Please enter a project name.'); DOM.inputName.focus(); return; }

  const schemaConfig = {
    captureTimestamp: DOM.schemaTimestamp.checked,
    captureUrl:       DOM.schemaUrl.checked,
    captureComments:  DOM.schemaComments.checked,
  };

  DOM.btnModalCreate.disabled    = true;
  DOM.btnModalCreate.textContent = 'Creating…';

  try {
    await msg(MSG.PROJECT_CREATE, { name, schemaConfig });
    _closeModal();
    await _renderProjects();
  } catch (err) {
    _showError(`Could not create project: ${err.message}`);
  } finally {
    DOM.btnModalCreate.disabled    = false;
    DOM.btnModalCreate.textContent = 'Create Project';
  }
}
