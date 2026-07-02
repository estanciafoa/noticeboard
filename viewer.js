const repoOwner = "estanciafoa";
const repoName  = "noticeboard";

/* Bump when the display code changes so the admin status panel can flag stale
   boards still running an old build. */
const APP_VERSION = "1.0";

const DEFAULT_DURATION_MS = 10000;
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000;  // default: fetch slides every 15 min
const REBUILD_INTERVAL_MS = 60 * 1000;                // re-evaluate visibility rules every minute
const OFFLINE_RETRY_INTERVAL_MS = 60 * 1000;          // retry internet every minute when offline
const OFFLINE_NOTICE = "⚠️ Internet Not Available. Please inform Helpdesk: 9384001882";

let slides   = [];
let elements = [];
let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;
let refreshIntervalTimer = null;
let offlineRetryTimer = null;
let index    = 0;
let timer    = null;
let transitionEffect = "fade";
let transitionMs = 700;
let ticker = { commonText: "", towerTexts: {} };
let heartbeatUrl = "";          // Google Apps Script web-app URL (from config.json)
let scheduledTickerRows = [];   // parsed from ticker.txt: time-scheduled per-tower messages
let lastTickerSignature = null; // skip re-render when the resolved ticker is unchanged

const TICKER_FILE = "ticker.txt";

/* Keys for the last-known-good config cached in localStorage, so the board can
   boot even with no internet at startup. */
const CONFIG_CACHE_KEY = "nb.config";
const TICKER_CACHE_KEY = "nb.ticker";

/* Offline backup slide: exactly one slide (chosen in the admin console) is
   downloaded into Cache Storage while online and shown when the board boots
   with no internet. */
const BACKUP_CACHE = "nb-backup";
const BACKUP_KEY = "offline-backup-slide";   // fixed Cache Storage key
const BACKUP_NAME_KEY = "nb.backupName";     // filename of the cached backup
const CACHE_VERSION_KEY = "nb.cacheVersion"; // last applied offlineCacheVersion

/* TOWER FILTER — read from ?t= in URL */
const towerParamRaw = new URLSearchParams(location.search).get("t");

function normalizeTowerParam(raw) {
  if (!raw) return "";
  const v = String(raw).trim().toLowerCase();
  if (/^\d+$/.test(v)) return `t${v}`;
  if (/^t\d+$/.test(v)) return v;
  if (/^t\d+c\d+$/.test(v)) return v;
  return v;
}

const towerParam = normalizeTowerParam(towerParamRaw);

function setNetworkStatus(message) {
  const el = document.getElementById("networkStatus");
  if (!el) return;
  el.textContent = message || "";
  el.style.display = message ? "block" : "none";
}

/* HEARTBEAT — tell the admin status panel this display is alive.
   Fire-and-forget POST to the Google Apps Script web app (configured via
   config.json → heartbeatUrl). Sent on boot and on every successful config
   refresh (~every refreshInterval minutes), so a display that goes dark simply
   stops reporting and the admin panel shows it stale/red.
   Skipped in local dev and for displays with no ?t= tower assigned. */
function sendHeartbeat() {
  if (isLocal || !heartbeatUrl || !towerParam) return;
  const payload = JSON.stringify({
    tv: towerParam,
    online: true,
    slides: elements.length,
    version: APP_VERSION,
    href: location.href,
    ua: navigator.userAgent
  });
  try {
    // text/plain keeps it a "simple" request (no CORS preflight, which Apps
    // Script can't answer). sendBeacon survives page unload; fetch is fallback.
    const blob = new Blob([payload], { type: "text/plain;charset=UTF-8" });
    if (navigator.sendBeacon && navigator.sendBeacon(heartbeatUrl, blob)) return;
    fetch(heartbeatUrl, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: payload
    }).catch(() => {});
  } catch (_) {}
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

async function isInternetAvailable() {
  if (!navigator.onLine) return false;
  try {
    const url = isLocal
      ? `config.json?t=${Date.now()}`
      : `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/config.json?t=${Date.now()}`;
    const res = await withTimeout(fetch(url, { cache: "no-store" }), 5000);
    return !!res && res.ok;
  } catch (_) {
    return false;
  }
}

/* LOAD CONFIG */
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

/* Apply the non-slide settings (durations, transition, ticker) from a parsed
   config object. Shared by the online and offline paths. */
function applyConfigSettings(data) {
  transitionEffect = data.transitionEffect || "fade";
  transitionMs = Number(data.transitionMs) > 0 ? Number(data.transitionMs) : 700;

  // Update refresh interval if configured (value is in minutes, convert to milliseconds)
  const newRefreshInterval = Number(data.refreshInterval) > 0 ? Number(data.refreshInterval) * 60000 : DEFAULT_REFRESH_INTERVAL_MS;
  refreshIntervalMs = newRefreshInterval;

  heartbeatUrl = data.heartbeatUrl || "";

  ticker = {
    commonText: data.ticker?.commonText || "",
    towerTexts: data.ticker?.towerTexts || {},
    towerExpiries: data.ticker?.towerExpiries || {},
    towerAttentionTexts: data.ticker?.towerAttentionTexts || {}
  };
  applyTicker();
}

/* Turn a parsed config.json object into live state and rebuild all slides.
   Used by the online path (load) where every slide image is reachable. */
function applyConfigData(data) {
  const defaultDuration = Number(data.defaultDuration) > 0 ? Number(data.defaultDuration) * 1000 : DEFAULT_DURATION_MS;
  applyConfigSettings(data);

  slides = (Array.isArray(data.slides) ? data.slides : []).map(s => ({
    name: s.name,
    duration: s.duration && !isNaN(Number(s.duration)) ? Number(s.duration) * 1000 : defaultDuration,
    times: Array.isArray(s.times) ? s.times
         : (s.start && s.end ? [{start: s.start, end: s.end}] : []),
    dates: Array.isArray(s.dates) ? s.dates
         : (s.startDate ? [{startDate: s.startDate, endDate: s.endDate || ""}] : []),
    expiry: s.expiry || null,
    towers: s.towers || ""
  })).filter(s => !!s.name);

  build();
}

async function load({ showError = true } = {}) {
  try {
    const configUrl = isLocal
      ? `config.json?t=${Date.now()}`
      : `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/config.json?t=${Date.now()}`;
    const resJson = await fetch(configUrl);
    if (!resJson.ok) throw new Error(`Failed to load config.json (HTTP ${resJson.status})`);

    const data = await resJson.json();

    // Honor a forced cache clear from the admin console BEFORE we re-populate.
    await applyCacheClear(data);

    await fetchScheduledTicker();
    applyConfigData(data);

    // Persist this good config + the chosen backup slide so the next boot can
    // start offline.
    try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(data)); } catch (_) {}
    await cacheBackupSlide(data.offlineBackup || "");

    setNetworkStatus("");
    sendHeartbeat();
    return true;
  } catch (e) {
    console.error("Failed to load config:", e);
    // Network failed — show the cached offline backup slide so the screen is
    // never blank just because the internet is down.
    if (!elements.length && await showOfflineBackup()) return true;
    if (showError && !elements.length) {
      document.getElementById("empty").innerText = "Failed to load slides";
    }
    return false;
  }
}

/* ---- OFFLINE BACKUP SLIDE ------------------------------------------------ */

/* Download the single admin-chosen backup slide into Cache Storage so it can be
   shown on a later offline boot. Passing "" drops any previously cached one. */
async function cacheBackupSlide(name) {
  try {
    if (!window.caches) return;
    if (!name) {
      try { localStorage.removeItem(BACKUP_NAME_KEY); } catch (_) {}
      try { await caches.delete(BACKUP_CACHE); } catch (_) {}
      return;
    }
    const { primary, fallback } = mediaUrls(name);
    let res = null;
    try { const r = await fetch(primary, { cache: "reload" }); if (r && r.ok) res = r; } catch (_) {}
    if (!res) { try { const r = await fetch(fallback, { cache: "reload" }); if (r && r.ok) res = r; } catch (_) {} }
    if (!res) return;   // couldn't fetch — keep whatever was cached before
    const cache = await caches.open(BACKUP_CACHE);
    await cache.put(BACKUP_KEY, res.clone());
    try { localStorage.setItem(BACKUP_NAME_KEY, name); } catch (_) {}
  } catch (e) {
    console.error("Failed to cache backup slide:", e);
  }
}

/* Restore settings/ticker from localStorage and show ONLY the cached backup
   slide (the other slides' images aren't available offline). Returns true if a
   backup slide was actually shown. */
async function showOfflineBackup() {
  try {
    const raw = localStorage.getItem(CONFIG_CACHE_KEY);
    if (raw) {
      loadCachedScheduledTicker();
      applyConfigSettings(JSON.parse(raw));
    }
  } catch (_) {}

  let name = "";
  try { name = localStorage.getItem(BACKUP_NAME_KEY) || ""; } catch (_) {}

  let blobUrl = null;
  if (name && window.caches) {
    try {
      const cache = await caches.open(BACKUP_CACHE);
      const res = await cache.match(BACKUP_KEY);
      if (res) blobUrl = URL.createObjectURL(await res.blob());
    } catch (_) {}
  }

  buildSingle(name, blobUrl);
  return !!blobUrl;
}

/* Build the frame with a single slide sourced from a local blob URL. */
function buildSingle(name, blobUrl) {
  const frame = document.getElementById("frame");
  frame.style.setProperty("--transition-ms", `${transitionMs}ms`);
  frame.classList.remove("effect-cut", "effect-fade", "effect-zoom");
  frame.classList.add(`effect-${transitionEffect}`);
  frame.querySelectorAll(".slide").forEach(el => el.remove());
  elements = [];

  if (!blobUrl) {
    document.getElementById("empty").style.display = "flex";
    return;
  }
  document.getElementById("empty").style.display = "none";

  const div = document.createElement("div");
  div.className = "slide";
  div.dataset.duration = DEFAULT_DURATION_MS;

  if (isVideo(name)) {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.src = blobUrl;
    div.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = blobUrl;
    div.appendChild(img);
  }

  frame.appendChild(div);
  elements.push(div);
  index = 0;
  show(0);
}

/* If the admin bumped offlineCacheVersion, wipe ALL local caches (shell, backup
   slide, cached config) so the displays re-download everything fresh. */
async function applyCacheClear(data) {
  const wantVersion = String(data.offlineCacheVersion || "");
  let haveVersion = "";
  try { haveVersion = localStorage.getItem(CACHE_VERSION_KEY) || ""; } catch (_) {}
  if (wantVersion === haveVersion) return;

  await clearOfflineCaches();
  try { localStorage.setItem(CACHE_VERSION_KEY, wantVersion); } catch (_) {}
}

async function clearOfflineCaches() {
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (_) {}
  try {
    localStorage.removeItem(CONFIG_CACHE_KEY);
    localStorage.removeItem(TICKER_CACHE_KEY);
    localStorage.removeItem(BACKUP_NAME_KEY);
  } catch (_) {}
}

async function refreshIfOnline() {
  const online = await isInternetAvailable();
  if (!online) {
    setNetworkStatus(OFFLINE_NOTICE);
    // Cold boot with no internet: show the cached offline backup slide instead
    // of leaving the screen blank. (If slides are already on screen — internet
    // dropped mid-run — keep showing them.)
    if (!elements.length) await showOfflineBackup();
    stopRefreshInterval();
    setupOfflineRetry();
    return;
  }

  setNetworkStatus("");
  stopOfflineRetry();
  await load({ showError: false });
  setupRefreshInterval();
}

/* VISIBILITY RULES */
function isVisible(s) {
  const now = new Date();

  if (!s.towers) return false;
  if (towerParam) {
    const assigned = s.towers.split(",").map(t => t.trim());
    const match = assigned.some(a => a === towerParam || towerParam.startsWith(a));
    if (!match) return false;
  }

  // Time slots: if any defined, NOW must fall inside at least one
  if (s.times && s.times.length > 0) {
    const current = now.getHours() * 60 + now.getMinutes();
    const inAnySlot = s.times.some(t => {
      if (!t.start || !t.end) return true;
      const [sh, sm] = t.start.split(":").map(Number);
      const [eh, em] = t.end.split(":").map(Number);
      return current >= sh * 60 + sm && current <= eh * 60 + em;
    });
    if (!inAnySlot) return false;
  }

  // Date ranges: if any defined, NOW must fall inside at least one
  if (s.dates && s.dates.length > 0) {
    const inAnyRange = s.dates.some(d => {
      if (!d.startDate) return true;
      const sd = new Date(d.startDate);
      if (now < sd) return false;
      if (d.endDate) {
        const ed = new Date(d.endDate);
        ed.setHours(23, 59, 59, 999);
        if (now > ed) return false;
      }
      return true;
    });
    if (!inAnyRange) return false;
  }

  // Expiry: hide slide if it was uploaded more than expiry-duration ago
  // Expiry is relative to the slide's start date (or config upload time isn't tracked,
  // so we use startDate of first date range if available)
  if (s.expiry) {
    const ms = parseExpiry(s.expiry);
    if (ms > 0 && s.dates && s.dates.length > 0 && s.dates[0].startDate) {
      const start = new Date(s.dates[0].startDate);
      if (now.getTime() - start.getTime() > ms) return false;
    }
  }

  return true;
}

function parseExpiry(exp) {
  const n = parseInt(exp, 10);
  if (isNaN(n)) return 0;
  if (/h/i.test(exp)) return n * 3600000;
  if (/d/i.test(exp)) return n * 86400000;
  if (/m/i.test(exp)) return n * 60000;
  return n * 1000;
}

function isVideo(name) {
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(name);
}

function mediaUrls(name) {
  const bust = Date.now();
  const enc = encodeURIComponent(name);
  if (isLocal) {
    const local = `slides/${enc}?t=${bust}`;
    return { primary: local, fallback: local };
  }
  const pages = `https://${repoOwner}.github.io/${repoName}/slides/${enc}?t=${bust}`;
  const raw   = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/slides/${enc}?t=${bust}`;
  // Videos: prefer raw (Pages often 404s / ORB-blocks large files)
  // Images: prefer Pages (faster CDN), fallback to raw
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(name)) {
    return { primary: raw, fallback: pages };
  }
  return { primary: pages, fallback: raw };
}

/* TICKER */
function fitTextToContainer(container, span) {
  // No dynamic font sizing — use CSS-defined size
}

/* SCHEDULED TICKER (ticker.txt) ---------------------------------------------
   One record per line, pipe-delimited:
     location | start | expiry | attention | message
   - location : t1c1..t5c2, club, gate, or "all"; comma-separate for several
   - start/expiry : YYYY-MM-DD HH:MM (24h, local). Blank start = active now;
                    blank expiry = never expires. Active when start <= now < expiry.
   - attention : optional badge text (falls back to "Attention !")
   - message : may use | (or literal \n) for line breaks
   Lines starting with # and blank lines are ignored. */
function parseLocalDateTime(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh || 0), Number(mm || 0), 0, 0);
}

function parseTickerFile(txt) {
  const rows = [];
  (txt || "").split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = line.split("|");
    const locationStr = (parts[0] || "").trim().toLowerCase();
    if (!locationStr) return;
    let message = parts.slice(4).join("|").trim();
    if (!message) return;
    message = message.replace(/\\n/g, "|"); // allow literal \n as a line break
    rows.push({
      locations: locationStr.split(",").map(s => s.trim()).filter(Boolean),
      start: parseLocalDateTime((parts[1] || "").trim()),
      expiry: parseLocalDateTime((parts[2] || "").trim()),
      attention: (parts[3] || "").trim(),
      message
    });
  });
  return rows;
}

async function fetchScheduledTicker() {
  try {
    const url = isLocal
      ? `${TICKER_FILE}?t=${Date.now()}`
      : `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/${TICKER_FILE}?t=${Date.now()}`;
    const res = await withTimeout(fetch(url, { cache: "no-store" }), 5000);
    if (!res || !res.ok) { scheduledTickerRows = []; return; }   // missing file is fine
    const txt = await res.text();
    scheduledTickerRows = parseTickerFile(txt);
    try { localStorage.setItem(TICKER_CACHE_KEY, txt); } catch (_) {}
  } catch (_) {
    scheduledTickerRows = [];   // never let a ticker.txt problem break the viewer
  }
}

/* Restore the scheduled ticker rows from the last cached ticker.txt text. */
function loadCachedScheduledTicker() {
  try {
    const txt = localStorage.getItem(TICKER_CACHE_KEY);
    scheduledTickerRows = txt ? parseTickerFile(txt) : [];
  } catch (_) {
    scheduledTickerRows = [];
  }
}

/* Return the active scheduled row for a tower key (honours start/expiry), or null. */
function activeScheduledTicker(key) {
  if (!key || !scheduledTickerRows.length) return null;
  const now = Date.now();
  const prefix = key.replace(/c\d+$/, "");
  const active = scheduledTickerRows.filter(r => {
    if (!r.locations.some(l => l === "all" || l === key || l === prefix)) return false;
    if (r.start && now < r.start.getTime()) return false;
    if (r.expiry && now >= r.expiry.getTime()) return false;
    return true;
  });
  if (!active.length) return null;
  // If several overlap, the one that started most recently wins.
  active.sort((a, b) => (a.start ? a.start.getTime() : 0) - (b.start ? b.start.getTime() : 0));
  return active[active.length - 1];
}

function applyTicker() {
  const leftEl = document.getElementById("tickerLeft");
  const scrollEl = document.getElementById("tickerScroll");
  if (!leftEl || !scrollEl) return;

  const commonText = ticker.commonText || "";

  // Find the best matching text for this tower param
  let text = "";
  let matchKey = towerParam || "";
  let scheduledAttention = "";
  if (towerParam && ticker.towerTexts) {
    // Exact match first (e.g. "t1c1"), then tower prefix (e.g. "t1")
    text = ticker.towerTexts[towerParam] || "";
    if (!text) {
      const towerPrefix = towerParam.replace(/c\d+$/, "");
      if (towerPrefix !== towerParam) {
        text = ticker.towerTexts[towerPrefix] || "";
        matchKey = towerPrefix;
      }
    }
    // Check per-tower expiry
    const expiry = ticker.towerExpiries?.[matchKey];
    if (expiry && Date.now() > expiry) {
      text = "";
    }
  }

  // No (unexpired) manual entry → fall back to the scheduled ticker.txt rows.
  // A manual config.json entry always wins, so admin can override the sheet.
  if (!text && towerParam) {
    const row = activeScheduledTicker(towerParam);
    if (row) {
      text = row.message;
      scheduledAttention = row.attention || "";
    }
  }

  const perTowerAttention = scheduledAttention || ticker.towerAttentionTexts?.[matchKey] || "";

  // Idempotent: this runs every minute, so skip all DOM/animation work (which
  // would otherwise restart the scroll animation) when nothing has changed.
  const signature = `${commonText} ${text} ${perTowerAttention}`;
  if (signature === lastTickerSignature) return;
  lastTickerSignature = signature;

  // Left section: common text
  leftEl.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = commonText.split("|").map(s => s.trim()).join("\n");
  leftEl.appendChild(span);
  fitTextToContainer(leftEl, span);

  const displayText = text ? "" + text.split("|").map(s => s.trim()).join("\n") : "";
  scrollEl.textContent = displayText;
  const scrollEl2 = document.getElementById("tickerScroll2");
  if (scrollEl2) scrollEl2.textContent = displayText;

  // Flash news style when scrolling text is active
  const bar = document.querySelector(".bottom-bar");
  const wrap = document.getElementById("tickerScrollWrap");
  if (bar) {
    const hasAnyTicker = !!(text || commonText.trim());
    bar.classList.toggle("has-ticker", hasAnyTicker);
    bar.classList.toggle("flash-news", !!text);
  }

  // Update attention tag text
  const attTag = document.querySelector(".attention-tag");
  if (attTag) {
    attTag.textContent = perTowerAttention || "Attention !";
  }

  // Randomly alternate animations each cycle. Use onanimationiteration (a single
  // handler slot) rather than addEventListener so repeated calls never stack.
  if (text && wrap) {
    const anims = ["ticker-zoom", "ticker-flip", "ticker-slide-up", "ticker-drop", "ticker-slide-right", "ticker-slide-left"];
    function pickAnim() {
      const name = anims[Math.floor(Math.random() * anims.length)];
      wrap.style.animation = "none";
      wrap.offsetHeight; // reflow
      wrap.style.animation = `${name} 7s cubic-bezier(0.16, 1, 0.3, 1) infinite`;
    }
    pickAnim();
    wrap.onanimationiteration = pickAnim;
  } else if (wrap) {
    wrap.onanimationiteration = null;
    wrap.style.animation = "none";
  }
}

/* BUILD ELEMENTS */
function build() {
  const frame = document.getElementById("frame");
  frame.style.setProperty("--transition-ms", `${transitionMs}ms`);
  frame.classList.remove("effect-cut", "effect-fade", "effect-zoom");
  frame.classList.add(`effect-${transitionEffect}`);

  frame.querySelectorAll(".slide").forEach(el => el.remove());
  elements = [];

  const visible = slides.filter(isVisible);

  document.getElementById("empty").style.display = visible.length ? "none" : "flex";

  visible.forEach(s => {
    const div = document.createElement("div");
    div.className = "slide";
    div.dataset.duration = s.duration;

    const urls = mediaUrls(s.name);

    if (isVideo(s.name)) {
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.preload = "auto";
      video.onended = next;

      const applyFallback = () => {
        if (video.dataset.fallbackApplied) return;
        video.dataset.fallbackApplied = "1";
        video.src = urls.fallback;
        video.load();
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
      };
      video.onerror = applyFallback;

      // ORB/CORS blocks may not fire onerror; detect via stall timeout
      let stallTimer = setTimeout(() => {
        if (video.readyState === 0) applyFallback();
      }, 4000);
      video.onloadeddata = () => clearTimeout(stallTimer);

      const source = document.createElement("source");
      source.src = urls.primary;
      source.type = "video/mp4";
      source.onerror = applyFallback;
      video.appendChild(source);
      div.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = urls.primary;
      img.onerror = () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = "1";
        img.src = urls.fallback;
      };
      div.appendChild(img);
    }

    frame.appendChild(div);
    elements.push(div);
  });

  index = 0;
  show(index);
}

/* SHOW SLIDE */
function show(i) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!elements.length) return;

  elements.forEach(e => {
    e.classList.remove("active");
    const v = e.querySelector("video");
    if (v) { try { v.pause(); v.currentTime = 0; } catch (_) {} }
  });

  const el = elements[i];
  el.classList.add("active");

  const video = el.querySelector("video");
  if (video) {
    const tryPlay = () => {
      const p = video.play();
      if (p && p.catch) p.catch(() => {
        timer = setTimeout(next, DEFAULT_DURATION_MS);
      });
    };

    const p = video.play();
    if (p && p.catch) p.catch(() => {
      const onReady = () => {
        video.removeEventListener("canplay", onReady);
        tryPlay();
      };
      video.addEventListener("canplay", onReady, { once: true });
      timer = setTimeout(next, DEFAULT_DURATION_MS);
    });
  } else {
    timer = setTimeout(next, Number(el.dataset.duration) || DEFAULT_DURATION_MS);
  }
}

function next() {
  index = (index + 1) % elements.length;
  show(index);
}

/* SETUP REFRESH INTERVAL - called on init and when config changes */
function setupRefreshInterval() {
  if (refreshIntervalTimer) clearInterval(refreshIntervalTimer);
  refreshIntervalTimer = setInterval(refreshIfOnline, refreshIntervalMs);
}

function stopRefreshInterval() {
  if (!refreshIntervalTimer) return;
  clearInterval(refreshIntervalTimer);
  refreshIntervalTimer = null;
}

function setupOfflineRetry() {
  if (offlineRetryTimer) return;
  offlineRetryTimer = setInterval(refreshIfOnline, OFFLINE_RETRY_INTERVAL_MS);
}

function stopOfflineRetry() {
  if (!offlineRetryTimer) return;
  clearInterval(offlineRetryTimer);
  offlineRetryTimer = null;
}

/* PERIODIC REBUILD (re-evaluate time-based visibility) */
setInterval(() => {
  const currentNames = elements
    .map(el => el.querySelector("img,video")?.src.split("/").pop().split("?")[0])
    .join("|");
  const visibleNames = slides.filter(isVisible).map(s => encodeURIComponent(s.name)).join("|");
  if (currentNames !== visibleNames) build();
  // Re-evaluate scheduled ticker start/expiry times against the clock each minute
  // (rows themselves are refreshed on the slower config refresh cycle).
  applyTicker();
}, REBUILD_INTERVAL_MS);

window.addEventListener("online", () => {
  setNetworkStatus("");
  stopOfflineRetry();
  refreshIfOnline();
});

window.addEventListener("offline", () => {
  setNetworkStatus(OFFLINE_NOTICE);
  stopRefreshInterval();
  setupOfflineRetry();
});

/* INIT */
refreshIfOnline();
