const state = {
  tabId: null,
  requests: [],
  filter: "all",
  search: "",
  selectedId: null,
  debuggerAttached: false,
  debuggerError: null
};

const requestsBody = document.getElementById("requestsBody");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const exportHarBtn = document.getElementById("exportHarBtn");
const debuggerBtn = document.getElementById("debuggerBtn");
const captureStatus = document.getElementById("captureStatus");
const tabSelect = document.getElementById("tabSelect");
const refreshTabsBtn = document.getElementById("refreshTabsBtn");
const copyUrlBtn = document.getElementById("copyUrlBtn");
const copyCurlBtn = document.getElementById("copyCurlBtn");
const detailsTitle = document.getElementById("detailsTitle");

const tabPanels = {
  headers: document.getElementById("tab-headers"),
  payload: document.getElementById("tab-payload"),
  preview: document.getElementById("tab-preview"),
  response: document.getElementById("tab-response"),
  timing: document.getElementById("tab-timing")
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(ms) {
  if (!ms) return "0 ms";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function getNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    return last || parsed.hostname;
  } catch {
    return url;
  }
}

function getHostname(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function matchesFilter(entry) {
  if (state.filter === "all") return true;
  return entry.type === state.filter;
}

function matchesSearch(entry) {
  if (!state.search) return true;
  const term = state.search.toLowerCase();
  return (
    entry.url.toLowerCase().includes(term) ||
    (entry.method || "").toLowerCase().includes(term) ||
    (entry.initiator || "").toLowerCase().includes(term)
  );
}

function getFilteredRequests() {
  return state.requests.filter((entry) => matchesFilter(entry) && matchesSearch(entry));
}

function renderTable() {
  const filtered = getFilteredRequests();
  requestsBody.innerHTML = "";
  emptyState.style.display = filtered.length ? "none" : "block";

  for (const entry of filtered) {
    const row = document.createElement("tr");
    row.dataset.id = entry.id;
    if (entry.id === state.selectedId) {
      row.classList.add("selected");
    }

    row.innerHTML = `
      <td title="${entry.url}">${getNameFromUrl(entry.url)}</td>
      <td title="${entry.url}">${entry.url}</td>
      <td>${entry.status || entry.error || ""}</td>
      <td>${entry.type}</td>
      <td title="${entry.initiator || ""}">${getHostname(entry.initiator)}</td>
      <td class="col-size">${formatBytes(entry.size)}</td>
      <td class="col-time">${formatDuration(entry.duration)}</td>
      <td class="col-actions"><button class="row-btn" data-action="copy">Copy</button></td>
    `;

    const copyBtn = row.querySelector(".row-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        copyText(entry.url);
      });
    }

    row.addEventListener("click", () => {
      state.selectedId = entry.id;
      renderTable();
      renderDetails(entry);
    });

    requestsBody.appendChild(row);
  }
}

function renderHeaders(entry) {
  const requestHeaders = entry.requestHeaders || [];
  const responseHeaders = entry.responseHeaders || [];
  const redirectInfo = entry.redirectedFrom
    ? `\nRedirected: ${entry.redirectedFrom} → ${entry.redirectedTo}`
    : "";
  tabPanels.headers.innerHTML = `
    <div class="kv-block">
      <div class="kv-title">General</div>
      <div class="kv-code">${entry.method} ${entry.url}\nStatus: ${entry.status || entry.error || ""}\nSource: ${entry.source || "webRequest"}\nFrom Cache: ${entry.fromCache ? "yes" : "no"}${redirectInfo}</div>
    </div>
    <div class="kv-block">
      <div class="kv-title">Request Headers</div>
      <div class="kv-code">${requestHeaders.map((h) => `${h.name}: ${h.value}`).join("\n") || "(none)"}</div>
    </div>
    <div class="kv-block">
      <div class="kv-title">Response Headers</div>
      <div class="kv-code">${responseHeaders.map((h) => `${h.name}: ${h.value}`).join("\n") || "(none)"}</div>
    </div>
  `;
}

function renderPayload(entry) {
  const body = entry.requestBody;
  let content = "(no request payload)";
  if (body) {
    if (body.type === "formData") {
      content = JSON.stringify(body.value, null, 2);
    } else {
      content = body.value || "(empty)";
    }
  }
  tabPanels.payload.innerHTML = `
    <div class="kv-block">
      <div class="kv-title">Request Payload</div>
      <div class="kv-code">${escapeHtml(content)}</div>
    </div>
  `;
}

function renderPreview(entry) {
  if (!entry.responseBody) {
    tabPanels.preview.innerHTML = "<div class=\"note\">Preview is unavailable without response bodies.</div>";
    return;
  }
  let content = getResponseText(entry);
  try {
    content = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    // Keep as-is.
  }
  tabPanels.preview.innerHTML = `
    <div class="kv-block">
      <div class="kv-title">Preview</div>
      <div class="kv-code">${escapeHtml(content)}</div>
      ${entry.responseBodyEncoding === "base64" ? "<div class=\"note\">Decoded from base64.</div>" : ""}
    </div>
  `;
}

function renderResponse(entry) {
  if (!entry.responseBody) {
    tabPanels.response.innerHTML = "<div class=\"note\">Response body is not available via webRequest.</div>";
    return;
  }
  tabPanels.response.innerHTML = `
    <div class="kv-code">${escapeHtml(getResponseText(entry))}</div>
    ${entry.responseBodyEncoding === "base64" ? "<div class=\"note\">Decoded from base64.</div>" : ""}
  `;
}

function renderTiming(entry) {
  const duration = entry.duration || 0;
  const maxDuration = Math.max(...state.requests.map((r) => r.duration || 0), duration, 1);
  const width = Math.max(4, (duration / maxDuration) * 100);
  const startLabel = entry.startTime ? new Date(entry.startTime).toLocaleTimeString() : "-";
  const endLabel = entry.endTime ? new Date(entry.endTime).toLocaleTimeString() : "-";
  tabPanels.timing.innerHTML = `
    <div class="kv-block">
      <div class="kv-title">Timing</div>
      <div class="kv-code">Start: ${startLabel}\nEnd: ${endLabel}\nDuration: ${formatDuration(duration)}</div>
      <div class="timing-row">
        <div class="timing-bar" style="width: ${width}%;"></div>
      </div>
    </div>
  `;
}

function renderDetails(entry) {
  if (!entry) return;
  detailsTitle.textContent = `${entry.method} ${entry.url}`;
  copyUrlBtn.disabled = false;
  copyCurlBtn.disabled = false;
  renderHeaders(entry);
  renderPayload(entry);
  renderPreview(entry);
  renderResponse(entry);
  renderTiming(entry);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getResponseText(entry) {
  if (!entry.responseBody) return "";
  if (entry.responseBodyEncoding === "base64") {
    try {
      return atob(entry.responseBody);
    } catch {
      return entry.responseBody;
    }
  }
  return entry.responseBody;
}

function updateCaptureStatus() {
  if (state.debuggerAttached) {
    captureStatus.textContent = "Capture: Debugger";
    captureStatus.classList.add("active");
    debuggerBtn.textContent = "Disable Deep Capture";
  } else {
    captureStatus.textContent = "Capture: WebRequest";
    captureStatus.classList.remove("active");
    debuggerBtn.textContent = "Enable Deep Capture";
  }
  if (state.debuggerError) {
    captureStatus.textContent = `Capture: WebRequest (${state.debuggerError})`;
  }
}

function buildHar(entries) {
  const startedDateTime = (entry) => new Date(entry.startTime || Date.now()).toISOString();
  const toHarHeaders = (headers) => (headers || []).map((h) => ({ name: h.name, value: h.value }));
  const toHarPostData = (entry) => {
    if (!entry.requestBody) return undefined;
    if (entry.requestBody.type === "formData") {
      return {
        mimeType: "application/x-www-form-urlencoded",
        params: Object.entries(entry.requestBody.value).map(([name, value]) => ({
          name,
          value: Array.isArray(value) ? value.join(",") : String(value)
        }))
      };
    }
    return {
      mimeType: "text/plain",
      text: entry.requestBody.value || ""
    };
  };

  return {
    log: {
      version: "1.2",
      creator: { name: "Stealthy Network Panel", version: "1.0.0" },
      entries: entries.map((entry) => ({
        startedDateTime: startedDateTime(entry),
        time: entry.duration || 0,
        request: {
          method: entry.method || "GET",
          url: entry.url || "",
          httpVersion: "HTTP/1.1",
          headers: toHarHeaders(entry.requestHeaders),
          queryString: [],
          headersSize: -1,
          bodySize: entry.requestBody ? (entry.requestBody.value || "").length : 0,
          postData: toHarPostData(entry)
        },
        response: {
          status: entry.status || 0,
          statusText: entry.error || "",
          httpVersion: "HTTP/1.1",
          headers: toHarHeaders(entry.responseHeaders),
          redirectURL: entry.redirectedTo || "",
          headersSize: -1,
          bodySize: entry.size || 0,
          content: entry.responseBody
            ? {
                size: entry.responseBody.length,
                mimeType: "",
                text: entry.responseBody,
                encoding: entry.responseBodyEncoding === "base64" ? "base64" : undefined
              }
            : { size: entry.size || 0, mimeType: "" }
        },
        cache: {},
        timings: {
          blocked: -1,
          dns: -1,
          connect: -1,
          send: 0,
          wait: entry.duration || 0,
          receive: 0,
          ssl: -1
        },
        _source: entry.source || "webRequest"
      }))
    }
  };
}

function buildCurl(entry) {
  const parts = ["curl", "-X", entry.method || "GET", `"${entry.url}"`];
  (entry.requestHeaders || []).forEach((header) => {
    const name = header.name || "";
    const value = header.value || "";
    parts.push("-H", `"${name}: ${value}"`);
  });
  if (entry.requestBody && entry.requestBody.value) {
    const payload = String(entry.requestBody.value).replace(/"/g, "\\\"");
    parts.push("--data", `"${payload}"`);
  }
  return parts.join(" ");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
}

function setTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  Object.keys(tabPanels).forEach((key) => {
    tabPanels[key].classList.toggle("active", key === tabName);
  });
}

function attachUiListeners() {
  document.querySelectorAll(".filter-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      renderTable();
    });
  });

  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim();
    renderTable();
  });

  clearBtn.addEventListener("click", async () => {
    if (state.tabId == null) return;
    await chrome.runtime.sendMessage({ type: "clearRequests", tabId: state.tabId });
  });

  exportBtn.addEventListener("click", () => {
    const data = JSON.stringify(getFilteredRequests(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `network-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  exportHarBtn.addEventListener("click", () => {
    const data = JSON.stringify(buildHar(getFilteredRequests()), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `network-${Date.now()}.har`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  debuggerBtn.addEventListener("click", async () => {
    if (state.tabId == null) return;
    state.debuggerError = null;
    if (!state.debuggerAttached) {
      const response = await chrome.runtime.sendMessage({ type: "enableDebugger", tabId: state.tabId });
      if (!response.ok) {
        state.debuggerError = response.error || "Failed to attach";
      }
    } else {
      const response = await chrome.runtime.sendMessage({ type: "disableDebugger", tabId: state.tabId });
      if (!response.ok) {
        state.debuggerError = response.error || "Failed to detach";
      }
    }
    updateCaptureStatus();
  });

  copyUrlBtn.addEventListener("click", () => {
    const entry = state.requests.find((item) => item.id === state.selectedId);
    if (!entry) return;
    copyText(entry.url);
  });

  copyCurlBtn.addEventListener("click", () => {
    const entry = state.requests.find((item) => item.id === state.selectedId);
    if (!entry) return;
    copyText(buildCurl(entry));
  });

  tabSelect.addEventListener("change", async () => {
    const nextId = Number(tabSelect.value);
    if (!Number.isFinite(nextId)) return;
    state.tabId = nextId;
    await loadInitialRequests();
  });

  refreshTabsBtn.addEventListener("click", () => {
    populateTabList();
  });
}

function getTabIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("tabId"));
  return Number.isFinite(value) ? value : null;
}

async function populateTabList() {
  const tabs = await chrome.tabs.query({});
  tabSelect.innerHTML = "";
  const relevant = tabs.filter((tab) => tab.id && tab.url && !tab.url.startsWith("chrome-extension://"));
  for (const tab of relevant) {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = `${tab.title || tab.url}`;
    tabSelect.appendChild(option);
  }

  if (state.tabId && relevant.some((t) => t.id === state.tabId)) {
    tabSelect.value = String(state.tabId);
    return;
  }

  if (relevant.length) {
    state.tabId = relevant[0].id;
    tabSelect.value = String(state.tabId);
  }
}

async function loadInitialRequests() {
  if (state.tabId == null) {
    state.tabId = getTabIdFromUrl();
  }
  await populateTabList();
  if (state.tabId == null) return;
  const response = await chrome.runtime.sendMessage({ type: "getRequests", tabId: state.tabId });
  state.requests = response.requests || [];
  const dbg = await chrome.runtime.sendMessage({ type: "getDebuggerStatus", tabId: state.tabId });
  state.debuggerAttached = !!dbg.attached;
  if (!state.selectedId) {
    copyUrlBtn.disabled = true;
    copyCurlBtn.disabled = true;
  }
  updateCaptureStatus();
  renderTable();
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;
  if (message.tabId !== state.tabId) return;

  if (message.type === "requestUpdated") {
    const index = state.requests.findIndex((item) => item.id === message.requestId);
    if (index === -1) {
      state.requests.push(message.entry);
    } else {
      state.requests[index] = message.entry;
    }
    renderTable();
    if (state.selectedId === message.requestId) {
      renderDetails(message.entry);
    }
  }

  if (message.type === "cleared") {
    state.requests = [];
    state.selectedId = null;
    detailsTitle.textContent = "Select a request";
    copyUrlBtn.disabled = true;
    copyCurlBtn.disabled = true;
    Object.values(tabPanels).forEach((panel) => (panel.innerHTML = ""));
    renderTable();
  }

  if (message.type === "debuggerStatus") {
    state.debuggerAttached = !!message.attached;
    state.debuggerError = message.error || null;
    updateCaptureStatus();
  }
});

chrome.tabs.onActivated.addListener(() => {
  // Do not auto-switch target; user controls it.
  populateTabList();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tabId && changeInfo.status === "loading") {
    loadInitialRequests();
  }
});

attachUiListeners();
loadInitialRequests();
