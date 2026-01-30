// Downloads management page

const activeList = document.getElementById("activeList");
const completedList = document.getElementById("completedList");
const clearCompletedBtn = document.getElementById("clearCompletedBtn");

let downloads = {};

// Load downloads from storage
async function loadDownloads() {
  const result = await chrome.storage.local.get("downloads");
  downloads = result.downloads || {};
  renderDownloads();
}

// Save downloads to storage
async function saveDownloads() {
  await chrome.storage.local.set({ downloads });
}

// Render all downloads
function renderDownloads() {
  const active = [];
  const completed = [];
  
  for (const [id, dl] of Object.entries(downloads)) {
    if (dl.status === "completed" || dl.status === "error") {
      completed.push({ id, ...dl });
    } else {
      active.push({ id, ...dl });
    }
  }
  
  // Sort by timestamp descending
  active.sort((a, b) => b.startTime - a.startTime);
  completed.sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime));
  
  renderList(activeList, active, true);
  renderList(completedList, completed, false);
}

function renderList(container, items, isActive) {
  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">No ${isActive ? "active" : "completed"} downloads</div>`;
    return;
  }
  
  container.innerHTML = items.map(dl => renderDownloadItem(dl, isActive)).join("");
  
  // Attach event listeners
  items.forEach(dl => {
    const item = container.querySelector(`[data-id="${dl.id}"]`);
    if (!item) return;
    
    const pauseBtn = item.querySelector(".pause-btn");
    const resumeBtn = item.querySelector(".resume-btn");
    const cancelBtn = item.querySelector(".cancel-btn");
    const removeBtn = item.querySelector(".remove-btn");
    
    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => pauseDownload(dl.id));
    }
    if (resumeBtn) {
      resumeBtn.addEventListener("click", () => resumeDownload(dl.id));
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => cancelDownload(dl.id));
    }
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeDownload(dl.id));
    }
  });
}

function renderDownloadItem(dl, isActive) {
  const percent = dl.total > 0 ? Math.round((dl.downloaded / dl.total) * 100) : 0;
  const statusClass = dl.status === "paused" ? "paused" : 
                      dl.status === "downloading" ? "downloading" :
                      dl.status === "completed" ? "completed" : 
                      dl.status === "error" ? "error" : "";
  
  const statusBadge = `<span class="status-badge ${statusClass}">${dl.status}</span>`;
  
  let actions = "";
  if (isActive) {
    if (dl.status === "downloading") {
      actions = `
        <button class="btn btn-small btn-pause pause-btn">⏸ Pause</button>
        <button class="btn btn-small btn-cancel cancel-btn">✕</button>
      `;
    } else if (dl.status === "paused") {
      actions = `
        <button class="btn btn-small btn-resume resume-btn">▶ Resume</button>
        <button class="btn btn-small btn-cancel cancel-btn">✕</button>
      `;
    }
  } else {
    actions = `<button class="btn btn-small btn-secondary remove-btn">Remove</button>`;
  }
  
  const duration = dl.duration ? formatDuration(dl.duration) : "";
  const size = dl.totalBytes ? formatBytes(dl.totalBytes) : "";
  const meta = [
    duration && `Duration: ${duration}`,
    size && `Size: ${size}`,
    dl.segments && `${dl.downloaded}/${dl.total} segments`
  ].filter(Boolean).join(" • ");
  
  return `
    <div class="download-item ${statusClass}" data-id="${dl.id}">
      <div class="download-header">
        <div class="download-info">
          <div class="download-title">${dl.filename || "Video Download"}</div>
          <div class="download-meta">
            ${statusBadge}
            ${meta ? `<span>${meta}</span>` : ""}
          </div>
        </div>
        <div class="download-actions">
          ${actions}
        </div>
      </div>
      ${isActive || dl.status === "error" ? `
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill ${dl.status === "paused" ? "paused" : ""}" style="width: ${percent}%"></div>
          </div>
          <div class="progress-text">
            <span>${percent}%</span>
            <span>${dl.statusText || ""}</span>
          </div>
        </div>
      ` : ""}
    </div>
  `;
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

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// Control functions - send messages to background
async function pauseDownload(id) {
  chrome.runtime.sendMessage({ type: "pauseDownload", downloadId: id });
}

async function resumeDownload(id) {
  chrome.runtime.sendMessage({ type: "resumeDownload", downloadId: id });
}

async function cancelDownload(id) {
  chrome.runtime.sendMessage({ type: "cancelDownload", downloadId: id });
}

async function removeDownload(id) {
  delete downloads[id];
  await saveDownloads();
  renderDownloads();
}

// Clear completed downloads
clearCompletedBtn.addEventListener("click", async () => {
  for (const [id, dl] of Object.entries(downloads)) {
    if (dl.status === "completed" || dl.status === "error") {
      delete downloads[id];
    }
  }
  await saveDownloads();
  renderDownloads();
});

// Listen for updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "downloadProgress") {
    const state = message.data;
    downloads[state.id] = state;
    saveDownloads();
    renderDownloads();
  }
});

// Poll for updates (backup)
setInterval(loadDownloads, 1000);

// Initial load
loadDownloads();
