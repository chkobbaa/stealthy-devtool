const videoList = document.getElementById("videoList");
const noVideos = document.getElementById("noVideos");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const advancedBtn = document.getElementById("advancedBtn");
const segmentGroup = document.getElementById("segmentGroup");
const segmentCount = document.getElementById("segmentCount");
const copyFfmpegBtn = document.getElementById("copyFfmpegBtn");
const copyManifestBtn = document.getElementById("copyManifestBtn");
const copyAllSegmentsBtn = document.getElementById("copyAllSegmentsBtn");

let currentTabId = null;
let currentPageUrl = "";
let detectedManifest = null;
let detectedSegments = [];

// Segment file patterns
const SEGMENT_EXTENSIONS = [".ts", ".m4s", ".m4v", ".m4a", ".fmp4"];
const SEGMENT_PATTERNS = [
  /seg-\d+/i,
  /segment[\-_]?\d+/i,
  /chunk[\-_]?\d+/i,
  /frag[\-_]?\d+/i,
  /part[\-_]?\d+/i,
  /\d+\.ts/i,
  /\d+\.m4s/i,
  /init\.mp4/i,
  /init\.m4s/i
];

// Direct video file extensions
const VIDEO_EXTENSIONS = [
  ".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv", ".m4v", ".flv", ".wmv",
  ".3gp", ".f4v", ".vob"
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
  // Check content type hints in URL
  if (lower.includes("manifest") && (lower.includes("hls") || lower.includes("dash"))) {
    return true;
  }
  return false;
}

function isSegmentFile(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  
  // Check segment extensions
  for (const ext of SEGMENT_EXTENSIONS) {
    if (lower.includes(ext + "?") || lower.endsWith(ext)) return true;
  }
  
  // Check segment URL patterns
  for (const pattern of SEGMENT_PATTERNS) {
    if (pattern.test(lower)) return true;
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
  segmentGroup.style.display = "none";
  detectedManifest = null;
  detectedSegments = [];
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) {
      status.textContent = "No active tab found.";
      return;
    }
    
    currentTabId = tab.id;
    currentPageUrl = tab.url || "";
    
    const response = await chrome.runtime.sendMessage({
      type: "getRequests",
      tabId: currentTabId
    });
    
    const requests = response.requests || [];
    
    // Separate manifests, segments, and direct videos
    const manifests = [];
    const segments = [];
    const directVideos = [];
    
    for (const entry of requests) {
      // Check if it's a manifest
      if (isStreamingManifest(entry.url)) {
        manifests.push(entry);
        continue;
      }
      
      // Check if it's a segment
      if (isSegmentFile(entry.url)) {
        segments.push(entry);
        continue;
      }
      
      // Check if it's a direct video
      if (entry.type === "media") {
        directVideos.push(entry);
        continue;
      }
      
      if (isVideoUrl(entry.url)) {
        directVideos.push(entry);
        continue;
      }
      
      if (hasVideoContentType(entry.responseHeaders)) {
        directVideos.push(entry);
        continue;
      }
      
      if (entry.size >= MIN_VIDEO_SIZE && hasRangeSupport(entry.responseHeaders)) {
        directVideos.push(entry);
        continue;
      }
    }
    
    // Deduplicate direct videos
    const seenVideos = new Map();
    for (const video of directVideos) {
      const existing = seenVideos.get(video.url);
      if (!existing || (video.size > existing.size)) {
        seenVideos.set(video.url, video);
      }
    }
    const uniqueVideos = Array.from(seenVideos.values());
    
    // Deduplicate manifests
    const seenManifests = new Map();
    for (const m of manifests) {
      if (!seenManifests.has(m.url)) {
        seenManifests.set(m.url, m);
      }
    }
    const uniqueManifests = Array.from(seenManifests.values());
    
    // Deduplicate segments
    const seenSegments = new Map();
    for (const s of segments) {
      if (!seenSegments.has(s.url)) {
        seenSegments.set(s.url, s);
      }
    }
    const uniqueSegments = Array.from(seenSegments.values());
    
    // Store for segment group actions
    detectedManifest = uniqueManifests[0] || null;
    detectedSegments = uniqueSegments;
    
    // Show segment group if we have segments or manifests
    if (uniqueSegments.length > 0 || uniqueManifests.length > 0) {
      segmentGroup.style.display = "block";
      const totalParts = uniqueSegments.length + uniqueManifests.length;
      segmentCount.textContent = `${uniqueSegments.length} segments, ${uniqueManifests.length} manifest(s)`;
    }
    
    // Sort direct videos by size
    uniqueVideos.sort((a, b) => (b.size || 0) - (a.size || 0));
    
    // Build status
    const totalFound = uniqueVideos.length + uniqueManifests.length + (uniqueSegments.length > 0 ? 1 : 0);
    
    if (totalFound === 0) {
      status.textContent = "No videos detected.";
      noVideos.style.display = "block";
      return;
    }
    
    let statusParts = [];
    if (uniqueVideos.length > 0) {
      statusParts.push(`${uniqueVideos.length} video(s)`);
    }
    if (uniqueManifests.length > 0 || uniqueSegments.length > 0) {
      statusParts.push(`1 stream`);
    }
    status.textContent = `Found ${statusParts.join(", ")}`;
    
    // Add manifests to list
    for (const manifest of uniqueManifests) {
      videoList.appendChild(createVideoItem(manifest));
    }
    
    // Add direct videos to list
    for (const video of uniqueVideos) {
      videoList.appendChild(createVideoItem(video));
    }
    
  } catch (error) {
    status.textContent = "Error scanning page.";
    console.error(error);
  }
}

function setupSegmentActions() {
  copyFfmpegBtn.addEventListener("click", () => {
    let cmd = "";
    if (detectedManifest) {
      cmd = `ffmpeg -i "${detectedManifest.url}" -c copy output.mp4`;
    } else if (detectedSegments.length > 0) {
      // Create a file list approach
      cmd = `# Save segment URLs to segments.txt, then:\nffmpeg -f concat -safe 0 -i segments.txt -c copy output.mp4\n\n# Or download with aria2:\naria2c -i segments.txt`;
    }
    navigator.clipboard.writeText(cmd).then(() => {
      copyFfmpegBtn.textContent = "Copied!";
      setTimeout(() => {
        copyFfmpegBtn.textContent = "Copy ffmpeg Command";
      }, 1500);
    });
  });
  
  copyManifestBtn.addEventListener("click", () => {
    if (detectedManifest) {
      navigator.clipboard.writeText(detectedManifest.url).then(() => {
        copyManifestBtn.textContent = "Copied!";
        setTimeout(() => {
          copyManifestBtn.textContent = "Copy Manifest URL";
        }, 1500);
      });
    } else {
      copyManifestBtn.textContent = "No manifest";
      setTimeout(() => {
        copyManifestBtn.textContent = "Copy Manifest URL";
      }, 1500);
    }
  });
  
  copyAllSegmentsBtn.addEventListener("click", () => {
    const urls = [];
    if (detectedManifest) {
      urls.push(`# Manifest:\n${detectedManifest.url}\n`);
    }
    if (detectedSegments.length > 0) {
      urls.push(`# Segments (${detectedSegments.length}):`);
      for (const seg of detectedSegments) {
        urls.push(seg.url);
      }
    }
    navigator.clipboard.writeText(urls.join("\n")).then(() => {
      copyAllSegmentsBtn.textContent = "Copied!";
      setTimeout(() => {
        copyAllSegmentsBtn.textContent = "Copy All URLs";
      }, 1500);
    });
  });
}

refreshBtn.addEventListener("click", () => {
  scanForVideos();
});

advancedBtn.addEventListener("click", async () => {
  const url = chrome.runtime.getURL(`ui/panel.html?tabId=${currentTabId || ""}`);
  await chrome.tabs.create({ url });
  window.close();
});

// Setup and initial scan
setupSegmentActions();
scanForVideos();
