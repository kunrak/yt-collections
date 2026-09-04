// background.js — service worker
// Handles all YouTube Data API calls, periodic refresh, and chrome.storage access.
// The dashboard never calls the API directly; it sends messages here instead.

const API_BASE = "https://www.googleapis.com/youtube/v3";
const REFRESH_ALARM = "refresh-channels";
const REFRESH_MINUTES = 45;
const MAX_VIDEOS_PER_CHANNEL = 20;

// ---------- storage helpers ----------

async function getStore() {
  const data = await chrome.storage.local.get([
    "apiKey",
    "collections",
    "channels",
    "videos",
  ]);
  return {
    apiKey: data.apiKey || "",
    collections: data.collections || {},
    channels: data.channels || {},
    videos: data.videos || {},
  };
}

async function setStore(partial) {
  await chrome.storage.local.set(partial);
}

// ---------- YouTube Data API ----------

async function apiGet(path, params) {
  const { apiKey } = await getStore();
  if (!apiKey) throw new Error("NO_API_KEY");

  const url = new URL(`${API_BASE}/${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) {
    const msg = body?.error?.message || `YouTube API error (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

// Parse an ISO-8601 duration like "PT4M13S" into whole seconds.
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (parseInt(h || 0) * 3600) + (parseInt(min || 0) * 60) + parseInt(s || 0);
}

// Resolve a channel from a handle (@name), a raw channel ID (UC...), or a full URL.
// Returns { id, title, thumbnail, uploadsPlaylistId }.
async function resolveChannel(input) {
  let handle = null;
  let channelId = null;

  const trimmed = input.trim();
  const urlMatch = trimmed.match(
    /(?:youtube\.com|youtu\.be)\/(?:@([\w.-]+)|channel\/(UC[\w-]{22}))/i
  );

  if (urlMatch) {
    if (urlMatch[1]) handle = urlMatch[1];
    else channelId = urlMatch[2];
  } else if (trimmed.startsWith("@")) {
    handle = trimmed.slice(1);
  } else if (/^UC[\w-]{22}$/.test(trimmed)) {
    channelId = trimmed;
  } else {
    handle = trimmed.replace(/^@/, "");
  }

  const params = { part: "snippet,contentDetails" };
  if (channelId) params.id = channelId;
  else params.forHandle = handle;

  const data = await apiGet("channels", params);
  const item = data.items?.[0];
  if (!item) throw new Error("Channel not found. Check the handle or URL.");

  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

// Fetch the most recent uploads for one channel and classify Videos vs Shorts.
async function fetchChannelVideos(channel) {
  const playlistData = await apiGet("playlistItems", {
    part: "snippet,contentDetails",
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(MAX_VIDEOS_PER_CHANNEL),
  });

  const items = playlistData.items || [];
  if (items.length === 0) return [];

  const videoIds = items.map((it) => it.contentDetails.videoId).join(",");
  const detailsData = await apiGet("videos", {
    part: "contentDetails,snippet",
    id: videoIds,
  });

  const durationById = {};
  for (const v of detailsData.items || []) {
    durationById[v.id] = parseDuration(v.contentDetails.duration);
  }

  return items
    .map((it) => {
      const id = it.contentDetails.videoId;
      const durationSec = durationById[id] ?? 0;
      return {
        id,
        channelId: channel.id,
        title: it.snippet.title,
        thumbnail:
          it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
        publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
        durationSec,
        isShort: durationSec > 0 && durationSec <= 60,
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

// Refresh every followed channel and persist results.
async function refreshAll() {
  const { channels, videos } = await getStore();
  const channelList = Object.values(channels);
  const nextVideos = { ...videos };
  const errors = [];

  for (const channel of channelList) {
    try {
      nextVideos[channel.id] = await fetchChannelVideos(channel);
    } catch (err) {
      errors.push({ channelId: channel.id, message: err.message });
    }
  }

  await setStore({ videos: nextVideos, lastRefreshedAt: Date.now() });
  return { refreshed: channelList.length, errors };
}

// ---------- alarm-driven polling ----------

function ensureAlarm() {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshAll().catch(() => {});
});

// Open the dashboard as a full tab when the toolbar icon is clicked.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// ---------- message bridge for dashboard.js ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "RESOLVE_CHANNEL": {
          const channel = await resolveChannel(msg.input);
          sendResponse({ ok: true, channel });
          break;
        }
        case "ADD_CHANNEL": {
          const { channels } = await getStore();
          channels[msg.channel.id] = msg.channel;
          await setStore({ channels });
          const videos = (await getStore()).videos;
          let warning = null;
          try {
            videos[msg.channel.id] = await fetchChannelVideos(msg.channel);
          } catch (err) {
            videos[msg.channel.id] = videos[msg.channel.id] || [];
            warning = err.message;
          }
          await setStore({ videos });
          sendResponse({ ok: true, warning });
          break;
        }
        case "REMOVE_CHANNEL": {
          const store = await getStore();
          delete store.channels[msg.channelId];
          delete store.videos[msg.channelId];
          for (const col of Object.values(store.collections)) {
            col.channelIds = col.channelIds.filter((id) => id !== msg.channelId);
          }
          await setStore({
            channels: store.channels,
            videos: store.videos,
            collections: store.collections,
          });
          sendResponse({ ok: true });
          break;
        }
        case "REFRESH_ALL": {
          const result = await refreshAll();
          sendResponse({ ok: true, result });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the message channel open for the async response
});
