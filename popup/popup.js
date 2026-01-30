const videoList = document.getElementById("videoList");
const noVideos = document.getElementById("noVideos");
const status = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const advancedBtn = document.getElementById("advancedBtn");

let currentTabId = null;

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv", ".m4v"];
const VIDEO_MIMETYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];

function isVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  
  // Check file extensions
  for (const ext of VIDEO_EXTENSIONS) {
    if (lower.includes(ext)) return true;
  }
  
  // Check common video path patterns
  if (lower.includes("/video/") || lower.includes("/media/") || lower.includes("/videos/")) {
    return true;
  }
  
  return false;
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
  
  item.innerHTML = `
    <div class="video-name">${escapeHtml(name)}</div>
    <div class="video-meta">${size} • ${entry.type}</div>
    <div class="video-actions">
      <button class="btn btn-secondary btn-small copy-btn">Copy URL</button>
      <button class="btn btn-primary btn-small download-btn">Download</button>
    </div>
  `;
  
  const copyBtn = item.querySelector(".copy-btn");
  const downloadBtn = item.querySelector(".download-btn");
  
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(entry.url).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy URL";
      }, 1500);
    });
  });
  
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
    
    // Filter for video requests
    const videos = requests.filter((entry) => {
      // Check type
      if (entry.type === "media") return true;
      
      // Check URL patterns
      if (isVideoUrl(entry.url)) return true;
      
      // Check response headers for video content-type
      const contentType = (entry.responseHeaders || [])
        .find((h) => h.name.toLowerCase() === "content-type");
      if (contentType) {
        const value = contentType.value.toLowerCase();
        for (const mime of VIDEO_MIMETYPES) {
          if (value.includes(mime)) return true;
        }
      }
      
      return false;
    });
    
    // Deduplicate by URL
    const seen = new Set();
    const unique = [];
    for (const video of videos) {
      if (!seen.has(video.url)) {
        seen.add(video.url);
        unique.push(video);
      }
    }
    
    if (unique.length === 0) {
      status.textContent = "No videos detected.";
      noVideos.style.display = "block";
      return;
    }
    
    status.textContent = `Found ${unique.length} video(s)`;
    
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
