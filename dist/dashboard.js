(() => {
  // src/dashboard.js
  var state = {
    collections: [],
    channelsById: {},
    collectionNamesByChannel: {},
    view: "home",
    activeCollectionId: null,
    activeChannelId: null,
    activeTab: "videos",
    feedVideos: [],
    watchedVideoIds: /* @__PURE__ */ new Set(),
    hideWatched: false
  };
  var el = (id) => document.getElementById(id);
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(
          response || { ok: false, error: "No response from background script" }
        );
      });
    });
  }
  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }
  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 6e4);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  function setupCollectionDragDrop() {
    const collectionList = el("collectionList");
    let dragSource = null;
    let dragSourceIndex = null;
    collectionList.addEventListener("dragstart", (e) => {
      const item = e.target.closest(".collection-item");
      if (!item || item.id === "homeNavBtn") return;
      if (e.target.closest("button") || e.target.closest(".collection-toggle"))
        return;
      dragSource = item;
      dragSourceIndex = Array.from(collectionList.children).indexOf(item);
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.dataset.id);
    });
    collectionList.addEventListener("dragend", (e) => {
      if (dragSource) dragSource.classList.remove("dragging");
      document.querySelectorAll(".collection-item.drag-over").forEach((el2) => {
        el2.classList.remove("drag-over");
      });
      dragSource = null;
      dragSourceIndex = null;
    });
    collectionList.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const afterItem = getDragAfterElement(collectionList, e.clientY);
      if (dragSource) {
        if (afterItem == null) {
          collectionList.appendChild(dragSource);
        } else {
          collectionList.insertBefore(dragSource, afterItem);
        }
      }
    });
    collectionList.addEventListener("drop", (e) => {
      e.preventDefault();
      const items = Array.from(collectionList.children).filter(
        (c) => c.id !== "homeNavBtn"
      );
      const newOrder = items.map((item) => item.dataset.id);
      state.collections.sort((a, b) => {
        const aIndex = newOrder.indexOf(a.id);
        const bIndex = newOrder.indexOf(b.id);
        return aIndex - bIndex;
      });
      saveCollections();
    });
  }
  function getDragAfterElement(container, y) {
    const draggableElements = [
      ...container.querySelectorAll(".collection-item:not(.dragging)")
    ].filter((el2) => el2.id !== "homeNavBtn");
    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }
  function setupChannelDragDrop() {
    let channelDragSource = null;
    let channelDragParent = null;
    document.addEventListener("dragstart", (e) => {
      const item = e.target.closest(".collection-channel-item");
      if (!item) return;
      if (e.target.closest("button")) return;
      channelDragSource = item;
      channelDragParent = item.parentElement;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    document.addEventListener("dragend", (e) => {
      if (channelDragSource) {
        channelDragSource.classList.remove("dragging");
      }
      if (channelDragParent) {
        channelDragParent.querySelectorAll(".collection-channel-item.drag-over").forEach((el2) => {
          el2.classList.remove("drag-over");
        });
      }
      channelDragSource = null;
      channelDragParent = null;
    });
    document.addEventListener("dragover", (e) => {
      const channelItem = e.target.closest(".collection-channel-item");
      if (!channelItem || !channelDragSource || channelItem === channelDragSource)
        return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      channelItem.classList.add("drag-over");
      const afterItem = getDragAfterChannelElement(
        channelItem.parentElement,
        e.clientY
      );
      if (afterItem == null) {
        channelItem.parentElement.appendChild(channelDragSource);
      } else {
        channelItem.parentElement.insertBefore(channelDragSource, afterItem);
      }
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!channelDragSource || !channelDragParent) return;
      const collectionId = channelDragParent.closest(".collection-item")?.dataset.id;
      if (!collectionId) return;
      const collection = state.collections.find((c) => c.id === collectionId);
      if (!collection) return;
      const channelItems = Array.from(
        channelDragParent.querySelectorAll(".collection-channel-item")
      );
      const newChannelIds = channelItems.map((item) => {
        const img = item.querySelector("img");
        return Object.values(state.channelsById).find(
          (ch) => ch.thumbnail === (img?.src || "")
        )?.id;
      }).filter(Boolean);
      collection.channelIds = newChannelIds;
      saveCollections();
      channelDragSource = null;
      channelDragParent = null;
    });
  }
  function getDragAfterChannelElement(container, y) {
    const draggableElements = [
      ...container.querySelectorAll(".collection-channel-item:not(.dragging)")
    ];
    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }
  function uniqueChannelIds() {
    const ids = /* @__PURE__ */ new Set();
    for (const col of state.collections) {
      for (const id of col.channelIds) ids.add(id);
    }
    return [...ids];
  }
  async function loadWatchedVideos() {
    const data = await storageGet("ytc_watched");
    state.watchedVideoIds = new Set(data.ytc_watched || []);
    const toggle = el("hideWatchedToggle");
    if (toggle) state.hideWatched = toggle.checked;
  }
  async function saveWatchedVideos() {
    await storageSet({ ytc_watched: [...state.watchedVideoIds] });
  }
  function toggleWatched(videoId) {
    console.log(
      "toggleWatched called with:",
      videoId,
      "current watched:",
      state.watchedVideoIds.has(videoId)
    );
    if (state.watchedVideoIds.has(videoId)) {
      state.watchedVideoIds.delete(videoId);
    } else {
      state.watchedVideoIds.add(videoId);
    }
    console.log("after toggle, watched count:", state.watchedVideoIds.size);
    saveWatchedVideos().then(() => {
      console.log("saved, re-rendering feed");
      renderFeed();
    }).catch((err) => console.error("Failed to save watched:", err));
  }
  function activeCollection() {
    return state.collections.find((c) => c.id === state.activeCollectionId) || null;
  }
  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, resolve);
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, resolve);
    });
  }
  async function saveCollections() {
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({ ytc_collections: state.collections }, resolve);
      });
      console.log("Collections saved:", state.collections);
    } catch (err) {
      console.error("Failed to save collections:", err);
      alert("Failed to save collection: " + err.message);
    }
  }
  async function saveChannels() {
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({ ytc_channels: state.channelsById }, resolve);
      });
      console.log("Channels saved");
    } catch (err) {
      console.error("Failed to save channels:", err);
    }
  }
  async function loadCollections() {
    const syncData = await storageGet("ytc_collections");
    state.collections = syncData.ytc_collections || [];
    const localData = await storageGet("ytc_channels");
    state.channelsById = localData.ytc_channels || {};
    const namesByChannel = {};
    for (const col of state.collections) {
      for (const channelId of col.channelIds) {
        if (!namesByChannel[channelId]) namesByChannel[channelId] = [];
        namesByChannel[channelId].push(col.name);
      }
    }
    state.collectionNamesByChannel = namesByChannel;
    await loadWatchedVideos();
    if (state.view === "collection") {
      if (!state.activeCollectionId || !activeCollection()) {
        state.activeCollectionId = state.collections[0]?.id || null;
        if (!state.activeCollectionId) state.view = "home";
      }
    }
    if (state.view === "channel" && !state.channelsById[state.activeChannelId]) {
      state.view = "home";
      state.activeChannelId = null;
    }
  }
  async function loadFeed() {
    const wantShort = state.activeTab === "shorts";
    const wantLive = state.activeTab === "live";
    let channelIds = [];
    if (state.view === "home") {
      channelIds = uniqueChannelIds();
    } else if (state.view === "collection") {
      channelIds = activeCollection()?.channelIds || [];
    } else if (state.view === "channel") {
      channelIds = state.activeChannelId ? [state.activeChannelId] : [];
    }
    console.log(
      `Loading feed for view: ${state.view}, tab: ${state.activeTab}, channelIds:`,
      channelIds
    );
    if (channelIds.length === 0) {
      state.feedVideos = [];
      return;
    }
    const localData = await storageGet("ytc_videos");
    let videos = localData.ytc_videos || [];
    console.log(`Total videos in storage: ${videos.length}`);
    console.log(`Filtering for wantShort: ${wantShort}, wantLive: ${wantLive}`);
    videos = videos.filter(
      (v) => channelIds.includes(v.channel_id) && v.is_short === wantShort && v.is_live === wantLive
    );
    console.log(`Videos after filtering: ${videos.length}`);
    const channelCounts = {};
    videos.forEach((v) => {
      channelCounts[v.channel_id] = (channelCounts[v.channel_id] || 0) + 1;
    });
    console.log(`Videos by channel:`, channelCounts);
    videos.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    state.feedVideos = videos.slice(0, 50);
    console.log(`Final feed videos: ${state.feedVideos.length}`);
  }
  function showSignedIn() {
    el("authScreen").hidden = true;
    el("app").hidden = false;
    if (el("manageChannelsBtn")) el("manageChannelsBtn").hidden = false;
    if (el("signOutBtn")) el("signOutBtn").style.display = "none";
    if (el("authError")) el("authError").style.display = "none";
    if (el("settingsBtn")) el("settingsBtn").style.display = "none";
  }
  function renderSidebar() {
    const homeBtn = el("homeNavBtn");
    homeBtn.classList.toggle("active", state.view === "home");
    const list = el("collectionList");
    list.innerHTML = "";
    for (const col of state.collections) {
      const item = document.createElement("div");
      item.className = "collection-item" + (state.view === "collection" && col.id === state.activeCollectionId ? " active" : "") + (col.expanded === false ? " collapsed" : "");
      item.dataset.id = col.id;
      item.draggable = true;
      item.innerHTML = `
      <div class="collection-item-main">
        <span class="collection-name" data-id="${col.id}">${escapeHtml(col.name)}</span>
        <div class="collection-toggle ${col.expanded === false ? "collapsed" : "expanded"}" title="Toggle collection"></div>
        <div class="collection-actions">
          <button class="rename-btn" data-id="${col.id}" title="Rename">\u270E</button>
          <button class="delete-btn" data-id="${col.id}" title="Delete">\xD7</button>
        </div>
      </div>
      <div class="collection-channels"></div>
    `;
      list.appendChild(item);
      const channelList = item.querySelector(".collection-channels");
      for (const channelId of col.channelIds) {
        const ch = state.channelsById[channelId];
        if (!ch) continue;
        const chItem = document.createElement("div");
        chItem.className = "collection-channel-item" + (state.view === "channel" && ch.id === state.activeChannelId ? " active" : "");
        chItem.draggable = true;
        chItem.innerHTML = `
        <img src="${escapeHtml(ch.thumbnail || "")}" alt="" />
        <span class="channel-name">${escapeHtml(ch.title)}</span>
        <div class="channel-actions">
          <button class="rename-btn" data-id="${ch.id}" title="Rename">\u270E</button>
          <button class="remove-channel-btn" data-id="${ch.id}" title="Remove">\xD7</button>
        </div>
      `;
        channelList.appendChild(chItem);
        const nameEl = chItem.querySelector(".channel-name");
        const openVideo = () => {
          state.view = "channel";
          state.activeChannelId = ch.id;
          renderAll();
        };
        nameEl.addEventListener("click", openVideo);
        chItem.querySelector("img").addEventListener("click", openVideo);
        chItem.querySelector(".remove-channel-btn").addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`Remove "${ch.title}" from this collection?`)) return;
          col.channelIds = col.channelIds.filter((id) => id !== ch.id);
          await saveCollections();
          await loadCollections();
          renderChannelManageList();
          await renderAll();
        });
        chItem.querySelector(".rename-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          const currentName = ch.title;
          const input = document.createElement("input");
          input.type = "text";
          input.value = currentName;
          input.className = "rename-input";
          nameEl.replaceWith(input);
          input.focus();
          input.select();
          const finish = async () => {
            const newName = input.value.trim() || currentName;
            ch.title = newName;
            await saveChannels();
            await renderAll();
          };
          input.addEventListener("blur", finish);
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              input.blur();
            }
            if (ev.key === "Escape") {
              input.value = currentName;
              input.blur();
            }
          });
        });
      }
      item.querySelector(".collection-name").addEventListener("click", () => {
        state.view = "collection";
        state.activeCollectionId = col.id;
        renderAll();
      });
      item.querySelector(".collection-toggle").addEventListener("click", (e) => {
        col.expanded = col.expanded === false ? true : false;
        saveCollections().then(() => {
          const toggleBtn = item.querySelector(".collection-toggle");
          toggleBtn.className = `collection-toggle ${col.expanded === false ? "collapsed" : "expanded"}`;
          renderAll();
        });
        e.stopPropagation();
      });
      item.querySelector(".delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(
          `Delete "${col.name}"? This won't unfollow the channels, just removes this collection.`
        ))
          return;
        state.collections = state.collections.filter((c) => c.id !== col.id);
        await saveCollections();
        await loadCollections();
        state.view = "home";
        state.activeCollectionId = null;
        await renderAll();
      });
      item.querySelector(".rename-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const nameEl = item.querySelector(".collection-name");
        const currentName = col.name;
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentName;
        input.className = "rename-input";
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        const finish = async () => {
          const newName = input.value.trim() || currentName;
          col.name = newName;
          await saveCollections();
          await renderAll();
        };
        input.addEventListener("blur", finish);
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            input.blur();
          }
          if (ev.key === "Escape") {
            input.value = currentName;
            input.blur();
          }
        });
      });
    }
  }
  function renderTopbar() {
    const manageBtn = el("manageChannelsBtn");
    if (state.view === "home") {
      el("collectionTitle").textContent = "Home";
      el("channelCount").textContent = `${uniqueChannelIds().length} channel${uniqueChannelIds().length === 1 ? "" : "s"}`;
      manageBtn.hidden = true;
    } else if (state.view === "channel") {
      const ch = state.channelsById[state.activeChannelId];
      el("collectionTitle").textContent = ch?.title || "Channel";
      el("channelCount").textContent = "Last 7 days";
      manageBtn.hidden = true;
    } else {
      const col = activeCollection();
      el("collectionTitle").textContent = col ? col.name : "No collection selected";
      el("channelCount").textContent = col ? `${col.channelIds.length} channel${col.channelIds.length === 1 ? "" : "s"}` : "";
      manageBtn.hidden = false;
    }
  }
  function renderFeed() {
    const feed = el("feed");
    const empty = el("emptyState");
    feed.innerHTML = "";
    feed.className = state.activeTab === "shorts" ? "feed short-feed" : "feed";
    if (state.view === "collection" && !activeCollection()) {
      empty.hidden = false;
      el("emptyTitle").textContent = "No collections yet";
      el("emptySub").textContent = "Create a collection and add a few channels to build your first feed.";
      el("emptyCreateBtn").hidden = false;
      feed.hidden = true;
      return;
    }
    let videos = [...state.feedVideos];
    if (state.hideWatched) {
      videos = videos.filter((v) => !state.watchedVideoIds.has(v.id));
    }
    if (videos.length === 0) {
      empty.hidden = false;
      feed.hidden = true;
      el("emptyCreateBtn").hidden = state.collections.length > 0;
      if (state.view === "home") {
        el("emptyTitle").textContent = uniqueChannelIds().length === 0 ? "Nothing on Home yet" : "No recent videos";
        el("emptySub").textContent = uniqueChannelIds().length === 0 ? "Create a collection and add channels. Their latest videos from the will show up here." : state.hideWatched ? "All videos have been watched." : "No videos from the in your collections.";
      } else if (state.view === "channel") {
        el("emptyTitle").textContent = "Nothing here yet";
        el("emptySub").textContent = "No videos from this channel in the last 7 days.";
      } else {
        const col = activeCollection();
        el("emptyTitle").textContent = "Nothing here yet";
        el("emptySub").textContent = col?.channelIds.length === 0 ? "Add some channels to this collection to start seeing updates." : `No recent ${state.activeTab === "shorts" ? "Shorts" : state.activeTab === "live" ? "live videos" : "videos"} from these channels.`;
      }
      return;
    }
    empty.hidden = true;
    feed.hidden = false;
    for (const v of videos) {
      const channel = state.channelsById[v.channel_id];
      const labels = state.collectionNamesByChannel[v.channel_id] || [];
      const isWatched = state.watchedVideoIds.has(v.id);
      console.log("renderFeed video:", v.id, "watched:", isWatched);
      const card = document.createElement("div");
      card.className = "video-card" + (v.is_short ? " short" : "") + (isWatched ? " watched" : "");
      card.innerHTML = `
      <div class="video-thumb-wrap">
        <img class="video-thumb" src="${escapeHtml(v.thumbnail || "")}" alt="" loading="lazy" />
        <button type="button" class="watch-btn${isWatched ? " watched" : ""}" data-id="${escapeHtml(v.id)}" title="${isWatched ? "Mark as unwatched" : "Mark as watched"}">${isWatched ? "\u2713" : ""}</button>
      </div>
      <div class="video-info">
        ${state.view === "home" && labels.length ? `<div class="video-collection-label">${escapeHtml(labels.join(" \xB7 "))}</div>` : ""}
        <div class="video-title">${escapeHtml(v.title)}</div>
        <div class="video-meta">
          <span>${escapeHtml(channel?.title || "")}</span>
          ${!v.is_short ? `<span>${timeAgo(v.published_at)}</span>` : ""}
        </div>
      </div>
    `;
      card.addEventListener("click", () => {
        window.open(v.url, "_blank", "noopener");
      });
      const watchBtn = card.querySelector(".watch-btn");
      watchBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleWatched(v.id);
      });
      feed.appendChild(card);
    }
  }
  async function renderAll() {
    renderSidebar();
    renderTopbar();
    try {
      await loadFeed();
    } catch (err) {
      console.error(err);
      state.feedVideos = [];
    }
    renderFeed();
    setupCollectionDragDrop();
    setupChannelDragDrop();
  }
  el("homeNavBtn").addEventListener("click", () => {
    state.view = "home";
    state.activeCollectionId = null;
    renderAll();
  });
  el("newCollectionBtn").addEventListener(
    "click",
    () => openModal("newCollectionModal")
  );
  el("emptyCreateBtn").addEventListener(
    "click",
    () => openModal("newCollectionModal")
  );
  el("newCollectionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("newCollectionInput").value.trim();
    if (!name) return;
    console.log("Creating new collection:", name);
    const newCol = { id: Date.now().toString(), name, channelIds: [] };
    state.collections.push(newCol);
    await saveCollections();
    el("newCollectionInput").value = "";
    closeModal("newCollectionModal");
    await loadCollections();
    state.view = "collection";
    state.activeCollectionId = newCol.id;
    await renderAll();
  });
  el("deleteCollectionBtn").addEventListener("click", async () => {
    const col = activeCollection();
    if (!col) return;
    if (!confirm(
      `Delete "${col.name}"? This won't unfollow the channels, just removes this collection.`
    ))
      return;
    state.collections = state.collections.filter((c) => c.id !== col.id);
    await saveCollections();
    closeModal("settingsModal");
    await loadCollections();
    state.view = "home";
    state.activeCollectionId = null;
    await renderAll();
  });
  el("tabSwitch").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.activeTab = btn.dataset.tab;
    renderAll();
  });
  el("hideWatchedToggle").addEventListener("change", (e) => {
    state.hideWatched = e.target.checked;
    renderFeed();
  });
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
      const ch = state.channelsById[channelId];
      if (!ch) continue;
      const li = document.createElement("li");
      li.className = "channel-manage-item";
      li.innerHTML = `
      <img src="${escapeHtml(ch.thumbnail || "")}" alt="" />
      <span class="title">${escapeHtml(ch.title)}</span>
      <button type="button" class="remove-channel-btn" data-id="${ch.id}">Remove</button>
    `;
      list.appendChild(li);
    }
    list.querySelectorAll(".remove-channel-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const channelId = btn.dataset.id;
        col.channelIds = col.channelIds.filter((id) => id !== channelId);
        await saveCollections();
        await loadCollections();
        renderChannelManageList();
        await renderAll();
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
      hint.textContent = err.message;
      hint.style.color = "var(--danger)";
      submitBtn.disabled = false;
      return;
    }
    if (!resolveRes.ok) {
      hint.textContent = resolveRes.error || "Something went wrong. Try again.";
      hint.style.color = "var(--danger)";
      submitBtn.disabled = false;
      return;
    }
    const channel = resolveRes.channel;
    if (!col.channelIds.includes(channel.id)) {
      col.channelIds.push(channel.id);
      await saveCollections();
    }
    hint.textContent = `Added ${channel.title}.`;
    hint.style.color = "";
    input.value = "";
    submitBtn.disabled = false;
    await loadCollections();
    renderChannelManageList();
    sendMessage({ type: "REFRESH_CHANNELS", channelIds: [channel.id] }).then(
      () => {
        loadFeed().then(renderFeed);
      }
    );
    await renderAll();
  });
  el("refreshBtn").addEventListener("click", async () => {
    const btn = el("refreshBtn");
    if (!btn) {
      console.error("Refresh button not found!");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Refreshing...";
    console.log("Refresh clicked, channels:", uniqueChannelIds().length);
    let channelIds = [];
    if (state.view === "channel" && state.activeChannelId)
      channelIds = [state.activeChannelId];
    else if (state.view === "collection")
      channelIds = activeCollection()?.channelIds || [];
    else channelIds = uniqueChannelIds();
    let res;
    try {
      console.log("Sending REFRESH_CHANNELS message for:", channelIds);
      res = await sendMessage({ type: "REFRESH_CHANNELS", channelIds });
      console.log("Refresh response:", res);
    } catch (err) {
      console.error("Refresh error:", err);
      res = { ok: false, error: err.message };
    }
    try {
      await loadCollections();
      await renderAll();
    } catch (err) {
      console.error("Render error:", err);
      res = { ok: false, error: err.message };
    }
    btn.disabled = false;
    btn.textContent = "Refresh";
    if (!res.ok) alert(res.error || "Refresh failed");
  });
  var MODAL_FOCUS = {
    newCollectionModal: "newCollectionInput",
    channelsModal: "addChannelInput"
  };
  function openModal(id) {
    console.log("Opening modal:", id);
    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.hidden = true;
    });
    const modal = el(id);
    if (!modal) {
      console.error("Modal not found:", id);
      return;
    }
    modal.hidden = false;
    const focusId = MODAL_FOCUS[id];
    if (focusId) requestAnimationFrame(() => el(focusId).focus());
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
    const open = [...document.querySelectorAll(".modal-backdrop")].find(
      (m) => !m.hidden
    );
    if (open) open.hidden = true;
  });
  (async function init() {
    try {
      showSignedIn();
      await loadCollections();
      state.view = "home";
      await renderAll();
    } catch (err) {
      console.error("Initialization failed:", err);
    }
  })();
})();
