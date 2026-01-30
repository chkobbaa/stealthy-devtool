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

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("ui/panel.html");
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

  return false;
});
