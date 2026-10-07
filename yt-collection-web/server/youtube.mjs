async function fetchHtml(url) {
  const res = await fetch(url, {
    credentials: "omit",
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

function extractInitialData(html) {
  const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
  if (!match) throw new Error("Could not find ytInitialData");
  return JSON.parse(match[1]);
}

function extractYtcfg(html) {
  return {
    apiKey: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || null,
    clientVersion:
      html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || null,
  };
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

  const header =
    data.header?.c4TabbedHeaderRenderer || data.header?.pageHeaderRenderer;
  if (!header) throw new Error("Could not parse channel header");

  let channelId, title, thumbnail;

  if (data.header?.c4TabbedHeaderRenderer) {
    channelId = header.channelId;
    title = header.title;
    thumbnail = header.avatar?.thumbnails?.[0]?.url;
  } else {
    channelId = data.metadata?.channelMetadataRenderer?.externalId;
    title = header.pageTitle;
    thumbnail =
      header.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel
        ?.avatar?.avatarViewModel?.image?.sources?.[0]?.url;
  }

  if (!channelId || !title)
    throw new Error("Could not extract channel details");

  return { id: channelId, title, thumbnail };
}

function looksLikeTime(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    /\bago\b/.test(t) ||
    t.includes("streamed") ||
    t.includes("premiered") ||
    t.includes("scheduled") ||
    t === "live" ||
    t === "live now" ||
    t.startsWith("yesterday")
  );
}

function extractPublishedText(lockupData) {
  const rows =
    lockupData.metadata?.lockupMetadataViewModel?.metadata
      ?.contentMetadataViewModel?.metadataRows || [];
  for (const row of rows) {
    for (const part of row.metadataParts || []) {
      const label = part.accessibilityLabel || part.text?.accessibilityLabel;
      const content = part.text?.content;
      if (looksLikeTime(label)) return label;
      if (looksLikeTime(content)) return content;
    }
  }
  const published =
    lockupData.metadata?.publishedTimeText?.content ||
    lockupData.publishedTimeText?.simpleText ||
    lockupData.publishedTimeText?.content;
  return looksLikeTime(published) ? published : null;
}

function extractTitle(lockupData, item) {
  const title =
    lockupData.metadata?.lockupMetadataViewModel?.title?.content ||
    lockupData.viewModel?.title?.content ||
    lockupData.headline?.simpleText ||
    lockupData.metadata?.title?.content ||
    lockupData.title?.simpleText ||
    item.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text ||
    item.richItemRenderer?.content?.videoRenderer?.title?.simpleText ||
    item.richItemRenderer?.content?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item.richItemRenderer?.content?.gridVideoRenderer?.title?.simpleText ||
    "";
  if (title && title.trim()) return title.trim();
  const label = lockupData.rendererContext?.accessibilityContext?.label || "";
  if (!label) return "";
  const durationMatch = label.match(/\s+\d+[:\s]\d+.*$/);
  return (durationMatch ? label.replace(durationMatch[0], "") : label).trim();
}

function extractThumbnail(lockupData) {
  return (
    lockupData.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url || ""
  );
}

function extractVideoId(lockupData, thumbnail) {
  if (lockupData.contentId) return lockupData.contentId;
  if (lockupData.onTap?.innertubeCommand?.watchEndpoint?.videoId) {
    return lockupData.onTap.innertubeCommand.watchEndpoint.videoId;
  }
  if (thumbnail) {
    const match = thumbnail.match(/\/vi\/([^/]+)/);
    if (match) return match[1];
  }
  return null;
}

function getSelectedTab(data) {
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  return tabs.find((t) => t.tabRenderer?.selected)?.tabRenderer || null;
}

function getGrid(tab) {
  return tab?.content?.richGridRenderer || null;
}

function getChips(grid) {
  const chips = grid?.header?.chipBarViewModel?.chips || [];
  return chips
    .map((c) => c.chipViewModel)
    .filter(Boolean)
    .map((chip) => ({
      text: (chip.text || "").toLowerCase(),
      selected: Boolean(chip.selected),
      token: chip.tapCommand?.innertubeCommand?.continuationCommand?.token || null,
    }));
}

function tokenFromItems(items) {
  return (
    items?.find((item) => item.continuationItemRenderer)?.continuationItemRenderer
      ?.continuationEndpoint?.continuationCommand?.token || null
  );
}

function tokenFromContinuations(continuations) {
  if (!continuations?.length) return null;
  const entry = continuations[0];
  return (
    entry.nextContinuationData?.continuation ||
    entry.continuationCommand?.token ||
    entry.reloadContinuationData?.continuation ||
    null
  );
}

function browseContinuationResult(data) {
  const actions =
    data?.onResponseReceivedActions || data?.onResponseReceivedEndpoints || [];
  for (const action of actions) {
    const reload = action.reloadContinuationItemsCommand;
    if (reload?.continuationItems?.length) {
      return {
        items: reload.continuationItems,
        token:
          tokenFromItems(reload.continuationItems) ||
          tokenFromContinuations(reload.continuations),
      };
    }
    const append = action.appendContinuationItemsAction;
    if (append?.continuationItems?.length) {
      return {
        items: append.continuationItems,
        token:
          tokenFromItems(append.continuationItems) ||
          tokenFromContinuations(append.continuations),
      };
    }
  }
  const grid = data?.continuationContents?.richGridContinuation;
  if (grid) {
    const items = grid.contents || [];
    return {
      items,
      token: tokenFromItems(items) || tokenFromContinuations(grid.continuations),
    };
  }
  return { items: [], token: null };
}


async function fetchBrowseContinuation(token, ytcfg) {
  if (!token) return { items: [], token: null };
  const keyParam = ytcfg?.apiKey ? `key=${encodeURIComponent(ytcfg.apiKey)}&` : "";
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/browse?${keyParam}prettyPrint=false`,
    {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com/",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: ytcfg?.clientVersion || "2.20250901.00.00",
            hl: "en",
            gl: "US",
          },
        },
        continuation: token,
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} browsing continuation`);
  return browseContinuationResult(await res.json());
}

const RECENT_WINDOW_DAYS = 7;
const MIN_VIDEOS_PER_CHANNEL = 50;
const MAX_SCRAPE_PAGES = 40;

function videoPublishedMs(video) {
  if (!video?.published_at) return null;
  const t = new Date(video.published_at).getTime();
  return Number.isNaN(t) ? null : t;
}

function hasVideoOlderThanDays(videos, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return videos.some((video) => {
    const t = videoPublishedMs(video);
    return t !== null && t < cutoff;
  });
}

function needsAnotherPage(videos) {
  const dated = videos.filter((video) => videoPublishedMs(video) !== null);
  if (dated.length === 0) return videos.length < MIN_VIDEOS_PER_CHANNEL;
  if (!hasVideoOlderThanDays(videos, RECENT_WINDOW_DAYS)) return true;
  return videos.length < MIN_VIDEOS_PER_CHANNEL;
}

function takeChannelVideos(videos) {
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sorted = [...videos].sort(
    (a, b) => (videoPublishedMs(b) || 0) - (videoPublishedMs(a) || 0),
  );
  const withinWindow = sorted.filter((video) => {
    const t = videoPublishedMs(video);
    return t !== null && t >= cutoff;
  });
  if (withinWindow.length >= MIN_VIDEOS_PER_CHANNEL) return withinWindow;
  return sorted.slice(0, MIN_VIDEOS_PER_CHANNEL);
}

function parsePublishedTime(timeText) {
  if (!timeText) return null;

  const isoMatch = String(timeText).match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[1]);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const text = String(timeText)
    .toLowerCase()
    .trim()
    .replace(/^premiered\s+/, "")
    .replace(/^streamed\s+/, "")
    .replace(/^scheduled for\s+/, "")
    .trim();

  if (text === "live now" || text === "live") {
    return new Date().toISOString();
  }

  if (text.startsWith("yesterday")) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const timeMatch = String(timeText).match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3]?.toLowerCase();
      if (ampm === "pm" && hours !== 12) hours += 12;
      if (ampm === "am" && hours === 12) hours = 0;
      d.setHours(hours, minutes, 0, 0);
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d.toISOString();
  }

  const match = text.match(
    /(\d+)\s*(months?|minutes?|mins?|hours?|hrs?|seconds?|secs?|years?|yrs?|weeks?|days?|mos?|mo|[ywdhms])\s*ago/,
  );
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const d = new Date();
    if (unit === "s" || unit.startsWith("sec")) {
      d.setSeconds(d.getSeconds() - amount);
    } else if (unit === "mo" || unit.startsWith("month")) {
      d.setMonth(d.getMonth() - amount);
    } else if (unit === "m" || unit.startsWith("min")) {
      d.setMinutes(d.getMinutes() - amount);
    } else if (unit === "h" || unit.startsWith("hour") || unit.startsWith("hr")) {
      d.setHours(d.getHours() - amount);
    } else if (unit === "d" || unit.startsWith("day")) {
      d.setDate(d.getDate() - amount);
    } else if (unit === "w" || unit.startsWith("week")) {
      d.setDate(d.getDate() - amount * 7);
    } else if (unit === "y" || unit.startsWith("year") || unit.startsWith("yr")) {
      d.setFullYear(d.getFullYear() - amount);
    } else {
      return null;
    }
    return d.toISOString();
  }

  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  if (monthNames.some((name) => text.includes(name))) {
    const parsed = new Date(timeText);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (String(timeText).includes("T")) {
    const parsed = new Date(timeText);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

function processGridItems(items, channelId, isShorts, isLive) {
  const videos = [];

  for (const item of items) {
    let videoId = null;
    let title = "";
    let thumbnail = "";
    let url = null;
    let publishedAt = null;

    if (isShorts) {
      const shortsData = item.richItemRenderer?.content?.shortsLockupViewModel;
      if (!shortsData) continue;

      videoId =
        shortsData.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
        (shortsData.entityId || "").replace("shorts-shelf-item-", "");

      const accessibilityText = shortsData.accessibilityText || "";
      if (accessibilityText) {
        title = accessibilityText.split(" – ")[0].trim().replace(/play Short$/i, "").trim();
      }
      if (!title) {
        title =
          shortsData.viewModel?.title?.content ||
          shortsData.headline?.simpleText ||
          shortsData.metadata?.title?.content ||
          shortsData.title?.simpleText ||
          "Short";
      }

      thumbnail =
        shortsData.onTap?.innertubeCommand?.reelWatchEndpoint?.thumbnail
          ?.thumbnails?.[0]?.url || "";
      url =
        shortsData.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata
          ?.url || (videoId ? `/shorts/${videoId}` : null);
      if (url && !url.startsWith("http")) url = `https://www.youtube.com${url}`;

      publishedAt =
        shortsData.publishedTimeText?.content ||
        shortsData.publishedTimeText?.accessibilityText ||
        null;
    } else {
      const lockupData = item.richItemRenderer?.content?.lockupViewModel;
      if (!lockupData) continue;

      thumbnail = extractThumbnail(lockupData);
      videoId = extractVideoId(lockupData, thumbnail);
      title = extractTitle(lockupData, item);
      publishedAt = extractPublishedText(lockupData);
      url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
    }

    if (!videoId || !url) continue;

    videos.push({
      id: videoId,
      channel_id: channelId,
      title: title || "Unknown title",
      thumbnail: thumbnail || "",
      published_at: parsePublishedTime(publishedAt),
      is_short: isShorts,
      is_live: isLive,
      url,
    });
  }

  return videos;
}

async function scrapeVideos(channelId, isShorts, isLive) {
  const tab = isShorts ? "shorts" : isLive ? "streams" : "videos";

  try {
    const pageUrl = `https://www.youtube.com/channel/${channelId}/${tab}`;
    const html = await fetchHtml(pageUrl);
    const data = extractInitialData(html);
    const ytcfg = extractYtcfg(html);
    const currentTab = getSelectedTab(data);
    if (!currentTab) return [];

    let grid = getGrid(currentTab);
    let items = grid?.contents || [];
    let continuationToken =
      tokenFromItems(items) || tokenFromContinuations(grid?.continuations);

    if (!isShorts && !isLive && grid) {
      const chips = getChips(grid);
      const popular = chips.find((c) => c.text === "popular");
      const latest = chips.find((c) => c.text === "latest");
      if (popular?.selected && latest?.token) {
        try {
          const latestPage = await fetchBrowseContinuation(latest.token, ytcfg);
          if (latestPage.items.length) {
            items = latestPage.items;
            continuationToken = latestPage.token;
          }
        } catch (err) {
          console.error("Failed to load Latest chip, using current tab:", err);
        }
      }
    }

    const videos = processGridItems(items, channelId, isShorts, isLive);
    const seen = new Set(videos.map((video) => video.id));
    let pageCount = 0;

    while (
      continuationToken &&
      pageCount < MAX_SCRAPE_PAGES &&
      needsAnotherPage(videos)
    ) {
      pageCount += 1;
      try {
        const page = await fetchBrowseContinuation(continuationToken, ytcfg);
        if (!page.items.length) break;
        const pageVideos = processGridItems(
          page.items,
          channelId,
          isShorts,
          isLive,
        );
        let added = 0;
        for (const video of pageVideos) {
          if (seen.has(video.id)) continue;
          seen.add(video.id);
          videos.push(video);
          added += 1;
        }
        continuationToken = page.token;
        if (!continuationToken || added === 0) break;
      } catch (err) {
        console.error(`Error fetching ${tab} page ${pageCount + 1}:`, err);
        break;
      }
    }

    return videos;
  } catch (err) {
    console.error(`Error scraping ${tab} for channel ${channelId}:`, err);
    return [];
  }
}

export async function refreshChannels(channelIds, allVideos = []) {
    const previousById = new Map();
    for (const video of allVideos) {
      if (
        channelIds.includes(video.channel_id) &&
        video.id &&
        video.published_at
      ) {
        previousById.set(video.id, video.published_at);
      }
    }

    allVideos = allVideos.filter((v) => !channelIds.includes(v.channel_id));

    for (const id of channelIds) {
      try {
        const videos = await scrapeVideos(id, false, false);
        const shorts = await scrapeVideos(id, true, false);
        const live = await scrapeVideos(id, false, true);
        const scraped = [...videos, ...shorts, ...live].map((video) => {
          if (!video.published_at && previousById.has(video.id)) {
            return { ...video, published_at: previousById.get(video.id) };
          }
          return video;
        });
        allVideos.push(
          ...takeChannelVideos(
            scraped.filter((video) => !video.is_short && !video.is_live),
          ),
          ...takeChannelVideos(scraped.filter((video) => video.is_short)),
          ...takeChannelVideos(scraped.filter((video) => video.is_live)),
        );
      } catch (err) {
        // Skip failed channels
      }
    }

    allVideos.sort(
      (a, b) => (videoPublishedMs(b) || 0) - (videoPublishedMs(a) || 0),
    );
    if (allVideos.length > 10000) {
      allVideos = allVideos.slice(0, 10000);
    }

    return allVideos;
}

export { resolveChannel };
