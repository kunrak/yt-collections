// dashboard.js — runs the dashboard page. Talks to background.js for all
// YouTube API work; only reads/writes chrome.storage.local directly for
// collection bookkeeping (not video data, which background.js owns).

const ALL_ID = "__all__";
const HOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

let state = {
  collections: {},
  channels: {},
  videos: {},
  apiKey: "",
  lastRefreshedAt: null,
  refreshErrors: [],
  activeCollectionId: null,
  activeTab: "home",
  query: "",
};

const el = (id) => document.getElementById(id);

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || { ok: false, error: "No response from background script" });
    });
  });
}

async function loadState() {
  const data = await chrome.storage.local.get([
    "collections",
    "channels",
    "videos",
    "apiKey",
    "lastRefreshedAt",
  ]);
  state.collections = data.collections || {};
  state.channels = data.channels || {};
  state.videos = data.videos || {};
  state.apiKey = data.apiKey || "";
  state.lastRefreshedAt = data.lastRefreshedAt || null;

  const ids = Object.keys(state.collections);
  const valid =
    state.activeCollectionId === ALL_ID || Boolean(state.collections[state.activeCollectionId]);
  if (!valid) {
    state.activeCollectionId = ids[0] || null;
  }
}

async function saveCollections() {
  await chrome.storage.local.set({ collections: state.collections });
}

function genId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- rendering ----------

function renderSidebar() {
  const list = el("collectionList");
  list.innerHTML = "";
  const allItem = el("allCollectionsItem");
  allItem.classList.toggle("active", state.activeCollectionId === ALL_ID);
  el("allChannelCount").textContent = Object.keys(state.channels).length;
  for (const col of Object.values(state.collections)) {
    const item = document.createElement("div");
    item.className = "collection-item" + (col.id === state.activeCollectionId ? " active" : "");
    item.innerHTML = `<span>${escapeHtml(col.name)}</span><span class="count">${col.channelIds.length}</span>`;
    item.addEventListener("click", () => {
      state.activeCollectionId = col.id;
      renderAll();
    });
    list.appendChild(item);
  }
}

function isAllView() {
  return state.activeCollectionId === ALL_ID;
}

function activeCollection() {
  if (!state.activeCollectionId || isAllView()) return null;
  return state.collections[state.activeCollectionId] || null;
}

// Channel IDs in scope for the current view (one collection or all of them).
function activeChannelIds() {
  if (isAllView()) return Object.keys(state.channels);
  const col = activeCollection();
  return col ? col.channelIds : [];
}

function renderTopbar() {
  const col = activeCollection();
  const n = activeChannelIds().length;
  const label = `${n} channel${n === 1 ? "" : "s"}`;
  if (isAllView()) {
    el("collectionTitle").textContent = "All collections";
    el("channelCount").textContent = label;
  } else {
    el("collectionTitle").textContent = col ? col.name : "No collection selected";
    el("channelCount").textContent = col ? label : "";
  }
}

function renderStatusLine() {
  const line = el("statusLine");
  if (state.refreshErrors.length > 0) {
    const first = state.refreshErrors[0];
    const name = state.channels[first.channelId]?.title || "a channel";
    const more = state.refreshErrors.length > 1 ? ` (+${state.refreshErrors.length - 1} more)` : "";
    line.textContent = `Refresh failed for ${name}: ${friendlyError(first.message)}${more}`;
    line.classList.add("error");
    return;
  }
  line.classList.remove("error");
  line.textContent = state.lastRefreshedAt
    ? `Last refreshed ${timeAgo(new Date(state.lastRefreshedAt).toISOString())}`
    : "";
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderFeed() {
  const feed = el("feed");
  const empty = el("emptyState");
  feed.innerHTML = "";

  const col = activeCollection();
  if (!col && !isAllView()) {
    empty.hidden = false;
    feed.hidden = true;
    return;
  }
  empty.hidden = true;
  feed.hidden = false;

  const tab = state.activeTab;
  const query = state.query.trim().toLowerCase();
  const cutoff = Date.now() - HOME_WINDOW_MS;
  const channelIds = activeChannelIds();
  const items = [];
  for (const channelId of channelIds) {
    const channelTitle = (state.channels[channelId]?.title || "").toLowerCase();
    const vids = state.videos[channelId] || [];
    for (const v of vids) {
      if (tab === "videos" && v.isShort) continue;
      if (tab === "shorts" && !v.isShort) continue;
      if (tab === "home" && !query && new Date(v.publishedAt).getTime() < cutoff) continue;
      if (query && !v.title.toLowerCase().includes(query) && !channelTitle.includes(query)) continue;
      items.push(v);
    }
  }
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (items.length === 0) {
    let sub;
    if (channelIds.length === 0) {
      sub = isAllView()
        ? "Add some channels to a collection to start seeing updates."
        : "Add some channels to this collection to start seeing updates.";
    } else if (query) {
      sub = `No videos match “${escapeHtml(state.query.trim())}”.`;
    } else if (tab === "home") {
      sub = "No uploads from these channels in the last 7 days. Try Videos or Shorts for older uploads, or hit Refresh.";
    } else {
      sub = `No recent ${tab === "shorts" ? "Shorts" : "videos"} from these channels. Hit Refresh to check again.`;
    }
    feed.innerHTML = `<div class="feed-empty">
      <p class="empty-title">${query ? "No results" : "Nothing here yet"}</p>
      <p class="empty-sub">${sub}</p>
    </div>`;
    return;
  }

  for (const v of items) {
    const channel = state.channels[v.channelId];
    const card = document.createElement("a");
    card.className = "video-card" + (v.isShort && tab === "shorts" ? " short" : "");
    card.href = v.url;
    card.target = "_blank";
    card.rel = "noopener";
    card.innerHTML = `
      <img class="video-thumb" src="${v.thumbnail}" alt="" loading="lazy" />
      <div class="video-info">
        <div class="video-title">${escapeHtml(v.title)}</div>
        <div class="video-meta">
          <span>${escapeHtml(channel?.title || "")}</span>
          <span>${v.isShort && tab !== "shorts" ? "Short · " : ""}${timeAgo(v.publishedAt)}</span>
        </div>
      </div>
    `;
    feed.appendChild(card);
  }
}

function renderApiKeyBanner() {
  const banner = el("apiKeyBanner");
  banner.hidden = Boolean(state.apiKey);
}

function renderAll() {
  renderSidebar();
  renderTopbar();
  renderStatusLine();
  renderFeed();
  renderApiKeyBanner();
}

el("allCollectionsItem").addEventListener("click", () => {
  state.activeCollectionId = ALL_ID;
  renderAll();
});

// ---------- search ----------

el("searchInput").addEventListener("input", (e) => {
  state.query = e.target.value;
  renderFeed();
});

// ---------- collection management ----------

el("newCollectionBtn").addEventListener("click", () => openModal("newCollectionModal"));
el("emptyCreateBtn").addEventListener("click", () => openModal("newCollectionModal"));

el("newCollectionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("newCollectionInput").value.trim();
  if (!name) return;
  const id = genId();
  state.collections[id] = { id, name, channelIds: [] };
  state.activeCollectionId = id;
  await saveCollections();
  el("newCollectionInput").value = "";
  closeModal("newCollectionModal");
  renderAll();
});

el("deleteCollectionBtn").addEventListener("click", async () => {
  const col = activeCollection();
  if (!col) return;
  if (!confirm(`Delete "${col.name}"? This won't unfollow the channels, just removes this collection.`)) return;
  delete state.collections[col.id];
  state.activeCollectionId = Object.keys(state.collections)[0] || null;
  await saveCollections();
  closeModal("settingsModal");
  renderAll();
});

// ---------- tab switching ----------

el("tabSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  state.activeTab = btn.dataset.tab;
  renderFeed();
});

// ---------- channels modal ----------

el("manageChannelsBtn").addEventListener("click", () => {
  const col = activeCollection();
  if (!col) {
    if (isAllView() && Object.keys(state.collections).length > 0) {
      alert("Pick a collection in the sidebar to manage its channels.");
      return;
    }
    openModal("newCollectionModal");
    return;
  }
  el("channelsModalCollectionName").textContent = col.name;
  renderChannelManageList();
  el("addChannelHint").textContent = "";
  openModal("channelsModal");
});

function renderChannelManageList() {
  const col = activeCollection();
  const list = el("channelManageList");
  list.innerHTML = "";
  if (!col) return;

  for (const channelId of col.channelIds) {
    const ch = state.channels[channelId];
    if (!ch) continue;
    const li = document.createElement("li");
    li.className = "channel-manage-item";
    li.innerHTML = `
      <img src="${ch.thumbnail}" alt="" />
      <span class="title">${escapeHtml(ch.title)}</span>
      <button class="remove-channel-btn" data-id="${ch.id}">Remove</button>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll(".remove-channel-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const channelId = btn.dataset.id;
      col.channelIds = col.channelIds.filter((id) => id !== channelId);
      saveCollections().then(() => {
        renderChannelManageList();
        renderAll();
      });
    });
  });
}

el("addChannelForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("addChannelInput");
  const hint = el("addChannelHint");
  const submitBtn = el("addChannelSubmit");
  const value = input.value.trim();
  if (!value) return;

  const col = activeCollection();
  if (!col) return;

  submitBtn.disabled = true;
  hint.textContent = "Looking up channel...";
  hint.style.color = "";

  let resolveRes;
  try {
    resolveRes = await sendMessage({ type: "RESOLVE_CHANNEL", input: value });
  } catch (err) {
    hint.textContent = friendlyError(err.message);
    hint.style.color = "var(--danger)";
    submitBtn.disabled = false;
    return;
  }
  if (!resolveRes.ok) {
    hint.textContent = friendlyError(resolveRes.error);
    hint.style.color = "var(--danger)";
    submitBtn.disabled = false;
    return;
  }

  const channel = resolveRes.channel;
  let addWarning = null;

  if (!state.channels[channel.id]) {
    hint.textContent = `Adding ${channel.title}...`;
    let addRes;
    try {
      addRes = await sendMessage({ type: "ADD_CHANNEL", channel });
    } catch (err) {
      hint.textContent = friendlyError(err.message);
      hint.style.color = "var(--danger)";
      submitBtn.disabled = false;
      return;
    }
    if (!addRes.ok) {
      hint.textContent = friendlyError(addRes.error);
      hint.style.color = "var(--danger)";
      submitBtn.disabled = false;
      return;
    }
    if (addRes.warning) {
      addWarning = `Added ${channel.title}, but couldn't load its videos: ${friendlyError(addRes.warning)}`;
    }
  }

  if (!col.channelIds.includes(channel.id)) {
    col.channelIds.push(channel.id);
    await saveCollections();
  }

  await loadState();
  hint.textContent = addWarning || `Added ${channel.title}.`;
  hint.style.color = addWarning ? "var(--danger)" : "";
  input.value = "";
  submitBtn.disabled = false;
  renderChannelManageList();
  renderAll();
});

function friendlyError(msg) {
  if (msg === "NO_API_KEY") return "Add a YouTube Data API key in Settings first.";
  if (/Could not establish connection|Receiving end does not exist/i.test(msg || "")) {
    return "Background script isn't running. Reload the extension from chrome://extensions and try again.";
  }
  if (/quota/i.test(msg || "")) return "YouTube API quota exceeded for today. It resets at midnight Pacific time.";
  if (/API key not valid|keyInvalid/i.test(msg || "")) return "Your API key was rejected. Check it in Settings.";
  return msg || "Something went wrong. Try again.";
}

// ---------- settings modal ----------

el("settingsBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["apiKey"]);
  el("apiKeyInput").value = data.apiKey || "";
  const col = activeCollection();
  el("deleteCollectionName").textContent = col ? col.name : "";
  el("deleteCollectionBtn").disabled = !col;
  openModal("settingsModal");
});

el("saveApiKeyBtn").addEventListener("click", async () => {
  const key = el("apiKeyInput").value.trim();
  await chrome.storage.local.set({ apiKey: key });
  state.apiKey = key;
  renderApiKeyBanner();
  closeModal("settingsModal");
});

// ---------- refresh ----------

el("refreshBtn").addEventListener("click", async () => {
  const btn = el("refreshBtn");
  btn.disabled = true;
  btn.textContent = "Refreshing...";
  let res;
  try {
    res = await sendMessage({ type: "REFRESH_ALL" });
  } catch (err) {
    res = { ok: false, error: err.message };
  }
  state.refreshErrors = res.ok ? res.result.errors || [] : [];
  await loadState();
  renderAll();
  btn.disabled = false;
  btn.textContent = "Refresh";
  if (!res.ok) alert(friendlyError(res.error));
  else if (res.result.refreshed === 0) alert("No channels to refresh yet. Add channels to a collection first.");
});

// ---------- modal plumbing ----------

const MODAL_FOCUS = {
  newCollectionModal: "newCollectionInput",
  settingsModal: "apiKeyInput",
  channelsModal: "addChannelInput",
};

function openModal(id) {
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.hidden = true;
  });
  const modal = el(id);
  modal.hidden = false;
  const focusId = MODAL_FOCUS[id];
  if (focusId) {
    requestAnimationFrame(() => el(focusId).focus());
  }
}
function closeModal(id) {
  el(id).hidden = true;
}
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".modal-backdrop")].find((m) => !m.hidden);
  if (open) open.hidden = true;
});

// ---------- boot ----------

(async function init() {
  await loadState();
  renderAll();
})();
