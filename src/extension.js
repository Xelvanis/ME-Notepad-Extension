const STORAGE_KEY = "marinara-local-chat-notepad-v1";
const ACTIVE_CHAT_KEY = "marinara-active-chat-id";
const MOBILE_MEDIA_QUERY = "(max-width: 640px)";
const MIN_PANEL_WIDTH = 240;
const MIN_PANEL_HEIGHT = 360;
const COLLAPSED_LAUNCHER_WIDTH = 92;
const PANEL_MARGIN = 12;

const DEFAULT_TAB = {
  id: "tab-notes",
  title: "Notes",
  scope: "chat",
  branchMode: "branch",
  characterId: null,
  chatId: null,
  groupId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let state = loadState();
let context = {
  chatId: null,
  chat: null,
  charactersById: new Map(),
  charactersLoaded: false,
};
let root = null;
let panel = null;
let launcher = null;
let statusEl = null;
let statusTextEl = null;
let textarea = null;
let refreshToken = 0;
let addMenuOpen = false;
let actionsMenuOpen = false;
let renamingTabId = null;
let pendingDeleteTabId = null;
let pendingImportState = null;
let statusMessage = "";
let statusTone = "muted";
let draggedTab = null;
let suppressTabClickUntil = 0;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const tabs = (Array.isArray(parsed.tabs) ? parsed.tabs : [{ ...DEFAULT_TAB }]).map(normalizeTab);
    const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0]?.id || null;
    return {
      version: 1,
      open: Boolean(parsed.open),
      activeTabId,
      tabs,
      notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
      viewMode: parsed.viewMode === "preview" ? "preview" : "edit",
      tabsCollapsed: Boolean(parsed.tabsCollapsed),
      layout: normalizeLayout(parsed.layout),
    };
  } catch {
    return {
      version: 1,
      open: false,
      activeTabId: DEFAULT_TAB.id,
      tabs: [{ ...DEFAULT_TAB }],
      notes: {},
      viewMode: "edit",
      tabsCollapsed: false,
      layout: normalizeLayout(null),
    };
  }
}

function normalizeTab(tab) {
  tab = tab && typeof tab === "object" ? tab : {};
  const scope = ["global", "character", "chat"].includes(tab.scope) ? tab.scope : "chat";
  const branchMode = ["branch", "family"].includes(tab.branchMode) ? tab.branchMode : "branch";
  return {
    id: typeof tab.id === "string" && tab.id ? tab.id : makeId("tab"),
    title: typeof tab.title === "string" && tab.title.trim() ? tab.title.trim() : "Notes",
    scope,
    branchMode,
    characterId: typeof tab.characterId === "string" && tab.characterId ? tab.characterId : null,
    chatId: typeof tab.chatId === "string" && tab.chatId ? tab.chatId : null,
    groupId: typeof tab.groupId === "string" && tab.groupId ? tab.groupId : null,
    createdAt: typeof tab.createdAt === "string" ? tab.createdAt : new Date().toISOString(),
    updatedAt: typeof tab.updatedAt === "string" ? tab.updatedAt : new Date().toISOString(),
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    setStatus("Could not save. Browser local storage may be full.", "error");
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function viewportSize() {
  return {
    width: Math.max(document.documentElement.clientWidth || window.innerWidth || 1024, MIN_PANEL_WIDTH),
    height: Math.max(document.documentElement.clientHeight || window.innerHeight || 720, MIN_PANEL_HEIGHT),
  };
}

function getDefaultLayout() {
  const viewport = viewportSize();
  const width = Math.min(384, viewport.width - PANEL_MARGIN * 2);
  const height = Math.min(560, viewport.height - PANEL_MARGIN * 4);
  return {
    width,
    height,
    x: Math.max(PANEL_MARGIN, viewport.width - width - 16),
    y: Math.max(PANEL_MARGIN, viewport.height - height - 84),
  };
}

function normalizeLayout(raw) {
  const fallback = getDefaultLayout();
  const layout = raw && typeof raw === "object" ? raw : {};
  return constrainLayout({
    x: Number.isFinite(layout.x) ? layout.x : fallback.x,
    y: Number.isFinite(layout.y) ? layout.y : fallback.y,
    width: Number.isFinite(layout.width) ? layout.width : fallback.width,
    height: Number.isFinite(layout.height) ? layout.height : fallback.height,
  });
}

function constrainLayout(layout) {
  const viewport = viewportSize();
  const fallback = getDefaultLayout();
  const maxWidth = Math.max(240, viewport.width - PANEL_MARGIN * 2);
  const maxHeight = Math.max(300, viewport.height - PANEL_MARGIN * 2);
  const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_PANEL_HEIGHT, maxHeight);
  const width = clamp(Number.isFinite(layout.width) ? layout.width : fallback.width, minWidth, maxWidth);
  const height = clamp(Number.isFinite(layout.height) ? layout.height : fallback.height, minHeight, maxHeight);
  return {
    width,
    height,
    x: clamp(Number.isFinite(layout.x) ? layout.x : fallback.x, PANEL_MARGIN, viewport.width - width - PANEL_MARGIN),
    y: clamp(Number.isFinite(layout.y) ? layout.y : fallback.y, PANEL_MARGIN, viewport.height - height - PANEL_MARGIN),
  };
}

function isMobileLayout() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function applyLayout() {
  if (!root) return;

  if (isMobileLayout()) {
    root.removeAttribute("style");
    root.dataset.layout = "launcher";
    return;
  }

  state.layout = constrainLayout(state.layout);
  root.dataset.layout = state.open ? "panel" : "collapsed";
  root.style.left = `${state.layout.x}px`;
  root.style.top = `${state.layout.y}px`;
  root.style.right = "auto";
  root.style.bottom = "auto";
  root.style.width = `${state.open ? state.layout.width : COLLAPSED_LAUNCHER_WIDTH}px`;
  root.style.height = state.open ? `${state.layout.height}px` : "auto";
}

function resetLayout() {
  state.layout = getDefaultLayout();
  saveState();
  render();
  setStatus("Layout reset", "ok");
}

function parseArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseCharacterName(row) {
  if (typeof row?.name === "string" && row.name.trim()) return row.name.trim();
  try {
    const data = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data;
    if (typeof data?.name === "string" && data.name.trim()) return data.name.trim();
  } catch {
    // Ignore malformed character rows from older imports.
  }
  return "Unknown character";
}

function normalizeChat(raw) {
  if (!raw || raw.error) return null;
  return {
    ...raw,
    characterIds: parseArray(raw.characterIds),
    metadata: typeof raw.metadata === "string" ? safeJson(raw.metadata, {}) : raw.metadata || {},
  };
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

async function loadCharacters() {
  if (context.charactersLoaded) return;
  try {
    const rows = await marinara.apiFetch("/characters");
    const next = new Map();
    if (Array.isArray(rows)) {
      rows.forEach((row) => {
        if (typeof row?.id === "string") {
          next.set(row.id, { id: row.id, name: parseCharacterName(row) });
        }
      });
    }
    context = { ...context, charactersById: next, charactersLoaded: true };
  } catch {
    context = { ...context, charactersLoaded: true };
  }
}

async function refreshContext(force = false) {
  const chatId = localStorage.getItem(ACTIVE_CHAT_KEY) || null;
  if (!force && chatId === context.chatId) return;

  const token = ++refreshToken;
  await loadCharacters();

  if (!chatId) {
    context = { ...context, chatId: null, chat: null };
    render();
    return;
  }

  try {
    const chat = normalizeChat(await marinara.apiFetch(`/chats/${encodeURIComponent(chatId)}`));
    if (token !== refreshToken) return;
    context = { ...context, chatId, chat };
  } catch {
    if (token !== refreshToken) return;
    context = { ...context, chatId, chat: null };
  }
  ensureCharacterTabFitsContext();
  ensureChatTabTargets();
  render();
}

function getCharacterLabel(id) {
  return context.charactersById.get(id)?.name || `Character ${id.slice(0, 6)}`;
}

function getCurrentCharacterIds() {
  return context.chat?.characterIds || [];
}

function titleForScope(scope, characterId, branchMode = "branch") {
  if (scope === "global") return "Global";
  if (scope === "character") return characterId ? getCharacterLabel(characterId) : "Character";
  if (scope === "chat" && context.chat?.groupId && branchMode === "family") return "Branch-wide";
  if (scope === "chat") return "Chat";
  return "Notes";
}

function isBranchSpecificTab(tab) {
  return Boolean(tab?.scope === "chat" && tab.branchMode !== "family" && (tab.groupId || context.chat?.groupId));
}

function labelForTabTarget(tab) {
  if (tab?.scope === "chat") {
    if (tab.branchMode === "family") return "branch-wide scope";
    return "this chat";
  }
  return fullLabelForScope(tab?.scope || "chat").toLowerCase();
}

function labelForScope(scope) {
  if (scope === "global") return "ALL";
  if (scope === "character") return "CHAR";
  return "CHAT";
}

function fullLabelForScope(scope) {
  if (scope === "global") return "Global";
  if (scope === "character") return "Character";
  return "Chat";
}

function tooltipForScopeLabel(scope) {
  if (scope === "character") {
    const characterNames = getCurrentCharacterIds().map((id) => getCharacterLabel(id));
    if (characterNames.length > 0) return characterNames.join(", ");
  }
  return fullLabelForScope(scope);
}

function uniqueTabTitle(base) {
  const cleanBase = (base || "Notes").trim() || "Notes";
  const existing = new Set(state.tabs.map((tab) => tab.title.trim().toLowerCase()));
  if (!existing.has(cleanBase.toLowerCase())) return cleanBase;

  let index = 2;
  while (existing.has(`${cleanBase} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${cleanBase} ${index}`;
}

function hasNoteForScopeKey(tab, scopeKey) {
  return Object.prototype.hasOwnProperty.call(state.notes, `${tab.id}::${scopeKey}`);
}

function inferCharacterTargetFromNotes(tab) {
  const prefix = `${tab.id}::character:`;
  const key = Object.keys(state.notes).find((item) => item.startsWith(prefix));
  return key ? key.slice(prefix.length) || null : null;
}

function inferChatTargetFromNotes(tab) {
  const prefix = `${tab.id}::`;
  const scopeKeys = Object.keys(state.notes)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
  const currentBranchKey = context.chat?.id ? `chat:${context.chat.id}` : null;
  const currentFamilyKey = context.chat?.groupId ? `chat-family:${context.chat.groupId}` : null;
  const preferredKey =
    (tab.branchMode === "family" && currentFamilyKey && scopeKeys.includes(currentFamilyKey) && currentFamilyKey) ||
    (tab.branchMode !== "family" && currentBranchKey && scopeKeys.includes(currentBranchKey) && currentBranchKey) ||
    scopeKeys.find((scopeKey) => (tab.branchMode === "family" ? scopeKey.startsWith("chat-family:") : scopeKey.startsWith("chat:"))) ||
    scopeKeys.find((scopeKey) => scopeKey.startsWith("chat-family:") || scopeKey.startsWith("chat:"));

  if (!preferredKey) return null;
  if (preferredKey.startsWith("chat-family:")) {
    return { branchMode: "family", groupId: preferredKey.slice("chat-family:".length) || null };
  }
  if (preferredKey.startsWith("chat:")) {
    return { branchMode: "branch", chatId: preferredKey.slice("chat:".length) || null };
  }
  return null;
}

function ensureCharacterTabFitsContext() {
  const ids = getCurrentCharacterIds();
  if (ids.length === 0) return;
  let changed = false;
  state.tabs = state.tabs.map((tab) => {
    if (tab.scope !== "character") return tab;
    if (tab.characterId) return tab;
    const characterId = inferCharacterTargetFromNotes(tab) || (tab.id === state.activeTabId ? ids[0] : null);
    if (!characterId) return tab;
    changed = true;
    return { ...tab, characterId, updatedAt: new Date().toISOString() };
  });
  if (changed) saveState();
}

function ensureChatTabTargets() {
  const chat = context.chat;
  if (!chat?.id) return;

  let changed = false;
  state.tabs = state.tabs.map((tab) => {
    if (tab.scope !== "chat") return tab;

    if (tab.branchMode === "family") {
      if (tab.groupId) return tab;
      const inferred = inferChatTargetFromNotes(tab);
      const groupId = inferred?.groupId || (tab.id === state.activeTabId ? chat.groupId || chat.id : null);
      if (!groupId) return tab;
      changed = true;
      return { ...tab, chatId: null, groupId, updatedAt: new Date().toISOString() };
    }

    if (tab.chatId) return tab;
    const inferred = inferChatTargetFromNotes(tab);
    const chatId = inferred?.chatId || (tab.id === state.activeTabId ? chat.id : null);
    if (!chatId) return tab;
    changed = true;
    return { ...tab, chatId, groupId: tab.groupId || chat.groupId || null, updatedAt: new Date().toISOString() };
  });

  if (changed) saveState();
}

function isTabRelevant(tab) {
  const chat = context.chat;
  if (tab.scope === "global") return true;

  if (tab.scope === "character") {
    const ids = getCurrentCharacterIds();
    if (tab.characterId) return ids.includes(tab.characterId);
    return ids.some((id) => hasNoteForScopeKey(tab, `character:${id}`));
  }

  if (tab.scope === "chat") {
    if (!chat?.id) return false;

    if (tab.branchMode === "family") {
      const currentGroupId = chat.groupId || chat.id;
      const currentFamilyKey = chat.groupId ? `chat-family:${chat.groupId}` : null;
      return Boolean(
        (tab.groupId && tab.groupId === currentGroupId) || (currentFamilyKey && hasNoteForScopeKey(tab, currentFamilyKey)),
      );
    }

    return Boolean(tab.chatId === chat.id || hasNoteForScopeKey(tab, `chat:${chat.id}`));
  }

  return false;
}

function getVisibleTabs() {
  return state.tabs.filter(isTabRelevant);
}

function ensureActiveTabRelevant(visibleTabs = getVisibleTabs()) {
  if (visibleTabs.length === 0) return null;
  const activeTab = visibleTabs.find((tab) => tab.id === state.activeTabId);
  if (activeTab) return activeTab;

  renamingTabId = null;
  state.activeTabId = visibleTabs[0].id;
  saveState();
  return visibleTabs[0];
}

function resolveScope(tab) {
  const chat = context.chat;

  if (tab.scope === "global") {
    return {
      key: "global",
      label: "Every chat",
      placeholder: "Write anything you want available everywhere in Marinara.",
    };
  }

  if (tab.scope === "character") {
    const ids = getCurrentCharacterIds();
    const characterId = tab.characterId || ids.find((id) => hasNoteForScopeKey(tab, `character:${id}`)) || ids[0] || null;
    if (!characterId) {
      return {
        key: "character:none",
        label: "Needs character chat",
        placeholder: "This tab saves per character once the active chat has a character.",
      };
    }
    const name = getCharacterLabel(characterId);
    return {
      key: `character:${characterId}`,
      label: "All chats with character",
      placeholder: `Notes for ${name}.`,
    };
  }

  if (!chat?.id) {
    return {
      key: "chat:none",
      label: "Open a chat",
      placeholder: "This tab saves to the active chat once you open one.",
    };
  }

  if (tab.branchMode === "family") {
    const currentFamilyKey = chat.groupId ? `chat-family:${chat.groupId}` : null;
    const groupId = tab.groupId || chat.groupId || chat.id;
    return {
      key: currentFamilyKey && hasNoteForScopeKey(tab, currentFamilyKey) ? currentFamilyKey : `chat-family:${groupId}`,
      label: "Branch-wide",
      placeholder: "Notes shared across every branch of this chat.",
    };
  }

  const currentBranchKey = `chat:${chat.id}`;
  const chatId = tab.chatId || chat.id;
  return {
    key: hasNoteForScopeKey(tab, currentBranchKey) ? currentBranchKey : `chat:${chatId}`,
    label: "This chat",
    placeholder: "Notes for this chat.",
  };
}

function getNoteKey(tab) {
  return `${tab.id}::${resolveScope(tab).key}`;
}

function getCurrentNote(tab) {
  return state.notes[getNoteKey(tab)] || "";
}

function setCurrentNote(tab, value) {
  state.notes[getNoteKey(tab)] = value;
  tab.updatedAt = new Date().toISOString();
  saveState();
}

function makeBackupPayload() {
  return {
    type: "marinara-local-chat-notepad-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    data: {
      version: state.version,
      activeTabId: state.activeTabId,
      tabs: state.tabs,
      notes: state.notes,
      viewMode: state.viewMode,
      tabsCollapsed: Boolean(state.tabsCollapsed),
      layout: state.layout,
    },
  };
}

function exportBackup() {
  const payload = makeBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.href = url;
  link.download = `marinara-notepad-backup-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Backup downloaded", "ok");
}

function normalizeImportedState(payload) {
  const envelope = getPlainObject(payload);
  const imported = getPlainObject(envelope?.data) || envelope;
  if (!imported) throw new Error("Backup file is not a JSON object.");

  const tabs = Array.isArray(imported.tabs) ? imported.tabs.map(normalizeTab) : [];
  if (tabs.length === 0) throw new Error("Backup file does not contain any notepad tabs.");

  const notes = getPlainObject(imported.notes);
  if (!notes) throw new Error("Backup file does not contain notepad data.");

  const activeTabId =
    typeof imported.activeTabId === "string" && tabs.some((tab) => tab.id === imported.activeTabId)
      ? imported.activeTabId
      : tabs[0].id;

  return {
    version: 1,
    open: true,
    activeTabId,
    tabs,
    notes: { ...notes },
    viewMode: imported.viewMode === "preview" ? "preview" : "edit",
    tabsCollapsed: Boolean(imported.tabsCollapsed),
    layout: normalizeLayout(imported.layout),
  };
}

function importBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      pendingImportState = normalizeImportedState(parsed);
      addMenuOpen = false;
      actionsMenuOpen = false;
      pendingDeleteTabId = null;
      render();
    } catch (error) {
      addMenuOpen = false;
      actionsMenuOpen = false;
      pendingDeleteTabId = null;
      pendingImportState = null;
      setStatus(error instanceof Error ? error.message : "Backup import failed.", "error");
      render();
    }
  });
  input.click();
}

function setStatus(message, tone = "muted") {
  statusMessage = message;
  statusTone = tone;
  if (!statusEl) return;
  if (statusTextEl) statusTextEl.textContent = message;
  statusEl.dataset.tone = tone;
  statusEl.hidden = !message;
}

function dismissStatus() {
  setStatus("");
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function createButton(className, text, title, onClick) {
  const button = createElement("button", className, text);
  button.type = "button";
  if (title) {
    button.title = title;
    button.setAttribute("aria-label", title);
  }
  button.addEventListener("click", onClick);
  return button;
}

function closeOpenMenus() {
  if (!addMenuOpen && !actionsMenuOpen) return false;
  addMenuOpen = false;
  actionsMenuOpen = false;
  panel?.querySelector(".mn-notepad-add-menu")?.remove();
  panel?.querySelector(".mn-notepad-actions-menu")?.remove();
  return true;
}

function handlePanelMenuClose(event) {
  if (!addMenuOpen && !actionsMenuOpen) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".mn-notepad-add-wrap, .mn-notepad-actions-wrap")) return;
  closeOpenMenus();
}

function createNotepadBrand(tag = "span") {
  const brand = createElement(tag, "mn-notepad-brand");
  const icon = createElement("img", "mn-notepad-brand-icon");
  icon.src = "/favicon.png";
  icon.alt = "";
  icon.draggable = false;
  icon.setAttribute("aria-hidden", "true");
  brand.append(icon, createElement("span", "mn-notepad-brand-label", "Notes"));
  return brand;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function sanitizeMarkdownUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) return "";
  if (clean.startsWith("#")) return escapeAttribute(clean);

  try {
    const parsed = new URL(clean, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? escapeAttribute(clean) : "";
  } catch {
    return "";
  }
}

function renderSimpleMarkdownInline(raw) {
  const placeholders = [];
  const stash = (html) => {
    const token = `%%MNPH${placeholders.length}%%`;
    placeholders.push([token, html]);
    return token;
  };

  let staged = String(raw || "").replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${escapeHtml(code)}</code>`));
  let html = escapeHtml(staged);
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/g, "<u>$1</u>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  for (const [token, replacement] of placeholders) {
    html = html.replaceAll(token, replacement);
  }
  return html;
}

function renderMarkdownInline(raw) {
  const text = String(raw || "");
  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = "";
  let cursor = 0;
  let match;

  while ((match = linkPattern.exec(text))) {
    html += renderSimpleMarkdownInline(text.slice(cursor, match.index));
    const href = sanitizeMarkdownUrl(match[2]);
    html += href
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${renderSimpleMarkdownInline(match[1])}</a>`
      : renderSimpleMarkdownInline(match[0]);
    cursor = match.index + match[0].length;
  }

  html += renderSimpleMarkdownInline(text.slice(cursor));
  return html;
}

function renderMarkdown(raw) {
  const text = String(raw || "");
  if (!text.trim()) return '<p class="mn-notepad-preview-empty">Nothing to preview yet.</p>';

  const html = [];
  let listType = null;
  let listClass = "";

  const closeList = () => {
    if (!listType) return;
    html.push(listType === "ol" ? "</ol>" : "</ul>");
    listType = null;
    listClass = "";
  };

  const openList = (type, className = "") => {
    if (listType === type && listClass === className) return;
    closeList();
    listType = type;
    listClass = className;
    html.push(`<${type}${className ? ` class="${className}"` : ""}>`);
  };

  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim()) {
      closeList();
      html.push('<div class="mn-notepad-preview-gap"></div>');
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      continue;
    }

    const checklist = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (checklist) {
      openList("ul", "mn-notepad-preview-checklist");
      const checked = checklist[1].toLowerCase() === "x";
      html.push(
        `<li><button type="button" class="mn-notepad-preview-check" data-line-index="${lineIndex}" data-checked="${checked ? "true" : "false"}" aria-label="${
          checked ? "Mark checklist item incomplete" : "Mark checklist item complete"
        }"></button>${renderMarkdownInline(
          checklist[2],
        )}</li>`,
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      openList("ul");
      html.push(`<li>${renderMarkdownInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      openList("ol");
      html.push(`<li>${renderMarkdownInline(ordered[1])}</li>`);
      continue;
    }

    const quote = line.match(/^\s*>\s+(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderMarkdownInline(line)}</p>`);
  }

  closeList();
  return html.join("");
}

function setViewMode(mode) {
  state.viewMode = mode === "preview" ? "preview" : "edit";
  saveState();
  render();
}

function applyTextFormat(tab, prefix, suffix = prefix, fallback = "text") {
  if (!tab || !textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const selected = textarea.value.slice(start, end);
  const inner = selected || fallback;
  const insert = `${prefix}${inner}${suffix}`;
  textarea.value = `${textarea.value.slice(0, start)}${insert}${textarea.value.slice(end)}`;
  setCurrentNote(tab, textarea.value);
  textarea.focus();
  const selectionStart = selected ? start + insert.length : start + prefix.length;
  const selectionEnd = selected ? selectionStart : selectionStart + inner.length;
  textarea.setSelectionRange(selectionStart, selectionEnd);
}

function applyListPrefix(tab, prefix, stripPattern) {
  if (!tab || !textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const value = textarea.value;

  if (start !== end) {
    const selected = value.slice(start, end);
    const transformed = selected
      .split("\n")
      .map((line) => (line.trim() ? `${prefix}${line.replace(stripPattern, "")}` : line))
      .join("\n");
    textarea.value = `${value.slice(0, start)}${transformed}${value.slice(end)}`;
    setCurrentNote(tab, textarea.value);
    textarea.focus();
    textarea.setSelectionRange(start, start + transformed.length);
    return;
  }

  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLine = value.indexOf("\n", start);
  const lineEnd = nextLine === -1 ? value.length : nextLine;
  const line = value.slice(lineStart, lineEnd);
  const transformed = line.trim() ? `${prefix}${line.replace(stripPattern, "")}` : prefix;
  textarea.value = `${value.slice(0, lineStart)}${transformed}${value.slice(lineEnd)}`;
  setCurrentNote(tab, textarea.value);
  textarea.focus();
  textarea.setSelectionRange(lineStart + transformed.length, lineStart + transformed.length);
}

function applyBulletFormat(tab) {
  applyListPrefix(tab, "- ", /^\s*([-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/);
}

function applyChecklistFormat(tab) {
  applyListPrefix(tab, "- [ ] ", /^\s*([-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/);
}

function togglePreviewChecklist(tab, lineIndex) {
  if (!tab || !Number.isInteger(lineIndex)) return;
  const lines = getCurrentNote(tab).split(/\r?\n/);
  const line = lines[lineIndex];
  if (typeof line !== "string") return;

  const toggled = line.replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+.+)$/, (_match, prefix, mark, suffix) => {
    return `${prefix}${mark.toLowerCase() === "x" ? " " : "x"}${suffix}`;
  });

  if (toggled === line) return;
  lines[lineIndex] = toggled;
  setCurrentNote(tab, lines.join("\n"));
  render();
}

function createFormatButton(text, title, disabled, handler, extraClass = "") {
  const button = createButton(`mn-notepad-format-button${extraClass ? ` ${extraClass}` : ""}`, text, title, (event) => {
    event.stopPropagation();
    handler();
  });
  button.disabled = disabled;
  return button;
}

function createFormatToolbar(tab) {
  const toolbar = createElement("div", "mn-notepad-formatbar");
  const formatGroup = createElement("div", "mn-notepad-format-group");
  const disabled = !tab || state.viewMode === "preview";

  formatGroup.append(
    createFormatButton("B", "Bold selected text", disabled, () => applyTextFormat(tab, "**", "**"), "mn-notepad-format-bold"),
    createFormatButton("I", "Italicize selected text", disabled, () => applyTextFormat(tab, "*", "*"), "mn-notepad-format-italic"),
    createFormatButton("U", "Underline selected text", disabled, () => applyTextFormat(tab, "__", "__"), "mn-notepad-format-underline"),
    createFormatButton("S", "Strikethrough selected text", disabled, () => applyTextFormat(tab, "~~", "~~"), "mn-notepad-format-strike"),
    createFormatButton("", "Add bullet list item", disabled, () => applyBulletFormat(tab), "mn-notepad-format-icon mn-notepad-format-bullet"),
    createFormatButton("", "Add a checklist item", disabled, () => applyChecklistFormat(tab), "mn-notepad-format-icon mn-notepad-format-check"),
  );

  const modeGroup = createElement("div", "mn-notepad-mode-group");
  const currentMode = state.viewMode === "preview" ? "preview" : "edit";
  const nextMode = currentMode === "preview" ? "edit" : "preview";
  const modeButton = createFormatButton(
    "",
    currentMode === "preview" ? "Preview mode. Switch to edit" : "Edit mode. Switch to preview",
    !tab,
    () => setViewMode(nextMode),
    "mn-notepad-mode-toggle",
  );
  modeButton.dataset.mode = currentMode;
  modeButton.setAttribute("aria-pressed", currentMode === "preview" ? "true" : "false");
  modeButton.append(
    createElement("span", "mn-notepad-mode-icon mn-notepad-mode-edit-icon"),
    createElement("span", "mn-notepad-mode-icon mn-notepad-mode-preview-icon"),
  );
  modeGroup.appendChild(modeButton);

  toolbar.append(formatGroup, modeGroup);
  return toolbar;
}

function handleRenameKey(event, input) {
  if (event.key === "Enter") input.blur();
  if (event.key === "Escape") {
    event.preventDefault();
    renamingTabId = null;
    render();
  }
}

function renameTab(tab, value) {
  const title = value.trim();
  renamingTabId = null;
  if (!title || title === tab.title) {
    render();
    return;
  }
  tab.title = title;
  tab.updatedAt = new Date().toISOString();
  saveState();
  render();
  setStatus("Renamed", "ok");
}

function clearTabDropMarkers() {
  panel?.querySelectorAll(".mn-notepad-tab").forEach((tab) => {
    delete tab.dataset.dropPosition;
  });
  panel?.querySelectorAll(".mn-notepad-row-tabs").forEach((row) => {
    delete row.dataset.dropActive;
  });
}

function moveTabBeforeIndex(sourceId, insertIndex) {
  const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceId);
  if (sourceIndex === -1) return false;

  const [source] = state.tabs.splice(sourceIndex, 1);
  const normalizedIndex = sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  state.tabs.splice(clamp(normalizedIndex, 0, state.tabs.length), 0, source);
  state.activeTabId = source.id;
  renamingTabId = null;
  saveState();
  return true;
}

function moveTabRelativeToTarget(sourceId, targetId, position) {
  if (sourceId === targetId) return false;

  const source = state.tabs.find((tab) => tab.id === sourceId);
  const targetIndex = state.tabs.findIndex((tab) => tab.id === targetId);
  const target = state.tabs[targetIndex];
  if (!source || !target || source.scope !== target.scope) return false;

  return moveTabBeforeIndex(sourceId, targetIndex + (position === "after" ? 1 : 0));
}

function moveTabToScopeEnd(sourceId, scope) {
  const source = state.tabs.find((tab) => tab.id === sourceId);
  if (!source || source.scope !== scope) return false;

  const lastScopeIndex = state.tabs.reduce((lastIndex, tab, index) => (tab.scope === scope ? index : lastIndex), -1);
  if (lastScopeIndex === -1 || state.tabs[lastScopeIndex]?.id === sourceId) return false;
  return moveTabBeforeIndex(sourceId, lastScopeIndex + 1);
}

function getDropPosition(event, target) {
  const rect = target.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function createTabButton(item, activeTab, index) {
  const isActive = item.id === activeTab?.id;
  const isBranchSpecific = isBranchSpecificTab(item);
  const targetLabel = labelForTabTarget(item);
  const button = createElement("button", "mn-notepad-tab");
  button.type = "button";
  button.draggable = true;
  button.title = `${item.title} / saved for ${targetLabel}`;
  button.setAttribute("aria-label", `${item.title}, saved for ${targetLabel}, tab ${index + 1}`);
  button.dataset.scope = item.scope;
  button.dataset.branchMode = item.branchMode;
  button.dataset.tabId = item.id;
  if (isActive) button.dataset.active = "true";
  if (isBranchSpecific) button.dataset.branchSpecific = "true";

  const numberLabel = createElement("span", "mn-notepad-tab-number", String(index + 1));
  button.append(numberLabel);
  if (isActive) {
    const titleLabel = createElement("span", "mn-notepad-tab-title", item.title);
    button.append(titleLabel);
  }
  button.addEventListener("click", (event) => {
    if (Date.now() < suppressTabClickUntil) return;
    if (event.detail > 1) return;
    const wasActive = state.activeTabId === item.id;
    const wasMenuOpen = addMenuOpen;
    addMenuOpen = false;
    actionsMenuOpen = false;
    state.activeTabId = item.id;
    renamingTabId = null;
    pendingDeleteTabId = null;
    pendingImportState = null;
    saveState();
    if (wasActive && !wasMenuOpen) return;
    render();
  });
  button.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    addMenuOpen = false;
    actionsMenuOpen = false;
    state.activeTabId = item.id;
    renamingTabId = item.id;
    pendingDeleteTabId = null;
    pendingImportState = null;
    saveState();
    render();
  });
  button.addEventListener("dragstart", (event) => {
    draggedTab = { id: item.id, scope: item.scope };
    suppressTabClickUntil = Date.now() + 500;
    button.dataset.dragging = "true";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  });
  button.addEventListener("dragover", (event) => {
    if (!draggedTab || draggedTab.scope !== item.scope || draggedTab.id === item.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearTabDropMarkers();
    button.dataset.dropPosition = getDropPosition(event, button);
  });
  button.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !button.contains(event.relatedTarget)) {
      delete button.dataset.dropPosition;
    }
  });
  button.addEventListener("drop", (event) => {
    if (!draggedTab || draggedTab.scope !== item.scope || draggedTab.id === item.id) return;
    event.preventDefault();
    event.stopPropagation();
    const moved = moveTabRelativeToTarget(draggedTab.id, item.id, getDropPosition(event, button));
    draggedTab = null;
    suppressTabClickUntil = Date.now() + 500;
    clearTabDropMarkers();
    if (moved) {
      render();
      setStatus("Reordered", "ok");
    }
  });
  button.addEventListener("dragend", () => {
    draggedTab = null;
    suppressTabClickUntil = Date.now() + 500;
    clearTabDropMarkers();
    delete button.dataset.dragging;
  });
  return button;
}

function createActiveTabName(tab) {
  if (!tab) return createElement("span", "mn-notepad-active-title", "No tab");

  if (renamingTabId === tab.id) {
    const input = createElement("input", "mn-notepad-title-edit");
    input.value = tab.title;
    input.maxLength = 36;
    input.setAttribute("aria-label", "Rename active tab");
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("blur", () => renameTab(tab, input.value));
    input.addEventListener("keydown", (event) => handleRenameKey(event, input));
    return input;
  }

  const button = createButton("mn-notepad-active-title", tab.title, `${tab.title} / double-click to rename active tab`, (event) => {
    event.stopPropagation();
  });
  button.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    addMenuOpen = false;
    actionsMenuOpen = false;
    renamingTabId = tab.id;
    render();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "F2") return;
    event.preventDefault();
    addMenuOpen = false;
    actionsMenuOpen = false;
    renamingTabId = tab.id;
    render();
  });
  return button;
}

function getNoteEntryCount(tab) {
  if (!tab) return 0;
  const prefix = `${tab.id}::`;
  return Object.keys(state.notes).filter((key) => key.startsWith(prefix)).length;
}

function createStatusLine() {
  statusEl = createElement("div", "mn-notepad-status");
  statusEl.dataset.tone = statusTone;
  statusEl.hidden = !statusMessage;
  statusTextEl = createElement("span", "mn-notepad-status-text", statusMessage);
  const dismiss = createButton("mn-notepad-status-dismiss", "", "Dismiss status message", (event) => {
    event.stopPropagation();
    dismissStatus();
  });
  statusEl.append(statusTextEl, dismiss);
  return statusEl;
}

function cancelDeleteTab() {
  pendingDeleteTabId = null;
  render();
}

function createDeleteConfirmation(tab) {
  const noteCount = getNoteEntryCount(tab);
  const detail =
    noteCount > 0
      ? `This removes "${tab.title}" and ${noteCount} saved note entr${noteCount === 1 ? "y" : "ies"}.`
      : `This removes "${tab.title}".`;
  const overlay = createElement("div", "mn-notepad-confirm-backdrop");
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) cancelDeleteTab();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelDeleteTab();
  });

  const dialog = createElement("div", "mn-notepad-confirm-card");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "mn-notepad-confirm-title");
  dialog.setAttribute("aria-describedby", "mn-notepad-confirm-message");

  const eyebrow = createElement("div", "mn-notepad-confirm-eyebrow", "Delete tab");
  const title = createElement("h3", "mn-notepad-confirm-title", "Delete this tab?");
  title.id = "mn-notepad-confirm-title";
  const message = createElement("p", "mn-notepad-confirm-message", detail);
  message.id = "mn-notepad-confirm-message";
  const actions = createElement("div", "mn-notepad-confirm-actions");
  actions.append(
    createButton("mn-notepad-confirm-button mn-notepad-confirm-cancel", "Cancel", "Cancel tab deletion", cancelDeleteTab),
    createButton("mn-notepad-confirm-button mn-notepad-confirm-delete", "Delete", `Delete ${tab.title}`, () =>
      confirmDeleteTab(tab.id),
    ),
  );

  dialog.append(eyebrow, title, message, actions);
  overlay.appendChild(dialog);
  return overlay;
}

function cancelImportBackup() {
  pendingImportState = null;
  render();
}

async function confirmImportBackup() {
  if (!pendingImportState) return;
  state = pendingImportState;
  pendingImportState = null;
  addMenuOpen = false;
  actionsMenuOpen = false;
  pendingDeleteTabId = null;
  saveState();
  await refreshContext(true);
  render();
  const visibleCount = getVisibleTabs().length;
  setStatus(visibleCount > 0 ? "Backup restored" : "Backup restored; open the matching chat to see scoped tabs.", "ok");
}

function createImportConfirmation(nextState) {
  const noteCount = Object.keys(nextState.notes).length;
  const overlay = createElement("div", "mn-notepad-confirm-backdrop");
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) cancelImportBackup();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelImportBackup();
  });

  const dialog = createElement("div", "mn-notepad-confirm-card mn-notepad-import-card");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "mn-notepad-import-title");
  dialog.setAttribute("aria-describedby", "mn-notepad-import-message");

  const eyebrow = createElement("div", "mn-notepad-confirm-eyebrow", "Restore backup");
  const title = createElement("h3", "mn-notepad-confirm-title", "Replace current notes?");
  title.id = "mn-notepad-import-title";
  const message = createElement(
    "p",
    "mn-notepad-confirm-message",
    `This restores ${nextState.tabs.length} tab${nextState.tabs.length === 1 ? "" : "s"} and ${noteCount} saved note entr${
      noteCount === 1 ? "y" : "ies"
    }. Current notepad data in this browser will be replaced.`,
  );
  message.id = "mn-notepad-import-message";
  const actions = createElement("div", "mn-notepad-confirm-actions");
  actions.append(
    createButton("mn-notepad-confirm-button mn-notepad-confirm-cancel", "Cancel", "Cancel backup restore", cancelImportBackup),
    createButton("mn-notepad-confirm-button mn-notepad-confirm-restore", "Restore", "Restore notepad backup", () => {
      void confirmImportBackup();
    }),
  );

  dialog.append(eyebrow, title, message, actions);
  overlay.appendChild(dialog);
  return overlay;
}

function renderTabRow(label, items, activeTab) {
  if (items.length === 0) return null;
  const row = createElement("div", "mn-notepad-tab-row");
  row.dataset.scope = items[0].scope;
  const rowLabel = createElement("div", "mn-notepad-row-label", label);
  rowLabel.title = tooltipForScopeLabel(items[0].scope);
  const rowTabs = createElement("div", "mn-notepad-row-tabs");
  rowTabs.dataset.scope = items[0].scope;
  items.forEach((item, index) => {
    rowTabs.appendChild(createTabButton(item, activeTab, index));
  });
  rowTabs.addEventListener("dragover", (event) => {
    if (!draggedTab || draggedTab.scope !== rowTabs.dataset.scope) return;
    event.preventDefault();
    if (event.target instanceof Element && event.target.closest(".mn-notepad-tab")) return;
    clearTabDropMarkers();
    rowTabs.dataset.dropActive = "end";
  });
  rowTabs.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !rowTabs.contains(event.relatedTarget)) {
      delete rowTabs.dataset.dropActive;
    }
  });
  rowTabs.addEventListener("drop", (event) => {
    if (!draggedTab || draggedTab.scope !== rowTabs.dataset.scope) return;
    if (event.target instanceof Element && event.target.closest(".mn-notepad-tab")) return;
    event.preventDefault();
    const moved = moveTabToScopeEnd(draggedTab.id, rowTabs.dataset.scope);
    draggedTab = null;
    suppressTabClickUntil = Date.now() + 500;
    clearTabDropMarkers();
    if (moved) {
      render();
      setStatus("Reordered", "ok");
    }
  });
  row.append(rowLabel, rowTabs);
  return row;
}

function renderTabGroups(activeTab, visibleTabs = getVisibleTabs()) {
  const groups = createElement("div", "mn-notepad-tab-groups");
  const globalTabs = visibleTabs.filter((tab) => tab.scope === "global");
  const characterTabs = visibleTabs.filter((tab) => tab.scope === "character");
  const chatTabs = visibleTabs.filter((tab) => tab.scope === "chat");
  [
    renderTabRow(labelForScope("global"), globalTabs, activeTab),
    renderTabRow(labelForScope("character"), characterTabs, activeTab),
    renderTabRow(labelForScope("chat"), chatTabs, activeTab),
  ]
    .filter(Boolean)
    .forEach((row) => groups.appendChild(row));
  return groups;
}

function toggleTabsCollapsed() {
  state.tabsCollapsed = !state.tabsCollapsed;
  saveState();
  render();
}

function createTabsCollapseButton() {
  const isCollapsed = Boolean(state.tabsCollapsed);
  const button = createButton(
    "mn-notepad-tabs-toggle",
    "",
    isCollapsed ? "Show tabs" : "Hide tabs",
    (event) => {
      event.stopPropagation();
      toggleTabsCollapsed();
    },
  );
  button.setAttribute("aria-expanded", String(!isCollapsed));
  return button;
}

function createCollapsedTabsHandle() {
  const button = createButton("mn-notepad-tabs-collapsed", "", "Show tabs", (event) => {
    event.stopPropagation();
    toggleTabsCollapsed();
  });
  button.setAttribute("aria-label", "Show tabs");
  return button;
}

function isInteractiveTarget(target) {
  return Boolean(target instanceof Element && target.closest("button, input, select, textarea, a"));
}

function startDrag(event) {
  if (event.button !== 0 || !state.open || isMobileLayout() || isInteractiveTarget(event.target)) return;
  event.preventDefault();
  state.layout = constrainLayout(state.layout);

  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLayout = { ...state.layout };
  root.dataset.dragging = "true";

  const handleMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    state.layout = constrainLayout({
      ...startLayout,
      x: startLayout.x + moveEvent.clientX - startX,
      y: startLayout.y + moveEvent.clientY - startY,
    });
    applyLayout();
  };

  const handleUp = (upEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    root.dataset.dragging = "false";
    saveState();
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

function startResize(event) {
  if (event.button !== 0 || !state.open || isMobileLayout()) return;
  event.preventDefault();
  event.stopPropagation();
  state.layout = constrainLayout(state.layout);

  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLayout = { ...state.layout };
  root.dataset.resizing = "true";

  const handleMove = (moveEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    state.layout = constrainLayout({
      ...startLayout,
      width: startLayout.width + moveEvent.clientX - startX,
      height: startLayout.height + moveEvent.clientY - startY,
    });
    applyLayout();
  };

  const handleUp = (upEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    root.dataset.resizing = "false";
    saveState();
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

function updateLauncherContent() {
  if (!launcher) return;

  if (isMobileLayout()) {
    launcher.replaceChildren("Notes");
    return;
  }

  launcher.replaceChildren(createNotepadBrand());
}

function buildRoot() {
  root = createElement("div", "mn-notepad-root");
  root.dataset.extension = "local-chat-notepad";

  launcher = createButton("mn-notepad-launcher", "Notes", "Open local chat notepad", () => {
    state.open = true;
    pendingDeleteTabId = null;
    pendingImportState = null;
    saveState();
    render();
  });

  panel = createElement("section", "mn-notepad-panel");
  panel.setAttribute("aria-label", "Local chat notepad");
  panel.addEventListener("click", handlePanelMenuClose, true);

  root.append(panel, launcher);
  document.body.appendChild(root);
}

function render() {
  if (!root) buildRoot();

  const hasChat = Boolean(context.chatId);
  root.hidden = !hasChat;
  if (!hasChat) {
    root.removeAttribute("style");
    return;
  }

  launcher.hidden = state.open;
  panel.hidden = !state.open;
  applyLayout();
  panel.replaceChildren();
  statusEl = null;
  statusTextEl = null;

  const visibleTabs = getVisibleTabs();
  updateLauncherContent();
  if (!state.open) return;

  const tab = ensureActiveTabRelevant(visibleTabs);
  const pendingDeleteTab = pendingDeleteTabId ? visibleTabs.find((item) => item.id === pendingDeleteTabId) : null;
  if (pendingDeleteTabId && !pendingDeleteTab) pendingDeleteTabId = null;
  const scopeInfo = tab
    ? resolveScope(tab)
    : {
        label: "No tabs for this chat.",
        placeholder: "Create a global, character, chat, or branch-wide tab.",
      };

  const header = createElement("div", "mn-notepad-header");
  header.title = "Drag notepad";
  header.addEventListener("pointerdown", startDrag);
  const titleWrap = createElement("div", "mn-notepad-title-wrap");
  const title = createNotepadBrand("h2");
  title.classList.add("mn-notepad-title", "retro-glow-text");
  titleWrap.append(title);
  const headerActions = createElement("div", "mn-notepad-header-actions");
  const addWrap = createElement("div", "mn-notepad-add-wrap");
  const addButton = createButton("mn-notepad-add-tab", "+", "Add notepad tab", (event) => {
    event.stopPropagation();
    actionsMenuOpen = false;
    pendingDeleteTabId = null;
    pendingImportState = null;
    addMenuOpen = !addMenuOpen;
    render();
  });
  addWrap.appendChild(addButton);
  if (addMenuOpen) {
    const menu = createElement("div", "mn-notepad-add-menu");
    menu.appendChild(createButton("mn-notepad-add-choice", "Global", "Create global tab", () => addTab("global")));
    const characterIds = getCurrentCharacterIds();
    if (characterIds.length === 0) {
      menu.appendChild(createButton("mn-notepad-add-choice", "Character", "Create character tab", () => addTab("character")));
    } else {
      characterIds.forEach((characterId) => {
        menu.appendChild(
          createButton("mn-notepad-add-choice", getCharacterLabel(characterId), "Create character tab", () =>
            addTab("character", "branch", characterId),
          ),
        );
      });
    }
    menu.appendChild(
      createButton("mn-notepad-add-choice", "Chat", "Create chat-scoped tab", () =>
        addTab("chat", "branch"),
      ),
    );
    if (context.chat?.groupId) {
      menu.appendChild(
        createButton("mn-notepad-add-choice", "Branch-wide", "Create branch-wide tab", () =>
          addTab("chat", "family"),
        ),
      );
    }
    addWrap.appendChild(menu);
  }
  const actionsWrap = createElement("div", "mn-notepad-actions-wrap");
  const actionsButton = createButton("mn-notepad-more-button", "...", "Notepad options", (event) => {
    event.stopPropagation();
    addMenuOpen = false;
    pendingDeleteTabId = null;
    pendingImportState = null;
    actionsMenuOpen = !actionsMenuOpen;
    render();
  });
  actionsWrap.appendChild(actionsButton);
  if (actionsMenuOpen) {
    const menu = createElement("div", "mn-notepad-actions-menu");
    const addAction = (text, title, handler, className = "mn-notepad-menu-button") => {
      const button = createButton(className, text, title, (event) => {
        event.stopPropagation();
        addMenuOpen = false;
        actionsMenuOpen = false;
        handler();
      });
      menu.appendChild(button);
      return button;
    };
    addAction("Import backup", "Restore notepad data from a backup file", importBackup);
    addAction("Export backup", "Download a backup of all notepad tabs and notes", exportBackup);
    addAction("Reset layout", "Reset notepad size and position", resetLayout);
    const deleteAction = addAction(
      "Delete tab",
      "Delete current notepad tab",
      requestDeleteTab,
      "mn-notepad-menu-button mn-notepad-menu-danger",
    );
    deleteAction.disabled = !tab;
    actionsWrap.appendChild(menu);
  }
  const close = createButton("mn-notepad-minimize-button", "-", "Minimize notepad", () => {
    addMenuOpen = false;
    actionsMenuOpen = false;
    pendingDeleteTabId = null;
    pendingImportState = null;
    state.open = false;
    saveState();
    render();
  });
  headerActions.append(actionsWrap, addWrap);
  header.append(close, titleWrap, headerActions);

  const tabSection = createElement("div", "mn-notepad-tabs-section");
  tabSection.dataset.collapsed = state.tabsCollapsed ? "true" : "false";
  const tabsToggle = createTabsCollapseButton();
  if (state.tabsCollapsed) {
    tabSection.append(createCollapsedTabsHandle(), tabsToggle);
  } else {
    const tabGroups = renderTabGroups(tab, visibleTabs);
    tabSection.append(tabGroups, tabsToggle);
  }

  const scopeLine = createElement("div", "mn-notepad-scope-line");
  scopeLine.append(createActiveTabName(tab));
  const statusLine = createStatusLine();

  const formatbar = createFormatToolbar(tab);
  const noteValue = tab ? getCurrentNote(tab) : "";
  let noteSurface;

  if (state.viewMode === "preview") {
    textarea = null;
    noteSurface = createElement("div", "mn-notepad-preview");
    noteSurface.innerHTML = renderMarkdown(noteValue);
    noteSurface.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest(".mn-notepad-preview-check") : null;
      if (!button) return;
      event.preventDefault();
      togglePreviewChecklist(tab, Number(button.dataset.lineIndex));
    });
  } else {
    textarea = createElement("textarea", "mn-notepad-textarea");
    textarea.value = noteValue;
    textarea.placeholder = scopeInfo.placeholder;
    textarea.spellcheck = true;
    textarea.disabled = !tab;
    if (tab) textarea.addEventListener("input", () => setCurrentNote(tab, textarea.value));
    noteSurface = textarea;
  }

  const resizeHandle = createElement("div", "mn-notepad-resize-handle");
  resizeHandle.title = "Resize notepad";
  resizeHandle.setAttribute("aria-hidden", "true");
  resizeHandle.addEventListener("pointerdown", startResize);

  panel.append(header, tabSection, scopeLine, formatbar, noteSurface, resizeHandle, statusLine);
  if (pendingDeleteTab) panel.appendChild(createDeleteConfirmation(pendingDeleteTab));
  if (pendingImportState) panel.appendChild(createImportConfirmation(pendingImportState));

  requestAnimationFrame(() => {
    panel?.querySelector('.mn-notepad-tab[data-active="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    panel?.querySelector(".mn-notepad-confirm-cancel")?.focus();
    panel?.querySelector(".mn-notepad-title-edit")?.focus();
    panel?.querySelector(".mn-notepad-title-edit")?.select();
  });
}

function addTab(scope = "chat", branchMode = "branch", characterIdOverride = null) {
  const ids = getCurrentCharacterIds();
  const safeScope = ["global", "character", "chat"].includes(scope) ? scope : "chat";
  const safeBranchMode = branchMode === "family" ? "family" : "branch";
  const characterId = safeScope === "character" ? characterIdOverride || ids[0] || null : null;
  const chatId = safeScope === "chat" && safeBranchMode === "branch" ? context.chat?.id || context.chatId || null : null;
  const groupId =
    safeScope === "chat"
      ? safeBranchMode === "family"
        ? context.chat?.groupId || context.chat?.id || context.chatId || null
        : context.chat?.groupId || null
      : null;
  const now = new Date().toISOString();
  const tab = {
    id: makeId("tab"),
    title: uniqueTabTitle(titleForScope(safeScope, characterId, safeBranchMode)),
    scope: safeScope,
    branchMode: safeScope === "chat" ? safeBranchMode : "branch",
    characterId,
    chatId,
    groupId,
    createdAt: now,
    updatedAt: now,
  };
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  addMenuOpen = false;
  actionsMenuOpen = false;
  pendingDeleteTabId = null;
  pendingImportState = null;
  saveState();
  render();
}

function requestDeleteTab() {
  const tab = ensureActiveTabRelevant();
  if (!tab) return;
  addMenuOpen = false;
  actionsMenuOpen = false;
  pendingImportState = null;
  pendingDeleteTabId = tab.id;
  render();
}

function confirmDeleteTab(tabId) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) {
    pendingDeleteTabId = null;
    render();
    return;
  }
  addMenuOpen = false;
  actionsMenuOpen = false;
  pendingDeleteTabId = null;
  const prefix = `${tab.id}::`;
  Object.keys(state.notes).forEach((key) => {
    if (key.startsWith(prefix)) delete state.notes[key];
  });
  state.tabs = state.tabs.filter((item) => item.id !== tab.id);
  const visibleTabs = getVisibleTabs();
  state.activeTabId = visibleTabs[0]?.id || state.tabs[0]?.id || null;
  saveState();
  render();
}

function handleStorage(event) {
  if (event.key === ACTIVE_CHAT_KEY) refreshContext(true);
}

function handleWindowResize() {
  if (!root || root.hidden) return;
  state.layout = constrainLayout(state.layout);
  saveState();
  applyLayout();
}

marinara.on(window, "storage", handleStorage);
marinara.on(window, "resize", handleWindowResize);
const observer = marinara.observe(document.body, () => refreshContext(), { childList: true, subtree: true });
const interval = marinara.setInterval(() => refreshContext(), 750);

marinara.onCleanup(() => {
  window.clearInterval(interval);
  observer?.disconnect();
  root?.remove();
});

refreshContext(true);
