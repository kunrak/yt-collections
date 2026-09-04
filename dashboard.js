// dashboard.js — runs the dashboard page. Talks to background.js for all
// YouTube API work; only reads/writes chrome.storage.local directly for
// collection bookkeeping (not video data, which background.js owns).

let state = {
  collections: {},
  channels: {},
  videos: {},
  apiKey: "",
  activeCollectionId: null,
  activeTab: "videos",
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
  const data = await chrome.storage.local.get(["collections", "channels", "videos", "apiKey"]);
  state.collections = data.collections || {};
  state.channels = data.channels || {};
  state.videos = data.videos || {};
  state.apiKey = data.apiKey || "";

  const ids = Object.keys(state.collections);
  if (!state.activeCollectionId || !state.collections[state.activeCollectionId]) {
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

function activeCollection() {
  return state.activeCollectionId ? state.collections[state.activeCollectionId] : null;
}

function renderTopbar() {
  const col = activeCollection();
  el("collectionTitle").textContent = col ? col.name : "No collection selected";
  el("channelCount").textContent = col
    ? `${col.channelIds.length} channel${col.channelIds.length === 1 ? "" : "s"}`
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
  if (!col) {
    empty.hidden = false;
    feed.hidden = true;
    return;
  }
  empty.hidden = true;
  feed.hidden = false;

  const wantShort = state.activeTab === "shorts";
  const items = [];
  for (const channelId of col.channelIds) {
    const vids = state.videos[channelId] || [];
    for (const v of vids) {
      if (v.isShort === wantShort) items.push(v);
    }
  }
  items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (items.length === 0) {
    feed.innerHTML = `<div class="feed-empty">
      <p class="empty-title">Nothing here yet</p>
      <p class="empty-sub">${
        col.channelIds.length === 0
          ? "Add some channels to this collection to start seeing updates."
          : `No recent ${wantShort ? "Shorts" : "videos"} from these channels."`
      }</p>
    </div>`;
    return;
  }

  for (const v of items) {
    const channel = state.channels[v.channelId];
    const card = document.createElement("a");
    card.className = "video-card" + (v.isShort ? " short" : "");
    card.href = v.url;
    card.target = "_blank";
    card.rel = "noopener";
    card.innerHTML = `
      <img class="video-thumb" src="${v.thumbnail}" alt="" loading="lazy" />
      <div class="video-info">
        <div class="video-title">${escapeHtml(v.title)}</div>
        <div class="video-meta">
          <span>${escapeHtml(channel?.title || "")}</span>
          <span>${timeAgo(v.publishedAt)}</span>
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
  renderFeed();
  renderApiKeyBanner();
}

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
  }

  if (!col.channelIds.includes(channel.id)) {
    col.channelIds.push(channel.id);
    await saveCollections();
  }

  await loadState();
  hint.textContent = `Added ${channel.title}.`;
  hint.style.color = "";
  input.value = "";
  submitBtn.disabled = false;
  renderChannelManageList();
  renderAll();
});

function friendlyError(msg) {
  if (msg === "NO_API_KEY") return "Add a YouTube Data API key in Settings first.";
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
  await loadState();
  renderAll();
  btn.disabled = false;
  btn.textContent = "Refresh";
  if (!res.ok) alert(friendlyError(res.error));
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
