const videoList = document.getElementById("videoList");
const noVideos = document.getElementById("noVideos");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const advancedBtn = document.getElementById("advancedBtn");

let currentTabId = null;

// Direct video file extensions
const VIDEO_EXTENSIONS = [
  ".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv", ".m4v", ".flv", ".wmv",
  ".3gp", ".ts", ".m4s", ".f4v", ".vob"
];

// Streaming manifest extensions
const MANIFEST_EXTENSIONS = [".m3u8", ".mpd"];

// Video MIME types
const VIDEO_MIMETYPES = [
  "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-msvideo",
  "video/x-matroska", "video/x-flv", "video/3gpp", "video/MP2T", "video/x-ms-wmv",
  "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/dash+xml",
  "audio/mpegurl", "audio/x-mpegurl"
];

// Common video CDN/streaming domains
const VIDEO_DOMAINS = [
  "cloudfront.net", "akamaihd.net", "akamai.net", "fastly.net", "cdn.com",
  "cloudflare.com", "jsdelivr.net", "vimeocdn.com", "jwpcdn.com", "brightcove",
  "mux.com", "stream.mux.com", "vidyard.com", "wistia.com", "limelight.com",
  "edgecast.net", "llnwd.net", "bitmovin.com", "theplatform.com", "ooyala.com",
  "kaltura.com", "vzaar.com", "sproutvideo.com", "bunnycdn.com", "b-cdn.net"
];

// URL path patterns that indicate video content
const VIDEO_PATH_PATTERNS = [
  /\/video[s]?\//i,
  /\/media\//i,
  /\/stream[s]?\//i,
  /\/hls\//i,
  /\/dash\//i,
  /\/vod\//i,
  /\/live\//i,
  /\/playlist\//i,
  /\/manifest/i,
  /\/chunk[s]?\//i,
  /\/segment[s]?\//i,
  /\/frag[s]?\//i,
  /\/clip[s]?\//i,
  /\/asset[s]?\//i,
  /\/embed\//i,
  /\/player\//i
];

// Query parameter patterns that indicate video
const VIDEO_QUERY_PATTERNS = [
  /[?&]video/i,
  /[?&]v=/i,
  /[?&]itag=/i,
  /[?&]mime=video/i,
  /[?&]format=/i,
  /[?&]quality=/i,
  /[?&]resolution=/i,
  /[?&]bitrate=/i,
  /[?&]range=/i,
  /[?&]dur=/i,
  /[?&]source=video/i,
  /[?&]type=video/i
];

// Minimum size threshold for considering something a video (500KB)
const MIN_VIDEO_SIZE = 500 * 1024;

function isVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  
  // Skip data URLs and blob URLs (can't download directly)
  if (lower.startsWith("data:") || lower.startsWith("blob:")) {
    return false;
  }
  
  // Check direct video file extensions
  for (const ext of VIDEO_EXTENSIONS) {
    // Match extension at end or before query string
    if (lower.includes(ext + "?") || lower.endsWith(ext)) return true;
  }
  
  // Check streaming manifest extensions
  for (const ext of MANIFEST_EXTENSIONS) {
    if (lower.includes(ext + "?") || lower.endsWith(ext)) return true;
  }
  
  // Check video CDN domains
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    for (const domain of VIDEO_DOMAINS) {
      if (hostname.includes(domain)) return true;
    }
  } catch {
    // Invalid URL, skip domain check
  }
  
  // Check URL path patterns
  for (const pattern of VIDEO_PATH_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  
  // Check query parameter patterns
  for (const pattern of VIDEO_QUERY_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  
  return false;
}

function isStreamingManifest(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  for (const ext of MANIFEST_EXTENSIONS) {
    if (lower.includes(ext)) return true;
  }
  return false;
}

function hasVideoContentType(headers) {
  if (!headers) return false;
  const contentType = headers.find((h) => h.name.toLowerCase() === "content-type");
  if (!contentType) return false;
  
  const value = contentType.value.toLowerCase();
  for (const mime of VIDEO_MIMETYPES) {
    if (value.includes(mime)) return true;
  }
  return false;
}

function hasRangeSupport(headers) {
  if (!headers) return false;
  return headers.some((h) => {
    const name = h.name.toLowerCase();
    return name === "accept-ranges" || name === "content-range";
  });
}

function getVideoType(entry) {
  const url = (entry.url || "").toLowerCase();
  
  if (url.includes(".m3u8")) return "HLS Stream";
  if (url.includes(".mpd")) return "DASH Stream";
  if (url.includes(".ts") && !url.includes(".ts?")) return "HLS Segment";
  if (url.includes(".m4s")) return "DASH Segment";
  if (url.includes(".mp4")) return "MP4";
  if (url.includes(".webm")) return "WebM";
  if (url.includes(".mov")) return "QuickTime";
  if (url.includes(".mkv")) return "Matroska";
  if (url.includes(".flv")) return "Flash Video";
  if (url.includes(".avi")) return "AVI";
  
  // Check content-type header
  const contentType = (entry.responseHeaders || [])
    .find((h) => h.name.toLowerCase() === "content-type");
  if (contentType) {
    const value = contentType.value.toLowerCase();
    if (value.includes("mpegurl") || value.includes("m3u")) return "HLS Stream";
    if (value.includes("dash")) return "DASH Stream";
    if (value.includes("mp4")) return "MP4";
    if (value.includes("webm")) return "WebM";
    if (value.includes("video")) return "Video";
  }
  
  if (entry.type === "media") return "Media";
  return "Video";
}

function getFileName(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments.pop() || "";
    
    // Try to extract a clean filename
    const match = last.match(/([^?#]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    return last || parsed.hostname;
  } catch {
    return "video";
  }
}

function formatBytes(bytes) {
  if (!bytes) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

function createVideoItem(entry) {
  const item = document.createElement("div");
  item.className = "video-item";
  
  const name = getFileName(entry.url);
  const size = formatBytes(entry.size);
  const videoType = getVideoType(entry);
  const isManifest = isStreamingManifest(entry.url);
  
  item.innerHTML = `
    <div class="video-name">${escapeHtml(name)}</div>
    <div class="video-meta">
      <span class="video-type-badge">${videoType}</span>
      ${size} ${entry.status ? `• ${entry.status}` : ""}
    </div>
    <div class="video-actions">
      <button class="btn btn-secondary btn-small copy-btn">Copy URL</button>
      ${isManifest 
        ? `<button class="btn btn-secondary btn-small copy-cmd-btn">Copy ffmpeg</button>`
        : `<button class="btn btn-primary btn-small download-btn">Download</button>`
      }
    </div>
  `;
  
  const copyBtn = item.querySelector(".copy-btn");
  const downloadBtn = item.querySelector(".download-btn");
  const copyCmdBtn = item.querySelector(".copy-cmd-btn");
  
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(entry.url).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy URL";
      }, 1500);
    });
  });
  
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      chrome.downloads.download({
        url: entry.url,
        filename: name
      });
      downloadBtn.textContent = "Started!";
      setTimeout(() => {
        downloadBtn.textContent = "Download";
      }, 1500);
    });
  }
  
  if (copyCmdBtn) {
    copyCmdBtn.addEventListener("click", () => {
      const cmd = `ffmpeg -i "${entry.url}" -c copy output.mp4`;
      navigator.clipboard.writeText(cmd).then(() => {
        copyCmdBtn.textContent = "Copied!";
        setTimeout(() => {
          copyCmdBtn.textContent = "Copy ffmpeg";
        }, 1500);
      });
    });
  }
  
  return item;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function scanForVideos() {
  status.textContent = "Scanning...";
  videoList.innerHTML = "";
  noVideos.style.display = "none";
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) {
      status.textContent = "No active tab found.";
      return;
    }
    
    currentTabId = tab.id;
    
    const response = await chrome.runtime.sendMessage({
      type: "getRequests",
      tabId: currentTabId
    });
    
    const requests = response.requests || [];
    
    // Filter for video requests using multiple detection strategies
    const videos = requests.filter((entry) => {
      // Strategy 1: Resource type is media
      if (entry.type === "media") return true;
      
      // Strategy 2: URL pattern matching
      if (isVideoUrl(entry.url)) return true;
      
      // Strategy 3: Response headers indicate video content
      if (hasVideoContentType(entry.responseHeaders)) return true;
      
      // Strategy 4: Large file with range support (likely video)
      if (entry.size >= MIN_VIDEO_SIZE && hasRangeSupport(entry.responseHeaders)) {
        return true;
      }
      
      // Strategy 5: Large XHR/fetch that could be video chunks
      if ((entry.type === "xhr" || entry.type === "fetch") && entry.size >= MIN_VIDEO_SIZE) {
        // Additional check: has video-like content type
        if (hasVideoContentType(entry.responseHeaders)) return true;
      }
      
      return false;
    });
    
    // Deduplicate by URL, preferring entries with more info
    const seen = new Map();
    for (const video of videos) {
      const existing = seen.get(video.url);
      if (!existing || (video.size > existing.size)) {
        seen.set(video.url, video);
      }
    }
    const unique = Array.from(seen.values());
    
    // Sort: manifests first, then by size descending
    unique.sort((a, b) => {
      const aManifest = isStreamingManifest(a.url) ? 1 : 0;
      const bManifest = isStreamingManifest(b.url) ? 1 : 0;
      if (bManifest !== aManifest) return bManifest - aManifest;
      return (b.size || 0) - (a.size || 0);
    });
    
    if (unique.length === 0) {
      status.textContent = "No videos detected.";
      noVideos.style.display = "block";
      return;
    }
    
    const manifestCount = unique.filter((v) => isStreamingManifest(v.url)).length;
    const directCount = unique.length - manifestCount;
    
    let statusText = `Found ${unique.length} video(s)`;
    if (manifestCount > 0 && directCount > 0) {
      statusText = `Found ${directCount} video(s), ${manifestCount} stream(s)`;
    } else if (manifestCount > 0) {
      statusText = `Found ${manifestCount} stream(s)`;
    }
    status.textContent = statusText;
    
    for (const video of unique) {
      videoList.appendChild(createVideoItem(video));
    }
    
  } catch (error) {
    status.textContent = "Error scanning page.";
    console.error(error);
  }
}

refreshBtn.addEventListener("click", () => {
  scanForVideos();
});

advancedBtn.addEventListener("click", async () => {
  const url = chrome.runtime.getURL(`ui/panel.html?tabId=${currentTabId || ""}`);
  await chrome.tabs.create({ url });
  window.close();
});

// Initial scan
scanForVideos();
