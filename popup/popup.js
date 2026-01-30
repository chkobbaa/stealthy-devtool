const videoList = document.getElementById("videoList");
const noVideos = document.getElementById("noVideos");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const advancedBtn = document.getElementById("advancedBtn");
const clearCookiesBtn = document.getElementById("clearCookiesBtn");
const segmentGroup = document.getElementById("segmentGroup");
const segmentCount = document.getElementById("segmentCount");
const copyFfmpegBtn = document.getElementById("copyFfmpegBtn");
const copyManifestBtn = document.getElementById("copyManifestBtn");
const copyAllSegmentsBtn = document.getElementById("copyAllSegmentsBtn");
const autoDownloadBtn = document.getElementById("autoDownloadBtn");
const downloadAllSeparateBtn = document.getElementById("downloadAllSeparateBtn");
const downloadProgress = document.getElementById("downloadProgress");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");

let currentTabId = null;
let currentPageUrl = "";
let detectedManifest = null;
let detectedSegments = [];
let detectedVideos = []; // All detected video entries (manifests + direct videos)
let isDownloading = false;

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

// ============================================
// MANIFEST PARSING - Get ALL segments from manifest
// ============================================

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

async function fetchManifestText(url) {
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "include"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (e) {
    console.warn("Failed to fetch manifest:", e);
    return null;
  }
}

async function parseHlsManifest(manifestUrl) {
  const text = await fetchManifestText(manifestUrl);
  if (!text) return { segments: [], duration: 0 };
  
  const lines = text.split("\n").map(l => l.trim());
  const segments = [];
  let totalDuration = 0;
  let currentDuration = 0;
  let initSegment = null;
  
  // Check if this is a master playlist (contains variant streams)
  const variantLines = lines.filter(l => l.includes(".m3u8") && !l.startsWith("#"));
  if (variantLines.length > 0) {
    // This is a master playlist - find the highest quality variant
    let bestVariant = null;
    let bestBandwidth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        
        // Next non-comment line is the URL
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].startsWith("#") && lines[j].length > 0) {
            if (bandwidth > bestBandwidth) {
              bestBandwidth = bandwidth;
              bestVariant = resolveUrl(manifestUrl, lines[j]);
            }
            break;
          }
        }
      }
    }
    
    if (bestVariant) {
      // Recursively parse the variant playlist
      return await parseHlsManifest(bestVariant);
    }
  }
  
  // Parse media playlist
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Get segment duration
    if (line.startsWith("#EXTINF:")) {
      const durationMatch = line.match(/#EXTINF:([\d.]+)/);
      if (durationMatch) {
        currentDuration = parseFloat(durationMatch[1]);
      }
    }
    
    // Get init segment (for fMP4/CMAF)
    if (line.startsWith("#EXT-X-MAP:")) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) {
        initSegment = resolveUrl(manifestUrl, uriMatch[1]);
      }
    }
    
    // Segment URL (non-comment, non-empty line after EXTINF)
    if (!line.startsWith("#") && line.length > 0 && (line.includes(".ts") || line.includes(".m4s") || line.includes(".m4v") || line.includes(".aac") || line.includes(".mp4"))) {
      const segmentUrl = resolveUrl(manifestUrl, line);
      segments.push({
        url: segmentUrl,
        duration: currentDuration
      });
      totalDuration += currentDuration;
      currentDuration = 0;
    }
  }
  
  return { segments, duration: totalDuration, initSegment };
}

async function parseDashManifest(manifestUrl) {
  const text = await fetchManifestText(manifestUrl);
  if (!text) return { segments: [], duration: 0 };
  
  const segments = [];
  let totalDuration = 0;
  let initSegment = null;
  
  try {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    
    // Get total duration from MPD
    const mpd = xml.querySelector("MPD");
    if (mpd) {
      const durationAttr = mpd.getAttribute("mediaPresentationDuration");
      if (durationAttr) {
        totalDuration = parseDuration(durationAttr);
      }
    }
    
    // Find video AdaptationSet with highest bandwidth
    const adaptationSets = xml.querySelectorAll("AdaptationSet");
    let bestRepresentation = null;
    let bestBandwidth = 0;
    
    for (const as of adaptationSets) {
      const mimeType = as.getAttribute("mimeType") || "";
      const contentType = as.getAttribute("contentType") || "";
      
      // Prefer video
      if (mimeType.includes("video") || contentType === "video") {
        const representations = as.querySelectorAll("Representation");
        for (const rep of representations) {
          const bandwidth = parseInt(rep.getAttribute("bandwidth") || "0", 10);
          if (bandwidth > bestBandwidth) {
            bestBandwidth = bandwidth;
            bestRepresentation = rep;
          }
        }
      }
    }
    
    // Fall back to any representation
    if (!bestRepresentation) {
      const allReps = xml.querySelectorAll("Representation");
      for (const rep of allReps) {
        const bandwidth = parseInt(rep.getAttribute("bandwidth") || "0", 10);
        if (bandwidth > bestBandwidth) {
          bestBandwidth = bandwidth;
          bestRepresentation = rep;
        }
      }
    }
    
    if (bestRepresentation) {
      const baseUrl = getBaseUrl(manifestUrl, xml);
      
      // Check for SegmentTemplate
      const segmentTemplate = bestRepresentation.querySelector("SegmentTemplate") ||
                              bestRepresentation.parentElement.querySelector("SegmentTemplate");
      
      if (segmentTemplate) {
        const init = segmentTemplate.getAttribute("initialization");
        const media = segmentTemplate.getAttribute("media");
        const startNumber = parseInt(segmentTemplate.getAttribute("startNumber") || "1", 10);
        const timescale = parseInt(segmentTemplate.getAttribute("timescale") || "1", 10);
        
        if (init) {
          initSegment = resolveUrl(baseUrl, init.replace("$RepresentationID$", bestRepresentation.getAttribute("id") || ""));
        }
        
        // Get segment timeline or calculate from duration
        const segmentTimeline = segmentTemplate.querySelector("SegmentTimeline");
        
        if (segmentTimeline) {
          const sElements = segmentTimeline.querySelectorAll("S");
          let time = 0;
          let segmentNumber = startNumber;
          
          for (const s of sElements) {
            const t = s.getAttribute("t") ? parseInt(s.getAttribute("t"), 10) : time;
            const d = parseInt(s.getAttribute("d"), 10);
            const r = parseInt(s.getAttribute("r") || "0", 10);
            
            time = t;
            
            for (let i = 0; i <= r; i++) {
              const segUrl = media
                .replace("$RepresentationID$", bestRepresentation.getAttribute("id") || "")
                .replace("$Number$", String(segmentNumber))
                .replace("$Time$", String(time));
              
              segments.push({
                url: resolveUrl(baseUrl, segUrl),
                duration: d / timescale
              });
              
              time += d;
              segmentNumber++;
            }
          }
        } else {
          // Calculate segments from duration
          const segmentDuration = parseInt(segmentTemplate.getAttribute("duration") || "0", 10);
          if (segmentDuration > 0 && totalDuration > 0) {
            const numSegments = Math.ceil(totalDuration / (segmentDuration / timescale));
            
            for (let i = 0; i < numSegments; i++) {
              const segUrl = media
                .replace("$RepresentationID$", bestRepresentation.getAttribute("id") || "")
                .replace("$Number$", String(startNumber + i))
                .replace("$Time$", String(i * segmentDuration));
              
              segments.push({
                url: resolveUrl(baseUrl, segUrl),
                duration: segmentDuration / timescale
              });
            }
          }
        }
      }
      
      // Check for SegmentList
      const segmentList = bestRepresentation.querySelector("SegmentList");
      if (segmentList && segments.length === 0) {
        const initEl = segmentList.querySelector("Initialization");
        if (initEl) {
          initSegment = resolveUrl(baseUrl, initEl.getAttribute("sourceURL") || "");
        }
        
        const segmentUrls = segmentList.querySelectorAll("SegmentURL");
        for (const segUrl of segmentUrls) {
          segments.push({
            url: resolveUrl(baseUrl, segUrl.getAttribute("media") || ""),
            duration: 0
          });
        }
      }
      
      // Check for BaseURL (single segment)
      if (segments.length === 0) {
        const baseUrlEl = bestRepresentation.querySelector("BaseURL");
        if (baseUrlEl) {
          segments.push({
            url: resolveUrl(baseUrl, baseUrlEl.textContent || ""),
            duration: totalDuration
          });
        }
      }
    }
  } catch (e) {
    console.error("Failed to parse DASH manifest:", e);
  }
  
  return { segments, duration: totalDuration, initSegment };
}

function getBaseUrl(manifestUrl, xml) {
  const baseUrlEl = xml.querySelector("BaseURL");
  if (baseUrlEl && baseUrlEl.textContent) {
    return resolveUrl(manifestUrl, baseUrlEl.textContent);
  }
  // Use manifest URL directory as base
  return manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
}

function parseDuration(iso8601) {
  // Parse ISO 8601 duration (PT1H2M3.4S)
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseFloat(match[3] || "0");
  
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function parseManifest(manifestUrl) {
  if (!manifestUrl) return null;
  
  const lower = manifestUrl.toLowerCase();
  
  if (lower.includes(".m3u8")) {
    return await parseHlsManifest(manifestUrl);
  }
  
  if (lower.includes(".mpd")) {
    return await parseDashManifest(manifestUrl);
  }
  
  return null;
}

// ============================================

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
  detectedVideos = [];
  
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
    detectedVideos = [...uniqueManifests, ...uniqueVideos]; // Store all detected videos including manifests
    
    // Get segmentInfo element
    const segmentInfo = document.getElementById("segmentInfo");
    
    // Show segment group if we have segments or manifests
    if (uniqueSegments.length > 0 || uniqueManifests.length > 0) {
      segmentGroup.style.display = "block";
      segmentCount.textContent = `${uniqueSegments.length} segments, ${uniqueManifests.length} manifest(s)`;
      
      // Update info based on what we detected
      if (uniqueManifests.length > 0) {
        const manifestType = uniqueManifests[0].url.toLowerCase().includes(".m3u8") ? "HLS" : "DASH";
        segmentInfo.innerHTML = `<strong>${manifestType}</strong> stream detected. Click download to get the <strong>full video</strong> (all segments will be fetched from manifest).`;
      } else if (uniqueSegments.length > 0) {
        segmentInfo.innerHTML = `<strong>${uniqueSegments.length}</strong> segments buffered so far. For full video, let more buffer or find manifest.`;
      }
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

// ============================================
// DOWNLOAD PROGRESS UI
// ============================================

let downloadControlsDiv = null;

function showDownloadProgress(state) {
  downloadProgress.style.display = "block";
  
  if (state.total > 0) {
    const percent = Math.round((state.downloaded / state.total) * 100);
    progressFill.style.width = `${percent}%`;
    
    // Show speed if available
    const speedText = state.speed ? ` • ${formatBytes(state.speed)}/s` : "";
    progressText.textContent = `${state.downloaded}/${state.total} segments (${formatBytes(state.totalBytes || 0)})${speedText}`;
  }
  
  if (state.status === "paused") {
    progressText.textContent = `⏸ Paused - ${state.downloaded}/${state.total}`;
    progressFill.classList.add("paused");
  } else {
    progressFill.classList.remove("paused");
  }
  
  if (state.status === "completed") {
    progressText.textContent = `✓ Done - ${formatBytes(state.totalBytes || 0)}`;
    isDownloading = false;
    autoDownloadBtn.disabled = false;
    autoDownloadBtn.innerHTML = '<span class="btn-icon">⬇</span> Download Full Video';
    hideDownloadControls();
  } else if (state.status === "error") {
    progressText.textContent = `✗ ${state.statusText || "Error"}`;
    isDownloading = false;
    autoDownloadBtn.disabled = false;
    autoDownloadBtn.innerHTML = '<span class="btn-icon">⬇</span> Download Full Video';
    hideDownloadControls();
  }
}

function showDownloadControls() {
  if (downloadControlsDiv) return;
  
  downloadControlsDiv = document.createElement("div");
  downloadControlsDiv.className = "download-controls";
  
  const pauseBtn = document.createElement("button");
  pauseBtn.className = "btn btn-pause";
  pauseBtn.id = "pauseResumeBtn";
  pauseBtn.innerHTML = "⏸ Pause";
  
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-cancel";
  cancelBtn.textContent = "✕ Cancel";
  
  pauseBtn.addEventListener("click", async () => {
    const status = await chrome.runtime.sendMessage({ type: "getDownloadStatus" });
    if (status.active) {
      if (status.active.status === "paused") {
        chrome.runtime.sendMessage({ type: "resumeDownload", downloadId: status.active.id });
        pauseBtn.innerHTML = "⏸ Pause";
        pauseBtn.className = "btn btn-pause";
      } else {
        chrome.runtime.sendMessage({ type: "pauseDownload", downloadId: status.active.id });
        pauseBtn.innerHTML = "▶ Resume";
        pauseBtn.className = "btn btn-resume";
      }
    }
  });
  
  cancelBtn.addEventListener("click", async () => {
    const status = await chrome.runtime.sendMessage({ type: "getDownloadStatus" });
    if (status.active) {
      chrome.runtime.sendMessage({ type: "cancelDownload", downloadId: status.active.id });
    }
    isDownloading = false;
    autoDownloadBtn.disabled = false;
    autoDownloadBtn.innerHTML = '<span class="btn-icon">⬇</span> Download Full Video';
    hideDownloadControls();
  });
  
  downloadControlsDiv.appendChild(pauseBtn);
  downloadControlsDiv.appendChild(cancelBtn);
  downloadProgress.appendChild(downloadControlsDiv);
}

function hideDownloadControls() {
  if (downloadControlsDiv) {
    downloadControlsDiv.remove();
    downloadControlsDiv = null;
  }
}

// Listen for download progress updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "downloadProgress") {
    showDownloadProgress(message.data);
    
    // Update pause button text and style
    const pauseBtn = document.getElementById("pauseResumeBtn");
    if (pauseBtn) {
      if (message.data.status === "paused") {
        pauseBtn.innerHTML = "▶ Resume";
        pauseBtn.className = "btn btn-resume";
      } else if (message.data.status === "downloading") {
        pauseBtn.innerHTML = "⏸ Pause";
        pauseBtn.className = "btn btn-pause";
      }
    }
  }
});

// Check for active download on popup open
async function checkActiveDownload() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "getDownloadStatus" });
    if (status.active) {
      isDownloading = true;
      autoDownloadBtn.disabled = true;
      autoDownloadBtn.innerHTML = '<span class="btn-icon">⏳</span> Downloading...';
      showDownloadProgress(status.active);
      showDownloadControls();
      
      // Update pause button based on state
      const pauseBtn = document.getElementById("pauseResumeBtn");
      if (pauseBtn && status.active.status === "paused") {
        pauseBtn.innerHTML = "▶ Resume";
      }
    }
  } catch (e) {
    // Background not ready yet
  }
}

function setupSegmentActions() {
  copyFfmpegBtn.addEventListener("click", () => {
    let cmd = "";
    if (detectedManifest) {
      cmd = `ffmpeg -i "${detectedManifest.url}" -c copy output.mp4`;
    } else if (detectedSegments.length > 0) {
      cmd = `# Save segment URLs to segments.txt, then:\nffmpeg -f concat -safe 0 -i segments.txt -c copy output.mp4\n\n# Or download with aria2:\naria2c -i segments.txt`;
    }
    navigator.clipboard.writeText(cmd).then(() => {
      copyFfmpegBtn.textContent = "Copied!";
      setTimeout(() => {
        copyFfmpegBtn.textContent = "Copy ffmpeg";
      }, 1500);
    });
  });
  
  copyManifestBtn.addEventListener("click", () => {
    if (detectedManifest) {
      navigator.clipboard.writeText(detectedManifest.url).then(() => {
        copyManifestBtn.textContent = "Copied!";
        setTimeout(() => {
          copyManifestBtn.textContent = "Copy Manifest";
        }, 1500);
      });
    } else {
      copyManifestBtn.textContent = "No manifest";
      setTimeout(() => {
        copyManifestBtn.textContent = "Copy Manifest";
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
  
  // Auto download - sends to background script for persistent download
  autoDownloadBtn.addEventListener("click", async () => {
    // Check if already downloading
    const status = await chrome.runtime.sendMessage({ type: "getDownloadStatus" });
    if (status.active) {
      // Show current progress
      showDownloadProgress(status.active);
      return;
    }
    
    // Check for manifest (preferred) or captured segments
    const manifest = (detectedVideos || []).find(v => 
      v.url.toLowerCase().includes(".m3u8") || 
      v.url.toLowerCase().includes(".mpd")
    );
    
    if (detectedSegments.length === 0 && !manifest) {
      progressText.textContent = "No video stream detected - try playing the video first";
      downloadProgress.style.display = "block";
      return;
    }
    
    // Prepare data for background
    const downloadData = {
      manifestUrl: manifest?.url || null,
      segments: detectedSegments.map(s => ({ url: s.url })),
      initSegmentUrl: findInitSegment(detectedSegments)?.url || null
    };
    
    // Start download in background
    chrome.runtime.sendMessage({ type: "startDownload", data: downloadData });
    
    // Update UI
    isDownloading = true;
    autoDownloadBtn.disabled = true;
    autoDownloadBtn.innerHTML = '<span class="btn-icon">⏳</span> Downloading...';
    downloadProgress.style.display = "block";
    progressText.textContent = "Starting download...";
    progressFill.style.width = "0%";
    
    showDownloadControls();
  });
  
  // Download all segments as separate files
  downloadAllSeparateBtn.addEventListener("click", async () => {
    if (detectedSegments.length === 0) {
      return;
    }
    
    const timestamp = Date.now();
    let index = 0;
    
    for (const seg of detectedSegments) {
      const ext = getSegmentExtension(seg.url);
      const filename = `segment_${String(index).padStart(4, "0")}${ext}`;
      
      chrome.downloads.download({
        url: seg.url,
        filename: `video_${timestamp}/${filename}`
      });
      
      index++;
      
      // Small delay to avoid overwhelming
      if (index % 5 === 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    
    downloadAllSeparateBtn.textContent = `Started ${index} downloads`;
    setTimeout(() => {
      downloadAllSeparateBtn.textContent = "Download Separately";
    }, 2000);
  });
}

function getSegmentExtension(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".ts")) return ".ts";
  if (lower.includes(".m4s")) return ".m4s";
  if (lower.includes(".m4v")) return ".m4v";
  if (lower.includes(".m4a")) return ".m4a";
  if (lower.includes(".mp4")) return ".mp4";
  return ".bin";
}

function sortSegments(segments) {
  // Try to extract sequence numbers and sort
  return [...segments].sort((a, b) => {
    const numA = extractSegmentNumber(a.url);
    const numB = extractSegmentNumber(b.url);
    if (numA !== null && numB !== null) {
      return numA - numB;
    }
    // Fall back to URL comparison
    return a.url.localeCompare(b.url);
  });
}

function extractSegmentNumber(url) {
  // Try various patterns to extract segment number
  const patterns = [
    /seg[_-]?(\d+)/i,
    /segment[_-]?(\d+)/i,
    /chunk[_-]?(\d+)/i,
    /frag[_-]?(\d+)/i,
    /part[_-]?(\d+)/i,
    /(\d+)\.(?:ts|m4s|m4v)/i,
    /[_-](\d+)\./i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

function findInitSegment(segments) {
  // Look for init segment (needed for m4s)
  return segments.find((s) => {
    const lower = s.url.toLowerCase();
    return lower.includes("init") || lower.includes("header");
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

// Downloads page button
const downloadsBtn = document.getElementById("downloadsBtn");
downloadsBtn.addEventListener("click", async () => {
  const url = chrome.runtime.getURL("downloads/downloads.html");
  await chrome.tabs.create({ url });
  window.close();
});

// Clear cookies for current site
clearCookiesBtn.addEventListener("click", async () => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) return;
    
    const url = new URL(tab.url);
    const domain = url.hostname;
    
    // Get all cookies for this domain
    const cookies = await chrome.cookies.getAll({ domain });
    
    // Delete each cookie
    let deleted = 0;
    for (const cookie of cookies) {
      const cookieUrl = `http${cookie.secure ? "s" : ""}://${cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
      await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
      deleted++;
    }
    
    // Also try with www prefix and without
    const altDomain = domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`;
    const altCookies = await chrome.cookies.getAll({ domain: altDomain });
    for (const cookie of altCookies) {
      const cookieUrl = `http${cookie.secure ? "s" : ""}://${cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
      await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
      deleted++;
    }
    
    // Visual feedback
    const originalText = clearCookiesBtn.textContent;
    clearCookiesBtn.textContent = `✓ ${deleted}`;
    clearCookiesBtn.style.background = "rgba(52, 168, 83, 0.6)";
    
    setTimeout(() => {
      clearCookiesBtn.textContent = originalText;
      clearCookiesBtn.style.background = "";
    }, 1500);
    
  } catch (e) {
    console.error("Failed to clear cookies:", e);
    clearCookiesBtn.textContent = "✗";
    setTimeout(() => {
      clearCookiesBtn.textContent = "🍪✕";
    }, 1500);
  }
});

// Setup and initial scan
setupSegmentActions();
scanForVideos();
checkActiveDownload();
