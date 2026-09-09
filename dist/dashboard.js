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
  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 6e4);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return ` ${days}d ago`;
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
  function setBackupStatus(message, color) {
    const status = el("backupStatus");
    if (!status) return;
    status.textContent = message;
    status.style.color = color || "";
    status.style.display = "block";
  }
  function createBackupId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
  function downloadBackup() {
    const backup = {
      version: 1,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      collections: state.collections,
      channels: state.channelsById
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `channel-collections-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  async function readBackupFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read backup file."));
      reader.readAsText(file);
    });
  }
  function normalizeImportedChannels(channels) {
    const normalized = {};
    for (const [id, channel] of Object.entries(channels || {})) {
      if (!id || !channel || typeof channel.title !== "string") continue;
      const title = channel.title.trim();
      if (!title) continue;
      normalized[id] = {
        id,
        title,
        thumbnail: typeof channel.thumbnail === "string" ? channel.thumbnail : ""
      };
    }
    return normalized;
  }
  function normalizeImportedCollections(collections) {
    if (!Array.isArray(collections)) return [];
    return collections.filter(
      (collection) => collection && typeof collection.name === "string" && collection.name.trim() && Array.isArray(collection.channelIds)
    ).map((collection) => ({
      id: typeof collection.id === "string" && collection.id ? collection.id : createBackupId(),
      name: collection.name.trim(),
      channelIds: collection.channelIds.filter(
        (id) => typeof id === "string" && id
      ),
      ...typeof collection.expanded === "boolean" ? { expanded: collection.expanded } : {}
    }));
  }
  async function importBackupData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("This file is not a valid backup.");
    }
    const importedChannels = normalizeImportedChannels(data.channels);
    const importedCollections = normalizeImportedCollections(data.collections);
    if (Object.keys(importedChannels).length === 0 && importedCollections.length === 0) {
      throw new Error("No collections or channels found in this file.");
    }
    const existingChannelIds = new Set(Object.keys(state.channelsById));
    for (const [id, channel] of Object.entries(importedChannels)) {
      const existing = state.channelsById[id];
      state.channelsById[id] = {
        id,
        title: existing?.title || channel.title,
        thumbnail: existing?.thumbnail || channel.thumbnail
      };
      existingChannelIds.add(id);
    }
    const existingCollectionIds = new Set(state.collections.map((col) => col.id));
    const importedCollectionIds = /* @__PURE__ */ new Set();
    for (const collection of importedCollections) {
      const id = existingCollectionIds.has(collection.id) ? createBackupId() : collection.id;
      importedCollectionIds.add(id);
      state.collections.push({
        id,
        name: collection.name,
        channelIds: [
          ...new Set(
            collection.channelIds.filter((channelId) => existingChannelIds.has(channelId))
          )
        ],
        ...typeof collection.expanded === "boolean" ? { expanded: collection.expanded } : {}
      });
    }
    await saveChannels();
    await saveCollections();
    await loadCollections();
    await renderAll();
    return {
      channels: Object.keys(importedChannels).length,
      collections: importedCollectionIds.size
    };
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
  }
  function renderSidebar() {
    const homeBtn = el("homeNavBtn");
    homeBtn.classList.toggle("active", state.view === "home");
    const list = el("collectionList");
    list.textContent = "";
    for (const col of state.collections) {
      const item = document.createElement("div");
      item.className = "collection-item" + (state.view === "collection" && col.id === state.activeCollectionId ? " active" : "") + (col.expanded === false ? " collapsed" : "");
      item.dataset.id = col.id;
      item.draggable = true;
      const itemMain = document.createElement("div");
      itemMain.className = "collection-item-main";
      const nameSpan = document.createElement("span");
      nameSpan.className = "collection-name";
      nameSpan.dataset.id = col.id;
      nameSpan.textContent = col.name;
      const toggle = document.createElement("div");
      toggle.className = `collection-toggle ${col.expanded === false ? "collapsed" : "expanded"}`;
      toggle.title = "Toggle collection";
      const actions = document.createElement("div");
      actions.className = "collection-actions";
      const renameBtn = document.createElement("button");
      renameBtn.className = "rename-btn";
      renameBtn.dataset.id = col.id;
      renameBtn.title = "Rename";
      renameBtn.textContent = "\u270E";
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.dataset.id = col.id;
      deleteBtn.title = "Delete";
      deleteBtn.textContent = "\xD7";
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      itemMain.appendChild(nameSpan);
      itemMain.appendChild(toggle);
      itemMain.appendChild(actions);
      item.appendChild(itemMain);
      const channelsDiv = document.createElement("div");
      channelsDiv.className = "collection-channels";
      item.appendChild(channelsDiv);
      list.appendChild(item);
      const channelList = item.querySelector(".collection-channels");
      for (const channelId of col.channelIds) {
        const ch = state.channelsById[channelId];
        if (!ch) continue;
        const chItem = document.createElement("div");
        chItem.className = "collection-channel-item" + (state.view === "channel" && ch.id === state.activeChannelId ? " active" : "");
        chItem.draggable = true;
        const chImg = document.createElement("img");
        chImg.src = ch.thumbnail || "";
        chImg.alt = "";
        const chName = document.createElement("span");
        chName.className = "channel-name";
        chName.textContent = ch.title;
        const chActions = document.createElement("div");
        chActions.className = "channel-actions";
        const chRenameBtn = document.createElement("button");
        chRenameBtn.className = "rename-btn";
        chRenameBtn.dataset.id = ch.id;
        chRenameBtn.title = "Rename";
        chRenameBtn.textContent = "\u270E";
        const chRemoveBtn = document.createElement("button");
        chRemoveBtn.className = "remove-channel-btn";
        chRemoveBtn.dataset.id = ch.id;
        chRemoveBtn.title = "Remove";
        chRemoveBtn.textContent = "\xD7";
        chActions.appendChild(chRenameBtn);
        chActions.appendChild(chRemoveBtn);
        chItem.appendChild(chImg);
        chItem.appendChild(chName);
        chItem.appendChild(chActions);
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
    feed.textContent = "";
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
      const thumbWrap = document.createElement("div");
      thumbWrap.className = "video-thumb-wrap";
      const thumb = document.createElement("img");
      thumb.className = "video-thumb";
      thumb.src = v.thumbnail || "";
      thumb.alt = "";
      thumb.loading = "lazy";
      const watchBtn = document.createElement("button");
      watchBtn.type = "button";
      watchBtn.className = "watch-btn" + (isWatched ? " watched" : "");
      watchBtn.dataset.id = v.id;
      watchBtn.title = isWatched ? "Mark as unwatched" : "Mark as watched";
      watchBtn.textContent = isWatched ? "\u2713" : "";
      thumbWrap.appendChild(thumb);
      thumbWrap.appendChild(watchBtn);
      const videoInfo = document.createElement("div");
      videoInfo.className = "video-info";
      if (state.view === "home" && labels.length) {
        const labelDiv = document.createElement("div");
        labelDiv.className = "video-collection-label";
        labelDiv.textContent = labels.join(" \xB7 ");
        videoInfo.appendChild(labelDiv);
      }
      const titleDiv = document.createElement("div");
      titleDiv.className = "video-title";
      titleDiv.textContent = v.title;
      videoInfo.appendChild(titleDiv);
      const meta = document.createElement("div");
      meta.className = "video-meta";
      const channelSpan = document.createElement("span");
      channelSpan.textContent = channel?.title || "";
      meta.appendChild(channelSpan);
      if (!v.is_short) {
        const timeSpan = document.createElement("span");
        timeSpan.textContent = timeAgo(v.published_at);
        meta.appendChild(timeSpan);
      }
      videoInfo.appendChild(meta);
      card.appendChild(thumbWrap);
      card.appendChild(videoInfo);
      card.addEventListener("click", () => {
        window.open(v.url, "_blank", "noopener");
      });
      const watchBtnEl = card.querySelector(".watch-btn");
      watchBtnEl.addEventListener("click", (e) => {
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
  el("settingsBtn").addEventListener("click", () => openModal("settingsModal"));
  function renderChannelManageList() {
    const col = activeCollection();
    const list = el("channelManageList");
    list.textContent = "";
    if (!col) return;
    for (const channelId of col.channelIds) {
      const ch = state.channelsById[channelId];
      if (!ch) continue;
      const li = document.createElement("li");
      li.className = "channel-manage-item";
      const chImg = document.createElement("img");
      chImg.src = ch.thumbnail || "";
      chImg.alt = "";
      const chTitle = document.createElement("span");
      chTitle.className = "title";
      chTitle.textContent = ch.title;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-channel-btn";
      removeBtn.dataset.id = ch.id;
      removeBtn.textContent = "Remove";
      li.appendChild(chImg);
      li.appendChild(chTitle);
      li.appendChild(removeBtn);
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
  el("exportBackupBtn").addEventListener("click", () => {
    try {
      downloadBackup();
      setBackupStatus("Backup exported. Download started.", "");
    } catch (err) {
      setBackupStatus(err.message, "var(--danger)");
    }
  });
  el("importBackupBtn").addEventListener("click", () => {
    el("importBackupInput").click();
  });
  el("importBackupInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupStatus("Importing backup...", "");
    try {
      const content = await readBackupFile(file);
      const data = JSON.parse(content);
      const result = await importBackupData(data);
      setBackupStatus(
        `Imported ${result.channels} channel${result.channels === 1 ? "" : "s"} and ${result.collections} collection${result.collections === 1 ? "" : "s"}.`,
        ""
      );
      e.target.value = "";
    } catch (err) {
      setBackupStatus(err.message, "var(--danger)");
      e.target.value = "";
    }
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
