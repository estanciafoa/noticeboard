const repoOwner = "estanciafoa";
const repoName  = "noticeboard";

const DEFAULT_DURATION_MS = 10000;
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000;  // default: fetch slides every 15 min
const REBUILD_INTERVAL_MS = 60 * 1000;                // re-evaluate visibility rules every minute
const OFFLINE_RETRY_INTERVAL_MS = 60 * 1000;          // retry internet every minute when offline
const OFFLINE_NOTICE = "⚠️ Internet Not Working. Please report to Admin office";

let slides   = [];
let elements = [];
let refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS;
let refreshIntervalTimer = null;
let offlineRetryTimer = null;
let index    = 0;
let timer    = null;
let transitionEffect = "fade";
let transitionMs = 700;
let emergency = { enabled: false, slide: "", towers: "" };
let ticker = { commonText: "", towerTexts: {} };

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

async function load({ showError = true } = {}) {
  try {
    const configUrl = isLocal
      ? `config.json?t=${Date.now()}`
      : `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/config.json?t=${Date.now()}`;
    const resJson = await fetch(configUrl);
    if (!resJson.ok) throw new Error(`Failed to load config.json (HTTP ${resJson.status})`);

    const data = await resJson.json();
    const defaultDuration = Number(data.defaultDuration) > 0 ? Number(data.defaultDuration) * 1000 : DEFAULT_DURATION_MS;
    transitionEffect = data.transitionEffect || "fade";
    transitionMs = Number(data.transitionMs) > 0 ? Number(data.transitionMs) : 700;
    
    // Update refresh interval if configured (value is in minutes, convert to milliseconds)
    const newRefreshInterval = Number(data.refreshInterval) > 0 ? Number(data.refreshInterval) * 60000 : DEFAULT_REFRESH_INTERVAL_MS;
    refreshIntervalMs = newRefreshInterval;
    
    emergency = {
      enabled: !!data.emergency?.enabled,
      slide: data.emergency?.slide || "",
      towers: data.emergency?.towers || ""
    };

    ticker = {
      commonText: data.ticker?.commonText || "",
      towerTexts: data.ticker?.towerTexts || {},
      towerExpiries: data.ticker?.towerExpiries || {},
      towerAttentionTexts: data.ticker?.towerAttentionTexts || {}
    };
    applyTicker();

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
    setNetworkStatus("");
    return true;
  } catch (e) {
    console.error("Failed to load config:", e);
    if (showError && !elements.length) {
      document.getElementById("empty").innerText = "Failed to load slides";
    }
    return false;
  }
}

async function refreshIfOnline() {
  const online = await isInternetAvailable();
  if (!online) {
    setNetworkStatus(OFFLINE_NOTICE);
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

function applyTicker() {
  const leftEl = document.getElementById("tickerLeft");
  const scrollEl = document.getElementById("tickerScroll");
  if (!leftEl || !scrollEl) return;

  // Left section: common text
  leftEl.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = (ticker.commonText || "").split("|").map(s => s.trim()).join("\n");
  leftEl.appendChild(span);
  fitTextToContainer(leftEl, span);

  // Find the best matching text for this tower param
  let text = "";
  let matchKey = towerParam || "";
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
  const displayText = text ? "" + text.split("|").map(s => s.trim()).join("\n") : "";
  scrollEl.textContent = displayText;
  const scrollEl2 = document.getElementById("tickerScroll2");
  if (scrollEl2) scrollEl2.textContent = displayText;

  // Flash news style when scrolling text is active
  const bar = document.querySelector(".bottom-bar");
  const wrap = document.getElementById("tickerScrollWrap");
  if (bar) {
    const hasAnyTicker = !!(text || (ticker.commonText || "").trim());
    bar.classList.toggle("has-ticker", hasAnyTicker);
    if (text) {
      bar.classList.add("flash-news");
    } else {
      bar.classList.remove("flash-news");
    }
  }

  // Update attention tag text
  const attTag = document.querySelector(".attention-tag");
  if (attTag) {
    const perTowerAttention = ticker.towerAttentionTexts?.[matchKey] || "";
    attTag.textContent = perTowerAttention || "Attention !";
  }

  // Randomly alternate animations each cycle
  if (text && wrap) {
    const anims = ["ticker-zoom", "ticker-flip", "ticker-slide-up", "ticker-drop", "ticker-slide-right", "ticker-slide-left"];
    function pickAnim() {
      const name = anims[Math.floor(Math.random() * anims.length)];
      wrap.style.animation = "none";
      wrap.offsetHeight; // reflow
      wrap.style.animation = `${name} 7s cubic-bezier(0.16, 1, 0.3, 1) infinite`;
    }
    pickAnim();
    wrap.addEventListener("animationiteration", pickAnim);
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

  let visible = slides.filter(isVisible);

  // Emergency override
  if (emergency.enabled && emergency.slide) {
    const emTowers = (emergency.towers || "").split(",").filter(Boolean);
    const applies = !towerParam || emTowers.some(a => a === towerParam || towerParam.startsWith(a));
    if (applies) {
      const em = slides.find(s => s.name === emergency.slide);
      if (em) visible = [em];
    }
  }
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
