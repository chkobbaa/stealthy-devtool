const MAX_REQUESTS_PER_TAB = 2000;

const requestsByTab = new Map();
const debuggerTabs = new Map();

function isDebuggerAttached(tabId) {
  return debuggerTabs.has(tabId);
}

function setDebuggerStatus(tabId, status) {
  if (status.attached) {
    debuggerTabs.set(tabId, { target: { tabId }, attachedAt: Date.now() });
  } else {
    debuggerTabs.delete(tabId);
  }
  broadcastToPanels({ type: "debuggerStatus", tabId, ...status });
}

function ensureTabStore(tabId) {
  if (!requestsByTab.has(tabId)) {
    requestsByTab.set(tabId, {
      list: [],
      byId: new Map()
    });
  }
  return requestsByTab.get(tabId);
}

function clearTabStore(tabId) {
  requestsByTab.set(tabId, { list: [], byId: new Map() });
  broadcastToPanels({ type: "cleared", tabId });
}

function broadcastToPanels(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Ignore if no listeners.
  });
}

function trimStore(store) {
  if (store.list.length <= MAX_REQUESTS_PER_TAB) return;
  const overflow = store.list.length - MAX_REQUESTS_PER_TAB;
  const removed = store.list.splice(0, overflow);
  for (const item of removed) {
    store.byId.delete(item.id);
  }
}

function normalizeType(type) {
  switch (type) {
    case "xmlhttprequest":
      return "xhr";
    case "stylesheet":
      return "css";
    case "script":
      return "js";
    case "image":
      return "img";
    case "font":
      return "font";
    case "media":
      return "media";
    case "websocket":
      return "ws";
    case "fetch":
      return "fetch";
    default:
      return "other";
  }
}

function normalizeCdpType(type) {
  if (!type) return "other";
  return normalizeType(String(type).toLowerCase());
}

function parseRequestBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.formData) {
    return { type: "formData", value: requestBody.formData };
  }
  if (requestBody.raw && requestBody.raw.length) {
    try {
      const bytes = requestBody.raw[0].bytes;
      if (bytes) {
        const text = new TextDecoder("utf-8").decode(bytes);
        return { type: "raw", value: text };
      }
    } catch (error) {
      return { type: "raw", value: "<unreadable>" };
    }
  }
  return null;
}

function toHeaderArray(headersObject) {
  if (!headersObject) return [];
  return Object.entries(headersObject).map(([name, value]) => ({
    name,
    value: String(value)
  }));
}

function getHeaderValue(headers, name) {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : null;
}

function estimateSizeFromHeaders(headers) {
  const length = getHeaderValue(headers, "content-length");
  if (!length) return 0;
  const parsed = parseInt(length, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function upsertEntry(tabId, requestId, mutator) {
  const store = ensureTabStore(tabId);
  let entry = store.byId.get(requestId);
  if (!entry) {
    entry = {
      id: requestId,
      url: "",
      method: "",
      status: 0,
      type: "other",
      source: "webRequest",
      initiator: "",
      requestHeaders: [],
      responseHeaders: [],
      startTime: 0,
      startTimeMonotonic: 0,
      endTime: 0,
      duration: 0,
      size: 0,
      requestBody: null,
      responseBody: null,
      responseBodyEncoding: null,
      error: null,
      fromCache: false,
      redirectedFrom: null,
      redirectedTo: null,
      wsFrames: 0
    };
    store.byId.set(requestId, entry);
    store.list.push(entry);
  }

  mutator(entry);
  trimStore(store);

  broadcastToPanels({
    type: "requestUpdated",
    tabId,
    requestId,
    entry
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab && tab.id ? tab.id : null;
  const url = chrome.runtime.getURL(`ui/panel.html?tabId=${tabId || ""}`);
  await chrome.tabs.create({ url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  requestsByTab.delete(tabId);
  if (isDebuggerAttached(tabId)) {
    chrome.debugger.detach({ tabId });
    debuggerTabs.delete(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    clearTabStore(tabId);
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isDebuggerAttached(details.tabId)) return;
    const isMainFrame = details.type === "main_frame";
    if (isMainFrame) {
      clearTabStore(details.tabId);
    }

    upsertEntry(details.tabId, details.requestId, (entry) => {
      entry.url = details.url;
      entry.method = details.method;
      entry.type = normalizeType(details.type);
      entry.source = "webRequest";
      entry.initiator = details.initiator || details.documentUrl || "";
      entry.startTime = details.timeStamp;
      entry.requestBody = parseRequestBody(details.requestBody);
    });
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isDebuggerAttached(details.tabId)) return;
    upsertEntry(details.tabId, details.requestId, (entry) => {
      entry.requestHeaders = details.requestHeaders || [];
    });
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isDebuggerAttached(details.tabId)) return;
    upsertEntry(details.tabId, details.requestId, (entry) => {
      entry.responseHeaders = details.responseHeaders || [];
      entry.status = details.statusCode || entry.status;
      if (!entry.size) {
        entry.size = estimateSizeFromHeaders(entry.responseHeaders);
      }
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isDebuggerAttached(details.tabId)) return;
    upsertEntry(details.tabId, details.requestId, (entry) => {
      entry.redirectedTo = details.redirectUrl || null;
      entry.responseHeaders = details.responseHeaders || entry.responseHeaders;
      entry.status = details.statusCode || entry.status;
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isDebuggerAttached(details.tabId)) return;
    upsertEntry(details.tabId, details.requestId, (entry) => {
      entry.endTime = details.timeStamp;
      entry.duration = Math.max(0, entry.endTime - entry.startTime);
      entry.status = details.statusCode || entry.status;
      entry.fromCache = details.fromCache || false;
      if (!entry.size) {
        entry.size = estimateSizeFromHeaders(details.responseHeaders || entry.responseHeaders);
      }
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isDebuggerAttached(details.tabId)) return;
    upsertEntry(details.tabId, details.requestId, (entry) => {
      entry.endTime = details.timeStamp;
      entry.duration = Math.max(0, entry.endTime - entry.startTime);
      entry.error = details.error || "Failed";
    });
  },
  { urls: ["<all_urls>"] }
);

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!source || !source.tabId) return;
  const tabId = source.tabId;
  if (!isDebuggerAttached(tabId)) return;

  const id = params && params.requestId ? `dbg:${params.requestId}` : null;

  if (method === "Network.requestWillBeSent" && id) {
    upsertEntry(tabId, id, (entry) => {
      const previousUrl = entry.url;
      const request = params.request || {};
      entry.url = request.url || entry.url;
      entry.method = request.method || entry.method;
      entry.type = normalizeCdpType(params.type);
      entry.source = "debugger";
      entry.initiator = params.initiator && params.initiator.url ? params.initiator.url : entry.initiator;
      entry.startTime = params.wallTime ? params.wallTime * 1000 : entry.startTime || Date.now();
      entry.startTimeMonotonic = params.timestamp || entry.startTimeMonotonic;
      entry.requestHeaders = toHeaderArray(request.headers || {});
      if (request.postData) {
        entry.requestBody = { type: "raw", value: request.postData };
      }
      if (params.redirectResponse) {
        entry.redirectedFrom = previousUrl || entry.redirectedFrom;
        entry.status = params.redirectResponse.status || entry.status;
        entry.responseHeaders = toHeaderArray(params.redirectResponse.headers || {});
        entry.redirectedTo = entry.url;
      }
    });

    const request = params.request || {};
    const methodUpper = (request.method || "").toUpperCase();
    if (!request.postData && methodUpper && methodUpper !== "GET" && methodUpper !== "HEAD") {
      chrome.debugger.sendCommand(
        { tabId },
        "Network.getRequestPostData",
        { requestId: params.requestId },
        (response) => {
          if (chrome.runtime.lastError || !response) return;
          if (!response.postData) return;
          upsertEntry(tabId, id, (entry) => {
            entry.requestBody = { type: "raw", value: response.postData };
          });
        }
      );
    }
  }

  if (method === "Network.responseReceived" && id) {
    upsertEntry(tabId, id, (entry) => {
      const response = params.response || {};
      entry.status = response.status || entry.status;
      entry.responseHeaders = toHeaderArray(response.headers || {});
      entry.type = normalizeCdpType(params.type) || entry.type;
      entry.fromCache = !!response.fromDiskCache || !!response.fromPrefetchCache;
    });
  }

  if (method === "Network.loadingFinished" && id) {
    const encodedDataLength = params.encodedDataLength || 0;
    upsertEntry(tabId, id, (entry) => {
      if (entry.startTimeMonotonic && params.timestamp) {
        entry.endTime = entry.startTime + (params.timestamp - entry.startTimeMonotonic) * 1000;
      } else {
        entry.endTime = Date.now();
      }
      entry.duration = Math.max(0, entry.endTime - entry.startTime);
      entry.size = encodedDataLength || entry.size;
    });

    chrome.debugger.sendCommand(
      { tabId },
      "Network.getResponseBody",
      { requestId: params.requestId },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (!response) return;
        upsertEntry(tabId, id, (entry) => {
          entry.responseBody = response.body || "";
          entry.responseBodyEncoding = response.base64Encoded ? "base64" : "utf8";
        });
      }
    );
  }

  if (method === "Network.loadingFailed" && id) {
    upsertEntry(tabId, id, (entry) => {
      entry.error = params.errorText || "Failed";
      if (entry.startTimeMonotonic && params.timestamp) {
        entry.endTime = entry.startTime + (params.timestamp - entry.startTimeMonotonic) * 1000;
      } else {
        entry.endTime = Date.now();
      }
      entry.duration = Math.max(0, entry.endTime - entry.startTime);
    });
  }

  if (method === "Network.webSocketCreated") {
    const wsId = `ws:${params.requestId}`;
    upsertEntry(tabId, wsId, (entry) => {
      entry.url = params.url || entry.url;
      entry.method = "GET";
      entry.type = "ws";
      entry.source = "debugger";
      entry.startTime = Date.now();
      entry.startTimeMonotonic = params.timestamp || entry.startTimeMonotonic;
    });
  }

  if (method === "Network.webSocketWillSendHandshakeRequest") {
    const wsId = `ws:${params.requestId}`;
    upsertEntry(tabId, wsId, (entry) => {
      entry.requestHeaders = toHeaderArray(params.request && params.request.headers ? params.request.headers : {});
    });
  }

  if (method === "Network.webSocketHandshakeResponseReceived") {
    const wsId = `ws:${params.requestId}`;
    upsertEntry(tabId, wsId, (entry) => {
      entry.status = 101;
      entry.responseHeaders = toHeaderArray(params.response && params.response.headers ? params.response.headers : {});
    });
  }

  if (method === "Network.webSocketFrameReceived" || method === "Network.webSocketFrameSent") {
    const wsId = `ws:${params.requestId}`;
    const payload = params.response && params.response.payloadData ? params.response.payloadData : "";
    upsertEntry(tabId, wsId, (entry) => {
      entry.wsFrames += 1;
      if (payload) {
        entry.size += payload.length;
      }
    });
  }

  if (method === "Network.webSocketClosed") {
    const wsId = `ws:${params.requestId}`;
    upsertEntry(tabId, wsId, (entry) => {
      entry.endTime = Date.now();
      if (entry.startTimeMonotonic && params.timestamp) {
        entry.duration = Math.max(0, (params.timestamp - entry.startTimeMonotonic) * 1000);
      } else {
        entry.duration = Math.max(0, entry.endTime - entry.startTime);
      }
    });
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!source || !source.tabId) return;
  setDebuggerStatus(source.tabId, { attached: false, reason: reason || "detached" });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "getRequests") {
    const store = ensureTabStore(message.tabId);
    sendResponse({
      tabId: message.tabId,
      requests: store.list
    });
    return true;
  }

  if (message.type === "clearRequests") {
    clearTabStore(message.tabId);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "getDebuggerStatus") {
    sendResponse({
      tabId: message.tabId,
      attached: isDebuggerAttached(message.tabId)
    });
    return true;
  }

  if (message.type === "enableDebugger") {
    const tabId = message.tabId;
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        setDebuggerStatus(tabId, { attached: false, error: chrome.runtime.lastError.message });
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxPostDataSize: 1048576 }, () => {
        if (chrome.runtime.lastError) {
          setDebuggerStatus(tabId, { attached: false, error: chrome.runtime.lastError.message });
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        clearTabStore(tabId);
        setDebuggerStatus(tabId, { attached: true });
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (message.type === "disableDebugger") {
    const tabId = message.tabId;
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      setDebuggerStatus(tabId, { attached: false });
      sendResponse({ ok: true });
    });
    return true;
  }

  // Download manager commands
  if (message.type === "startDownload") {
    startBackgroundDownload(message.data);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "pauseDownload") {
    if (activeDownload && activeDownload.id === message.downloadId) {
      activeDownload.paused = true;
      updateDownloadInStorage(activeDownload.id, { status: "paused" });
      broadcastDownloadUpdate();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "resumeDownload") {
    if (activeDownload && activeDownload.id === message.downloadId) {
      activeDownload.paused = false;
      updateDownloadInStorage(activeDownload.id, { status: "downloading" });
      broadcastDownloadUpdate();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "cancelDownload") {
    if (activeDownload && activeDownload.id === message.downloadId) {
      activeDownload.aborted = true;
      updateDownloadInStorage(activeDownload.id, { status: "error", statusText: "Canceled" });
      broadcastDownloadUpdate();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "getDownloadStatus") {
    sendResponse({ 
      active: activeDownload ? {
        id: activeDownload.id,
        status: activeDownload.paused ? "paused" : "downloading",
        downloaded: activeDownload.downloaded,
        total: activeDownload.total,
        totalBytes: activeDownload.totalBytes
      } : null
    });
    return true;
  }

  if (message.type === "getDownloadChunks") {
    getDownloadChunks(message.downloadId).then(data => {
      sendResponse({ ok: true, data });
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (message.type === "deleteDownloadChunks") {
    deleteDownloadChunks(message.downloadId).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  return false;
});

// ============================================
// INDEXEDDB FOR DOWNLOAD CHUNKS
// ============================================

const DB_NAME = "StealthyDownloads";
const DB_VERSION = 1;
const STORE_NAME = "chunks";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

async function storeDownloadChunks(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(data);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    tx.oncomplete = () => db.close();
  });
}

async function getDownloadChunks(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    
    tx.oncomplete = () => db.close();
  });
}

async function deleteDownloadChunks(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    
    tx.oncomplete = () => db.close();
  });
}

// ============================================
// BACKGROUND DOWNLOAD MANAGER
// ============================================

let activeDownload = null;

function broadcastDownloadUpdate() {
  if (!activeDownload) return;
  
  const state = {
    id: activeDownload.id,
    filename: activeDownload.filename,
    status: activeDownload.aborted ? "error" : (activeDownload.paused ? "paused" : "downloading"),
    total: activeDownload.total,
    downloaded: activeDownload.downloaded,
    totalBytes: activeDownload.totalBytes,
    duration: activeDownload.duration,
    startTime: activeDownload.startTime,
    statusText: activeDownload.statusText
  };
  
  chrome.runtime.sendMessage({ type: "downloadProgress", data: state }).catch(() => {});
}

async function updateDownloadInStorage(id, updates) {
  const result = await chrome.storage.local.get("downloads");
  const downloads = result.downloads || {};
  if (downloads[id]) {
    Object.assign(downloads[id], updates);
    await chrome.storage.local.set({ downloads });
  }
}

async function saveDownloadToStorage(state) {
  const result = await chrome.storage.local.get("downloads");
  const downloads = result.downloads || {};
  downloads[state.id] = state;
  await chrome.storage.local.set({ downloads });
}

async function fetchSegment(url) {
  const response = await fetch(url, {
    mode: "cors",
    credentials: "include"
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return await response.arrayBuffer();
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

async function fetchManifestText(url) {
  try {
    const response = await fetch(url, { mode: "cors", credentials: "include" });
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
  
  // Check if this is a master playlist
  const variantLines = lines.filter(l => l.includes(".m3u8") && !l.startsWith("#"));
  if (variantLines.length > 0) {
    let bestVariant = null;
    let bestBandwidth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        
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
      return await parseHlsManifest(bestVariant);
    }
  }
  
  // Parse media playlist
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith("#EXTINF:")) {
      const durationMatch = line.match(/#EXTINF:([\d.]+)/);
      if (durationMatch) {
        currentDuration = parseFloat(durationMatch[1]);
      }
    }
    
    if (line.startsWith("#EXT-X-MAP:")) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) {
        initSegment = resolveUrl(manifestUrl, uriMatch[1]);
      }
    }
    
    if (!line.startsWith("#") && line.length > 0 && 
        (line.includes(".ts") || line.includes(".m4s") || line.includes(".m4v") || 
         line.includes(".aac") || line.includes(".mp4"))) {
      const segmentUrl = resolveUrl(manifestUrl, line);
      segments.push({ url: segmentUrl, duration: currentDuration });
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
    
    const mpd = xml.querySelector("MPD");
    if (mpd) {
      const durationAttr = mpd.getAttribute("mediaPresentationDuration");
      if (durationAttr) {
        const match = durationAttr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
        if (match) {
          totalDuration = (parseInt(match[1] || "0", 10) * 3600) + 
                         (parseInt(match[2] || "0", 10) * 60) + 
                         parseFloat(match[3] || "0");
        }
      }
    }
    
    const adaptationSets = xml.querySelectorAll("AdaptationSet");
    let bestRepresentation = null;
    let bestBandwidth = 0;
    
    for (const as of adaptationSets) {
      const mimeType = as.getAttribute("mimeType") || "";
      const contentType = as.getAttribute("contentType") || "";
      
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
      const baseUrlEl = xml.querySelector("BaseURL");
      const baseUrl = baseUrlEl && baseUrlEl.textContent 
        ? resolveUrl(manifestUrl, baseUrlEl.textContent)
        : manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
      
      const segmentTemplate = bestRepresentation.querySelector("SegmentTemplate") ||
                              bestRepresentation.parentElement?.querySelector("SegmentTemplate");
      
      if (segmentTemplate) {
        const init = segmentTemplate.getAttribute("initialization");
        const media = segmentTemplate.getAttribute("media");
        const startNumber = parseInt(segmentTemplate.getAttribute("startNumber") || "1", 10);
        const timescale = parseInt(segmentTemplate.getAttribute("timescale") || "1", 10);
        
        if (init) {
          initSegment = resolveUrl(baseUrl, init.replace("$RepresentationID$", bestRepresentation.getAttribute("id") || ""));
        }
        
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
              
              segments.push({ url: resolveUrl(baseUrl, segUrl), duration: d / timescale });
              time += d;
              segmentNumber++;
            }
          }
        } else {
          const segmentDuration = parseInt(segmentTemplate.getAttribute("duration") || "0", 10);
          if (segmentDuration > 0 && totalDuration > 0) {
            const numSegments = Math.ceil(totalDuration / (segmentDuration / timescale));
            
            for (let i = 0; i < numSegments; i++) {
              const segUrl = media
                .replace("$RepresentationID$", bestRepresentation.getAttribute("id") || "")
                .replace("$Number$", String(startNumber + i))
                .replace("$Time$", String(i * segmentDuration));
              
              segments.push({ url: resolveUrl(baseUrl, segUrl), duration: segmentDuration / timescale });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to parse DASH manifest:", e);
  }
  
  return { segments, duration: totalDuration, initSegment };
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

async function startBackgroundDownload(data) {
  const { manifestUrl, segments: capturedSegments, initSegmentUrl: capturedInit } = data;
  
  const downloadId = `dl_${Date.now()}`;
  
  activeDownload = {
    id: downloadId,
    paused: false,
    aborted: false,
    downloaded: 0,
    total: 0,
    totalBytes: 0,
    duration: 0,
    filename: "",
    statusText: "Starting...",
    startTime: Date.now(),
    segments: [],
    initSegmentUrl: null,
    initChunk: null,
    results: []
  };
  
  try {
    // Parse manifest if available
    if (manifestUrl) {
      activeDownload.statusText = "Parsing manifest...";
      broadcastDownloadUpdate();
      
      const parsed = await parseManifest(manifestUrl);
      
      if (parsed && parsed.segments && parsed.segments.length > 0) {
        activeDownload.segments = parsed.segments.map((s, i) => ({
          url: s.url,
          duration: s.duration,
          index: i
        }));
        activeDownload.initSegmentUrl = parsed.initSegment;
        activeDownload.duration = parsed.duration;
      }
    }
    
    // Fall back to captured segments
    if (activeDownload.segments.length === 0 && capturedSegments && capturedSegments.length > 0) {
      activeDownload.segments = capturedSegments.map((s, i) => ({
        url: s.url,
        duration: 0,
        index: i
      }));
      activeDownload.initSegmentUrl = capturedInit;
    }
    
    if (activeDownload.segments.length === 0) {
      throw new Error("No segments found");
    }
    
    activeDownload.total = activeDownload.segments.length;
    activeDownload.results = new Array(activeDownload.segments.length);
    
    // Determine file type
    const firstUrl = activeDownload.segments[0]?.url || "";
    const isTS = firstUrl.toLowerCase().includes(".ts");
    const ext = isTS ? ".ts" : ".mp4";
    const durationStr = activeDownload.duration > 0 
      ? `_${formatDuration(activeDownload.duration).replace(/:/g, "m")}s` 
      : "";
    activeDownload.filename = `video${durationStr}_${downloadId.slice(3)}${ext}`;
    
    // Save initial state
    await saveDownloadToStorage({
      id: activeDownload.id,
      filename: activeDownload.filename,
      status: "downloading",
      total: activeDownload.total,
      downloaded: 0,
      totalBytes: 0,
      duration: activeDownload.duration,
      startTime: activeDownload.startTime,
      statusText: "Starting..."
    });
    
    broadcastDownloadUpdate();
    
    // Download init segment first
    if (activeDownload.initSegmentUrl) {
      while (activeDownload.paused && !activeDownload.aborted) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (activeDownload.aborted) throw new Error("Canceled");
      
      try {
        activeDownload.statusText = "Downloading init segment...";
        broadcastDownloadUpdate();
        activeDownload.initChunk = await fetchSegment(activeDownload.initSegmentUrl);
        activeDownload.totalBytes += activeDownload.initChunk.byteLength;
      } catch (e) {
        console.warn("Failed to download init segment:", e);
      }
    }
    
    // Download all segments
    for (let i = 0; i < activeDownload.segments.length; i++) {
      // Wait while paused
      while (activeDownload.paused && !activeDownload.aborted) {
        activeDownload.statusText = `Paused at ${activeDownload.downloaded}/${activeDownload.total}`;
        broadcastDownloadUpdate();
        await new Promise(r => setTimeout(r, 200));
      }
      
      if (activeDownload.aborted) {
        throw new Error("Canceled by user");
      }
      
      const seg = activeDownload.segments[i];
      
      try {
        const data = await fetchSegment(seg.url);
        activeDownload.results[i] = data;
        activeDownload.totalBytes += data.byteLength;
        activeDownload.downloaded++;
        
        activeDownload.statusText = `${activeDownload.downloaded}/${activeDownload.total} (${formatBytes(activeDownload.totalBytes)})`;
        broadcastDownloadUpdate();
        
        // Update storage periodically
        if (i % 10 === 0) {
          await updateDownloadInStorage(activeDownload.id, {
            downloaded: activeDownload.downloaded,
            totalBytes: activeDownload.totalBytes,
            statusText: activeDownload.statusText
          });
        }
      } catch (e) {
        console.warn(`Failed to download segment ${i}:`, e);
        activeDownload.downloaded++;
      }
      
      // Small delay
      await new Promise(r => setTimeout(r, 25));
    }
    
    if (activeDownload.aborted) {
      throw new Error("Canceled by user");
    }
    
    // Combine chunks
    activeDownload.statusText = "Combining segments...";
    broadcastDownloadUpdate();
    
    const chunks = [];
    if (activeDownload.initChunk) {
      chunks.push(activeDownload.initChunk);
    }
    for (const result of activeDownload.results) {
      if (result) chunks.push(result);
    }
    
    if (chunks.length === 0) {
      throw new Error("No segments downloaded");
    }
    
    // Store chunks in IndexedDB for the downloads page to retrieve
    const downloadData = {
      id: activeDownload.id,
      filename: activeDownload.filename,
      mimeType: isTS ? "video/mp2t" : "video/mp4",
      chunks: chunks,
      totalBytes: activeDownload.totalBytes
    };
    
    await storeDownloadChunks(downloadData);
    
    // Notify that download is ready for final save
    activeDownload.statusText = "Ready to save...";
    activeDownload.readyToSave = true;
    broadcastDownloadUpdate();
    
    // Open downloads page to trigger the actual file save
    chrome.tabs.create({ 
      url: chrome.runtime.getURL(`downloads/downloads.html?save=${activeDownload.id}`)
    });
    
    // Mark complete
    activeDownload.statusText = `Done - ${formatBytes(activeDownload.totalBytes)}`;
    await saveDownloadToStorage({
      id: activeDownload.id,
      filename: activeDownload.filename,
      status: "completed",
      total: activeDownload.total,
      downloaded: activeDownload.downloaded,
      totalBytes: activeDownload.totalBytes,
      duration: activeDownload.duration,
      startTime: activeDownload.startTime,
      endTime: Date.now(),
      statusText: `${formatBytes(activeDownload.totalBytes)}`
    });
    
    broadcastDownloadUpdate();
    
  } catch (e) {
    console.error("Download failed:", e);
    activeDownload.statusText = e.message;
    await updateDownloadInStorage(activeDownload.id, {
      status: "error",
      statusText: e.message,
      endTime: Date.now()
    });
    broadcastDownloadUpdate();
  } finally {
    activeDownload = null;
  }
}
