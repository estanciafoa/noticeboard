/* ============================================================
   DISPLAY STATUS PANEL
   Reads per-display heartbeats from the Google Apps Script backend
   (appConfig.heartbeatUrl) and shows which TVs are alive.

   A display reports on boot and every config refresh (~15 min). If we
   haven't heard from one in STALE_MS it's shown offline (red dot).
   Backend setup lives in heartbeat/README.md.
   ============================================================ */

const STALE_MS = 35 * 60 * 1000;          // no heartbeat this long → offline (red)
const STATUS_AUTO_REFRESH_MS = 30 * 1000; // re-poll while the modal is open

let statusTimer = null;

function openStatusPanel() {
  const modal = document.getElementById("statusModal");
  if (!modal) return;
  modal.style.display = "flex";

  const urlInput = document.getElementById("heartbeatUrlInput");
  if (urlInput) urlInput.value = appConfig.heartbeatUrl || "";

  refreshStatus();
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(refreshStatus, STATUS_AUTO_REFRESH_MS);
}

function closeStatusPanel() {
  const modal = document.getElementById("statusModal");
  if (modal) modal.style.display = "none";
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
}

/* Save the backend URL into config.json (round-tripped by js/config.js). */
async function saveHeartbeatUrl() {
  const urlInput = document.getElementById("heartbeatUrlInput");
  if (!urlInput) return;
  appConfig.heartbeatUrl = urlInput.value.trim();
  const btn = document.getElementById("heartbeatUrlSaveBtn");
  const prev = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    await saveConfig({ silent: true });
    refreshStatus();
  } catch (e) {
    alert("Failed to save backend URL: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

function relativeTime(ms) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}

async function refreshStatus() {
  const body = document.getElementById("statusBody");
  const summary = document.getElementById("statusSummary");
  if (!body) return;

  const url = (appConfig.heartbeatUrl || "").trim();
  if (!url) {
    if (summary) summary.textContent = "";
    body.innerHTML =
      `<div class="status-empty">
         <p><strong>No backend configured yet.</strong></p>
         <p>Paste your Google Apps Script Web App URL above and Save.
         See <code>heartbeat/README.md</code> for the one-time setup.</p>
       </div>`;
    return;
  }

  if (!body.dataset.loaded) {
    body.innerHTML = `<p class="status-loading">Loading…</p>`;
  }

  let data;
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(),
                            { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (e) {
    if (summary) summary.textContent = "";
    body.innerHTML =
      `<div class="status-empty">
         <p style="color:#f87171"><strong>Couldn't reach the backend.</strong></p>
         <p>${(e.message || e)}. Check the URL, that the Web App is deployed with
         access <em>Anyone</em>, and that it ends in <code>/exec</code>.</p>
       </div>`;
    return;
  }

  body.dataset.loaded = "1";
  const now = Number(data.now) || Date.now();
  const byTv = {};
  (data.displays || []).forEach(d => { byTv[String(d.tv).toLowerCase()] = d; });

  // One card per known location, worst status first (offline → never → online).
  const rows = LOCATIONS.map(loc => {
    const hb = byTv[loc.id];
    const lastSeen = hb ? Number(hb.lastSeen) || 0 : 0;
    const age = lastSeen ? now - lastSeen : Infinity;
    let state;
    if (!hb || !lastSeen) state = "never";
    else if (age > STALE_MS) state = "offline";
    else state = "online";
    return { loc, hb, lastSeen, age, state };
  });

  const rank = { offline: 0, never: 1, online: 2 };
  rows.sort((a, b) => (rank[a.state] - rank[b.state]) || (b.lastSeen - a.lastSeen));

  const onlineCount = rows.filter(r => r.state === "online").length;
  if (summary) {
    summary.textContent = `${onlineCount} of ${rows.length} online`;
    summary.className = "status-summary " + (onlineCount === rows.length ? "all-ok" : "has-problem");
  }

  body.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "status-grid";

  rows.forEach(r => {
    const card = document.createElement("div");
    card.className = "status-card " + r.state;

    const dot = `<span class="status-dot ${r.state}"></span>`;
    const seen = r.lastSeen ? relativeTime(r.age) : "never reported";

    let meta = "";
    if (r.hb) {
      const bits = [];
      if (r.hb.version) bits.push("v" + r.hb.version);
      if (r.hb.slides != null) bits.push(r.hb.slides + " slide" + (r.hb.slides === 1 ? "" : "s"));
      if (bits.length) meta = `<div class="status-meta">${bits.join(" · ")}</div>`;
    }

    const abs = r.lastSeen
      ? new Date(r.lastSeen).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "";

    card.innerHTML =
      `<div class="status-card-head">${dot}<span class="status-name">${r.loc.label}</span>
         <span class="status-id">${r.loc.id}</span></div>
       <div class="status-seen" title="${abs}">${seen}</div>
       ${meta}`;
    grid.appendChild(card);
  });

  body.appendChild(grid);

  const foot = document.createElement("div");
  foot.className = "status-foot";
  foot.textContent = "Updated " + new Date(now).toLocaleTimeString(undefined, { timeStyle: "short" }) +
                     " · displays report every ~" + (appConfig.refreshInterval || 15) + " min";
  body.appendChild(foot);
}
