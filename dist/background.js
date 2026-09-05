(() => {
  // src/background.js
  var VIDEOS_KEY = "ytc_videos";
  var CHANNELS_KEY = "ytc_channels";
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
  async function fetchHtml(url) {
    const res = await fetch(url, {
      headers: { "Accept-Language": "en-US,en;q=0.9" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  }
  function extractInitialData(html) {
    const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!match) throw new Error("Could not find ytInitialData");
    return JSON.parse(match[1]);
  }
  async function resolveChannel(input) {
    let url = input;
    if (!url.startsWith("http")) {
      if (url.startsWith("@") || url.startsWith("UC")) {
        url = `https://www.youtube.com/${url}`;
      } else {
        url = `https://www.youtube.com/@${url}`;
      }
    }
    const html = await fetchHtml(url);
    const data = extractInitialData(html);
    const header = data.header?.c4TabbedHeaderRenderer || data.header?.pageHeaderRenderer;
    if (!header) throw new Error("Could not parse channel header");
    let channelId, title, thumbnail;
    if (data.header?.c4TabbedHeaderRenderer) {
      channelId = header.channelId;
      title = header.title;
      thumbnail = header.avatar?.thumbnails?.[0]?.url;
    } else {
      channelId = data.metadata?.channelMetadataRenderer?.externalId;
      title = header.pageTitle;
      thumbnail = header.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.[0]?.url;
    }
    if (!channelId || !title)
      throw new Error("Could not extract channel details");
    const stored = await storageGet(CHANNELS_KEY);
    const channels = stored[CHANNELS_KEY] || {};
    channels[channelId] = { id: channelId, title, thumbnail };
    await storageSet({ [CHANNELS_KEY]: channels });
    return channels[channelId];
  }
  async function scrapeVideos(channelId, isShorts, isLive) {
    const tab = isShorts ? "shorts" : isLive ? "streams" : "videos";
    console.log(`Scraping ${tab} for channel ${channelId}`);
    try {
      const html = await fetchHtml(
        `https://www.youtube.com/channel/${channelId}/${tab}`
      );
      console.log(`Fetched HTML, length: ${html.length}`);
      const data = extractInitialData(html);
      console.log(`Extracted initial data`);
      const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      console.log(`Found ${tabs.length} tabs`);
      const currentTab = tabs.find((t) => t.tabRenderer?.selected)?.tabRenderer;
      if (!currentTab) {
        console.log("No selected tab found");
        return [];
      }
      const items = currentTab.content?.richGridRenderer?.contents || [];
      console.log(`Found ${items.length} items in grid`);
      const videos = [];
      for (const item of items) {
        let videoId, title, thumbnail, url, publishedAt;
        if (isShorts) {
          const shortsData = item.richItemRenderer?.content?.shortsLockupViewModel;
          if (!shortsData) continue;
          const entityId = shortsData.entityId || "";
          videoId = entityId.replace("shorts-shelf-item-", "");
          const accessibilityText = shortsData.accessibilityText || "";
          if (accessibilityText) {
            const parts = accessibilityText.split(" \u2013 ");
            title = parts[0].trim();
            title = title.replace("play Short", "").trim();
          }
          if (!title || title.trim() === "") {
            title = shortsData.viewModel?.title?.content || shortsData.headline?.simpleText || shortsData.metadata?.title?.content || shortsData.title?.simpleText || "Short";
          }
          thumbnail = shortsData.onTap?.innertubeCommand?.reelWatchEndpoint?.thumbnail?.thumbnails?.[0]?.url;
          url = shortsData.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url;
          if (url && !url.startsWith("http")) {
            url = `https://www.youtube.com${url}`;
          }
          publishedAt = shortsData.publishedTimeText?.content || null;
          if (videos.length < 3) {
            console.log(
              `Shorts publishedAt raw: "${shortsData.publishedTimeText?.content}", fallback: "${shortsData.publishedTimeText?.accessibilityText || ""}"`
            );
          }
        } else if (isLive) {
          const lockupData = item.richItemRenderer?.content?.lockupViewModel;
          if (!lockupData) {
            if (videos.length < 3) console.log("No lockupData found in live item");
            continue;
          }
          if (videos.length < 2) {
            console.log("Full live item structure:", JSON.stringify(item, null, 2));
          }
          thumbnail = lockupData.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
          if (thumbnail) {
            const thumbnailMatch = thumbnail.match(/\/vi\/([^\/]+)/);
            videoId = thumbnailMatch ? thumbnailMatch[1] : null;
          }
          title = lockupData.viewModel?.title?.content || lockupData.headline?.simpleText || lockupData.metadata?.lockupMetadataViewModel?.title?.content || lockupData.metadata?.title?.content || lockupData.metadata?.contentTitle?.content || lockupData.contentTitle?.content || lockupData.accessibilityText || lockupData.title?.simpleText || "";
          if (!title || title.trim() === "") {
            title = item.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.videoRenderer?.title?.simpleText || item.richItemRenderer?.content?.gridVideoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.gridVideoRenderer?.title?.simpleText || item.richItemRenderer?.content?.compactVideoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.compactVideoRenderer?.title?.simpleText || "";
          }
          if (!title || title.trim() === "") {
            const label = lockupData.rendererContext?.accessibilityContext?.label || "";
            if (label) {
              const durationMatch = label.match(/\s+\d+[:\s]\d+.*$/);
              title = durationMatch ? label.replace(durationMatch[0], "") : label;
            }
          }
          if (videos.length < 3) {
            console.log(
              `Live video title extraction attempts - viewModel title: "${lockupData.viewModel?.title?.content}", headline: "${lockupData.headline?.simpleText}", lockupMetadata title: "${lockupData.metadata?.lockupMetadataViewModel?.title?.content}", metadata title: "${lockupData.metadata?.title?.content}", videoRenderer: "${item.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.videoRenderer?.title?.simpleText || ""}", gridVideoRenderer: "${item.richItemRenderer?.content?.gridVideoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.gridVideoRenderer?.title?.simpleText || ""}", final title: "${title}"`
            );
          }
          publishedAt = null;
          const metadataRows = lockupData.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
          if (metadataRows.length > 0 && metadataRows[0].metadataParts) {
            const parts = metadataRows[0].metadataParts;
            for (const part of parts) {
              if (part.text?.content && (part.text.content.includes("ago") || part.text.content.includes("Streamed") || part.text.content.includes("Scheduled"))) {
                publishedAt = part.text.content;
                break;
              }
            }
            if (!publishedAt && parts.length > 1) {
              publishedAt = parts[parts.length - 1]?.text?.content || null;
            }
          }
          if (!publishedAt) {
            publishedAt = lockupData.metadata?.publishedTimeText?.content || null;
          }
          url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
          if (videos.length < 3) {
            console.log(
              `Live publishedAt raw: "${publishedAt}", from metadataRows: ${metadataRows.length > 0}`
            );
          }
        } else {
          const lockupData = item.richItemRenderer?.content?.lockupViewModel;
          if (!lockupData) {
            if (videos.length < 3) console.log("No lockupData found in item");
            continue;
          }
          if (videos.length < 2) {
            console.log("Full item structure:", JSON.stringify(item, null, 2));
          }
          thumbnail = lockupData.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
          if (thumbnail) {
            const thumbnailMatch = thumbnail.match(/\/vi\/([^\/]+)/);
            videoId = thumbnailMatch ? thumbnailMatch[1] : null;
          }
          title = lockupData.viewModel?.title?.content || lockupData.headline?.simpleText || lockupData.metadata?.lockupMetadataViewModel?.title?.content || lockupData.metadata?.title?.content || lockupData.metadata?.contentTitle?.content || lockupData.contentTitle?.content || lockupData.accessibilityText || lockupData.title?.simpleText || "";
          if (!title || title.trim() === "") {
            title = item.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.videoRenderer?.title?.simpleText || item.richItemRenderer?.content?.gridVideoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.gridVideoRenderer?.title?.simpleText || item.richItemRenderer?.content?.compactVideoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.compactVideoRenderer?.title?.simpleText || "";
          }
          if (!title || title.trim() === "") {
            const label = lockupData.rendererContext?.accessibilityContext?.label || "";
            if (label) {
              const durationMatch = label.match(/\s+\d+[:\s]\d+.*$/);
              title = durationMatch ? label.replace(durationMatch[0], "") : label;
            }
          }
          if (videos.length < 3) {
            console.log(
              `Video title extraction attempts - viewModel title: "${lockupData.viewModel?.title?.content}", headline: "${lockupData.headline?.simpleText}", lockupMetadata title: "${lockupData.metadata?.lockupMetadataViewModel?.title?.content}", metadata title: "${lockupData.metadata?.title?.content}", videoRenderer: "${item.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.videoRenderer?.title?.simpleText || ""}", gridVideoRenderer: "${item.richItemRenderer?.content?.gridVideoRenderer?.title?.runs?.[0]?.text || item.richItemRenderer?.content?.gridVideoRenderer?.title?.simpleText || ""}", final title: "${title}"`
            );
          }
          publishedAt = null;
          const metadataRows = lockupData.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
          if (metadataRows.length > 0 && metadataRows[0].metadataParts) {
            const parts = metadataRows[0].metadataParts;
            for (const part of parts) {
              if (part.text?.content && (part.text.content.includes("ago") || part.text.content.includes("Streamed") || part.text.content.includes("Scheduled"))) {
                publishedAt = part.text.content;
                break;
              }
            }
            if (!publishedAt && parts.length > 1) {
              publishedAt = parts[parts.length - 1]?.text?.content || null;
            }
          }
          if (!publishedAt) {
            publishedAt = lockupData.metadata?.publishedTimeText?.content || null;
          }
          url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
          if (videos.length < 3) {
            console.log(
              `Extracted video - ID: ${videoId}, URL: ${url}, Title: ${title}, Thumbnail: ${thumbnail}`
            );
          }
        }
        if (!videoId || !url) continue;
        const finalPublishedAt = publishedAt ? parsePublishedTime(publishedAt) : (/* @__PURE__ */ new Date()).toISOString();
        if (videos.length < 3) {
          console.log(
            `Parsed time for ${isShorts ? "short" : isLive ? "live" : "video"} ${videoId}: raw="${publishedAt}", parsed="${finalPublishedAt}"`
          );
        }
        videos.push({
          id: videoId,
          channel_id: channelId,
          title: title || "Unknown title",
          thumbnail: thumbnail || "",
          published_at: finalPublishedAt,
          is_short: isShorts,
          is_live: isLive,
          url
        });
      }
      console.log(`Successfully scraped ${videos.length} ${tab}`);
      return videos;
    } catch (err) {
      console.error(`Error scraping ${tab} for channel ${channelId}:`, err);
      return [];
    }
  }
  function parsePublishedTime(timeText) {
    if (!timeText) return (/* @__PURE__ */ new Date()).toISOString();
    const text = timeText.toLowerCase().trim();
    const isoMatch = timeText.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
      return new Date(isoMatch[1]).toISOString();
    }
    if (text.startsWith("yesterday")) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - 1);
      const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3]?.toLowerCase();
        if (ampm === "pm" && hours !== 12) hours += 12;
        if (ampm === "am" && hours === 12) hours = 0;
        d.setHours(hours, minutes, 0, 0);
      } else {
        d.setHours(0, 0, 0, 0);
      }
      return d.toISOString();
    }
    const cleanedText = text.replace(/^premiered\s+/, "").replace(/^streamed\s+/, "").replace(/^scheduled for\s+/, "").trim();
    if (cleanedText === "live now" || cleanedText === "live") {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    if (cleanedText.includes("hour") || cleanedText.includes("hr")) {
      const match = cleanedText.match(/(\d+)/);
      const hours = match ? parseInt(match[1]) : 1;
      const d = /* @__PURE__ */ new Date();
      d.setHours(d.getHours() - hours);
      return d.toISOString();
    }
    if (cleanedText.includes("minute") || cleanedText.includes("min")) {
      const match = cleanedText.match(/(\d+)/);
      const minutes = match ? parseInt(match[1]) : 1;
      const d = /* @__PURE__ */ new Date();
      d.setMinutes(d.getMinutes() - minutes);
      return d.toISOString();
    }
    if (cleanedText.includes("second") || cleanedText.includes("sec")) {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    if (cleanedText.includes("day") || cleanedText.includes("days")) {
      const match = cleanedText.match(/(\d+)/);
      const days = match ? parseInt(match[1]) : 1;
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString();
    }
    if (cleanedText.includes("week") || cleanedText.includes("weeks")) {
      const match = cleanedText.match(/(\d+)/);
      const weeks = match ? parseInt(match[1]) : 1;
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - weeks * 7);
      return d.toISOString();
    }
    if (cleanedText.includes("month") || cleanedText.includes("months")) {
      const match = cleanedText.match(/(\d+)/);
      const months = match ? parseInt(match[1]) : 1;
      const d = /* @__PURE__ */ new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString();
    }
    if (cleanedText.includes("year") || cleanedText.includes("years")) {
      const match = cleanedText.match(/(\d+)/);
      const years = match ? parseInt(match[1]) : 1;
      const d = /* @__PURE__ */ new Date();
      d.setFullYear(d.getFullYear() - years);
      return d.toISOString();
    }
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    for (let i = 0; i < monthNames.length; i++) {
      if (cleanedText.includes(monthNames[i])) {
        const parsed = new Date(timeText);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }
    }
    if (timeText.includes("T")) {
      return timeText;
    }
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  async function refreshChannels(channelIds) {
    const stored = await storageGet(VIDEOS_KEY);
    let allVideos = stored[VIDEOS_KEY] || [];
    allVideos = allVideos.filter((v) => !channelIds.includes(v.channel_id));
    for (const id of channelIds) {
      try {
        const videos = await scrapeVideos(id, false, false);
        const shorts = await scrapeVideos(id, true, false);
        const live = await scrapeVideos(id, false, true);
        allVideos.push(...videos, ...shorts, ...live);
      } catch (err) {
        console.error(`Failed to refresh channel ${id}:`, err);
      }
    }
    if (allVideos.length > 1e3) {
      allVideos = allVideos.slice(-1e3);
    }
    await storageSet({ [VIDEOS_KEY]: allVideos });
    return { refreshed: channelIds.length };
  }
  chrome.browserAction.onClicked.addListener(() => {
    console.log("Extension icon clicked");
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log("Background received message:", msg.type);
    (async () => {
      try {
        switch (msg.type) {
          case "RESOLVE_CHANNEL": {
            const channel = await resolveChannel(msg.input);
            sendResponse({ ok: true, channel });
            break;
          }
          case "REFRESH_CHANNELS": {
            const result = await refreshChannels(msg.channelIds || []);
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
    return true;
  });
})();
