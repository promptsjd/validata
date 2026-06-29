/**
 * storage.service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all chrome.storage.local operations.
 * Exposes a global `StorageService` object so both content scripts (injected
 * via manifest content_scripts array) and background.js (via chrome.scripting)
 * can import from the same namespace without module bundling.
 *
 * Storage key layout
 * ──────────────────
 *   "vd_projects"          → Project[]          (project index)
 *   "vd_nodes_<projectId>" → CapturedNode[]     (per-project node array)
 *
 * Relational model
 * ────────────────
 *   Project 1──* CapturedNode
 *   CapturedNode.parentId → CapturedNode.id  (null = root post)
 *
 * All functions are async and return plain values (no callbacks).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const StorageService = (() => {

  // ── Storage key helpers ────────────────────────────────────────────────────

  const PROJECTS_KEY    = 'vd_projects';
  const DEFAULT_SCHEMA_KEY = 'vd_default_schema';
  const nodesKey = (projectId) => `vd_nodes_${projectId}`;

  // ── UUID generator (high-entropy, no external dependency) ─────────────────
  // Uses crypto.randomUUID when available (MV3 service workers always have it);
  // falls back to a Math.random-based hex string for content-script contexts
  // that may run before the page's crypto API is fully warm.
  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: timestamp + random segment
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Low-level chrome.storage wrappers ─────────────────────────────────────
  // Promisified so callers can use async/await instead of nested callbacks.
  // MV3 chrome.storage already returns Promises in Chrome 102+, but we wrap
  // for safety across versions.

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(result);
      });
    });
  }

  function storageSet(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  }

  // ── Project helpers ────────────────────────────────────────────────────────

  /**
   * Reads the full project index array from storage.
   * Returns [] if storage is empty (first-run state).
   */
  async function _readProjects() {
    const result = await storageGet(PROJECTS_KEY);
    return result[PROJECTS_KEY] || [];
  }

  /**
   * Overwrites the project index array atomically.
   */
  async function _writeProjects(projects) {
    await storageSet({ [PROJECTS_KEY]: projects });
  }

  // ── Default schema config ──────────────────────────────────────────────────

  const SCHEMA_FALLBACK = { captureTimestamp: true, captureUrl: true, captureComments: false };

  async function getDefaultSchema() {
    const result = await storageGet(DEFAULT_SCHEMA_KEY);
    return result[DEFAULT_SCHEMA_KEY] || { ...SCHEMA_FALLBACK };
  }

  async function setDefaultSchema(schemaConfig) {
    await storageSet({
      [DEFAULT_SCHEMA_KEY]: {
        captureTimestamp: schemaConfig.captureTimestamp !== false,
        captureUrl:       schemaConfig.captureUrl       !== false,
        captureComments:  schemaConfig.captureComments  === true,
      },
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * initProject(name, schemaConfig)
   * Creates a new project entry in the project index.
   *
   * @param {string} name - Human-readable project label
   * @param {Object} schemaConfig - Toggle flags for capture fields
   *   {
   *     captureTitle:    boolean,
   *     captureBody:     boolean,
   *     captureTime:     boolean,
   *     captureReplies:  boolean
   *   }
   * @returns {Promise<Project>} The newly created project object
   *
   * No two projects share an ID; name duplication is allowed (users may want
   * separate runs of the same subreddit).
   */
  async function initProject(name, schemaConfig = {}) {
    const projects = await _readProjects();
    const defaults = await getDefaultSchema();

    const project = {
      id: generateId(),
      name: name.trim() || 'Untitled Project',
      createdAt: new Date().toISOString(),
      schemaConfig: {
        captureTimestamp: schemaConfig.captureTimestamp !== undefined ? schemaConfig.captureTimestamp !== false : defaults.captureTimestamp,
        captureUrl:       schemaConfig.captureUrl       !== undefined ? schemaConfig.captureUrl       !== false : defaults.captureUrl,
        captureComments:  schemaConfig.captureComments  !== undefined ? schemaConfig.captureComments  === true  : defaults.captureComments,
      },
      nodeCount:  0,
      postCount:  0,
      replyCount: 0,
    };

    projects.push(project);
    await _writeProjects(projects);
    return project;
  }

  /**
   * updateProject(projectId, schemaConfig)
   * Merges new schemaConfig into an existing project.
   */
  async function updateProject(projectId, schemaConfig) {
    const projects = await _readProjects();
    const idx = projects.findIndex(p => p.id === projectId);
    if (idx === -1) throw new Error('Project not found.');
    projects[idx].schemaConfig = {
      ...projects[idx].schemaConfig,
      ...schemaConfig,
    };
    await _writeProjects(projects);
    return projects[idx];
  }

  /**
   * getAllProjects()
   * Returns the full project index sorted newest-first.
   *
   * @returns {Promise<Project[]>}
   */
  async function getAllProjects() {
    const projects = await _readProjects();
    return projects.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * getProject(projectId)
   * Returns a single project by ID, or null if not found.
   */
  async function getProject(projectId) {
    const projects = await _readProjects();
    return projects.find(p => p.id === projectId) || null;
  }

  /**
   * appendNode(projectId, nodePayload)
   * Appends one captured node to the project's node array and increments
   * the project's nodeCount in the index — both writes happen atomically
   * via a single storageSet call to prevent race conditions when the user
   * clicks rapidly.
   *
   * @param {string} projectId
   * @param {Object} nodePayload - Partial node; id and projectId are injected here
   *   {
   *     type:          'post' | 'reply',
   *     parentId:      string | null,
   *     text:          string,
   *     url:           string,
   *     postTitle:     string,
   *     timestampISO:  string
   *   }
   * @returns {Promise<CapturedNode>} The fully formed node as stored
   */
  async function appendNode(projectId, nodePayload) {
    const key = nodesKey(projectId);

    // Read nodes and project index in parallel — no ordering dependency here.
    const [nodesResult, projects] = await Promise.all([
      storageGet(key),
      _readProjects(),
    ]);

    const nodes = nodesResult[key] || [];

    const node = {
      id:           generateId(),
      projectId,
      type:         nodePayload.type || 'post',
      parentId:     nodePayload.parentId || null,
      text:         (nodePayload.text || '').trim(),
      url:          nodePayload.url ?? '',
      postTitle:    nodePayload.postTitle || '',
      timestampISO: nodePayload.timestampISO ?? new Date().toISOString(),
    };

    nodes.push(node);

    // Update counts on the matching project entry.
    const projectIndex = projects.findIndex(p => p.id === projectId);
    if (projectIndex !== -1) {
      const proj = projects[projectIndex];
      proj.nodeCount = nodes.length;
      if (node.type === 'post') {
        proj.postCount  = (proj.postCount  || 0) + 1;
      } else {
        proj.replyCount = (proj.replyCount || 0) + 1;
      }
    }

    // Single atomic write prevents partial-state reads by background.js.
    await storageSet({
      [key]: nodes,
      [PROJECTS_KEY]: projects,
    });

    return node;
  }

  /**
   * getNodes(projectId)
   * Returns all nodes for a project, preserving insertion order.
   *
   * @returns {Promise<CapturedNode[]>}
   */
  async function getNodes(projectId) {
    const key = nodesKey(projectId);
    const result = await storageGet(key);
    return result[key] || [];
  }

  /**
   * clearProjectData(projectId)
   * Clears all nodes for a project and resets its counts to zero.
   * The project entry itself is preserved.
   */
  async function clearProjectData(projectId) {
    const projects = await _readProjects();
    const idx = projects.findIndex(p => p.id === projectId);
    if (idx !== -1) {
      projects[idx].nodeCount  = 0;
      projects[idx].postCount  = 0;
      projects[idx].replyCount = 0;
      await _writeProjects(projects);
    }
    await new Promise((resolve, reject) => {
      chrome.storage.local.remove(nodesKey(projectId), () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  }

  /**
   * deleteProject(projectId)
   * Removes the project entry and its associated node store.
   * Irreversible — callers should confirm with the user before invoking.
   */
  async function deleteProject(projectId) {
    const projects = await _readProjects();
    const filtered = projects.filter(p => p.id !== projectId);
    await Promise.all([
      _writeProjects(filtered),
      new Promise((resolve, reject) => {
        chrome.storage.local.remove(nodesKey(projectId), () => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve();
        });
      }),
    ]);
  }

  /**
   * exportToCSV(projectId)
   * Serialises all nodes for a project into a RFC 4180-compliant CSV string.
   * Columns: id, projectId, type, parentId, postTitle, text, url, timestampISO
   *
   * Values containing commas or double-quotes are double-quote escaped.
   * Caller is responsible for triggering the browser download.
   *
   * @returns {Promise<string>} Raw CSV string
   */
  async function exportToCSV(projectId) {
    const nodes = await getNodes(projectId);

    const COLUMNS = ['id', 'projectId', 'type', 'parentId', 'postTitle', 'text', 'url', 'timestampISO'];

    // Escape a single CSV cell value.
    const escape = (val) => {
      const str = val == null ? '' : String(val);
      // Wrap in quotes if value contains comma, newline, or double-quote.
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = COLUMNS.join(',');
    const rows = nodes.map(node =>
      COLUMNS.map(col => escape(node[col])).join(',')
    );

    return [header, ...rows].join('\r\n');
  }

  /**
   * exportToJSON(projectId)
   * Returns a formatted JSON string of all nodes for a project.
   * Useful as an alternative export format; caller triggers the download.
   *
   * @returns {Promise<string>} Formatted JSON string
   */
  async function exportToJSON(projectId) {
    const [project, nodes] = await Promise.all([
      getProject(projectId),
      getNodes(projectId),
    ]);
    return JSON.stringify({ project, nodes }, null, 2);
  }

  // ── Public surface ─────────────────────────────────────────────────────────
  return {
    initProject,
    updateProject,
    getAllProjects,
    getProject,
    appendNode,
    getNodes,
    clearProjectData,
    deleteProject,
    exportToCSV,
    exportToJSON,
    getDefaultSchema,
    setDefaultSchema,
  };

})();

// Global for content scripts (injected as plain scripts via manifest).
if (typeof window !== 'undefined') {
  window.StorageService = StorageService;
}

// Named ES module exports for background.js (service worker module import).
export const {
  initProject,
  updateProject,
  getAllProjects,
  getProject,
  appendNode,
  getNodes,
  clearProjectData,
  deleteProject,
  exportToCSV,
  exportToJSON,
  getDefaultSchema,
  setDefaultSchema,
} = StorageService;
