let selected = null;
let multiSelected = new Set();
let dragIndex;
let thumbFilterValue = "all";

/* Local blob URLs for just-uploaded files (used until GitHub Pages catches up) */
const localBlobs = {};        // { fileName: blobUrl }
/* Cache-buster per file (bumped on refresh) */
const cacheBust  = {};        // { fileName: number }

/* DEFAULT TOWERS — all locations except gate */
function defaultTowers() {
  return LOCATIONS.filter(l => l.id !== "gate").map(l => l.id).join(",");
}

/* BUILD LOCATION PICKER (checkbox pills) */
function buildLocationPicker() {
  const picker = document.getElementById("locationPicker");
  picker.innerHTML = "";

  // Select All pill
  const selAll = document.createElement("button");
  selAll.className = "loc-pill loc-action";
  selAll.textContent = "Select All";
  selAll.type = "button";
  selAll.onclick = () => setAllLocations(true);
  picker.appendChild(selAll);

  // Clear All pill
  const clrAll = document.createElement("button");
  clrAll.className = "loc-pill loc-action";
  clrAll.textContent = "Clear All";
  clrAll.type = "button";
  clrAll.onclick = () => setAllLocations(false);
  picker.appendChild(clrAll);

  LOCATIONS.forEach(loc => {
    const label = document.createElement("label");
    label.className = "loc-pill";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = loc.id;
    cb.dataset.loc = loc.id;
    cb.onchange = onLocationChange;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(loc.label));
    picker.appendChild(label);
  });
}

/* BUILD THUMB FILTER OPTIONS */
function buildThumbFilterOptions() {
  const sel = document.getElementById("thumbFilter");
  if (!sel) return;

  // Preserve first two static options (All + Disabled)
  const staticOptions = [
    `<option value="all">All</option>`,
    `<option value="__disabled">Disabled</option>`,
    `<option value="__expired">Expired</option>`
  ];

  const locOptions = LOCATIONS.map(loc => `<option value="${loc.id}">${loc.label}</option>`);
  sel.innerHTML = staticOptions.concat(locOptions).join("");
  sel.value = thumbFilterValue;
  sel.onchange = () => {
    thumbFilterValue = sel.value;
    render();
  };
}

/* INIT TOPBAR SETTINGS FROM appConfig */
function applyTopbarSettingsFromConfig() {
  const transitionSel = document.getElementById("transitionEffect");
  if (transitionSel) {
    transitionSel.value = appConfig.transitionEffect || "fade";
    transitionSel.onchange = () => {
      appConfig.transitionEffect = transitionSel.value;
    };
  }

  const refreshInput = document.getElementById("refreshInterval");
  if (refreshInput) {
    refreshInput.value = appConfig.refreshInterval || 15;
    refreshInput.onchange = () => {
      const v = parseInt(refreshInput.value, 10);
      appConfig.refreshInterval = v > 0 ? v : 15;
      refreshInput.value = appConfig.refreshInterval;
    };
  }

  initTickerConfig();
}

/* RIGHT PANEL TABS */
function switchRightTab(tabId) {
  document.querySelectorAll(".right-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".right-tab-content").forEach(panel => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}

function initTickerConfig() {
  // Common text
  const commonInput = document.getElementById("tickerCommonText");
  if (commonInput) {
    commonInput.value = appConfig.ticker?.commonText || "";
    commonInput.oninput = () => {
      if (!appConfig.ticker) appConfig.ticker = { commonText: "", towerTexts: {} };
      appConfig.ticker.commonText = commonInput.value;
    };
  }

  const container = document.getElementById("tickerTowerTexts");
  if (!container) return;
  container.innerHTML = "";

  const towerTexts = appConfig.ticker?.towerTexts || {};
  const towerExpiries = appConfig.ticker?.towerExpiries || {};
  const towerAttentionTexts = appConfig.ticker?.towerAttentionTexts || {};
  LOCATIONS.forEach(loc => {
    // If this entry's timer has already lapsed, show it as empty (cleanup is
    // persisted in config.load(); this guards a not-yet-saved session too).
    const isExpired = towerExpiries[loc.id] != null && towerExpiries[loc.id] <= Date.now();

    const card = document.createElement("details");
    card.className = "ticker-tower-card";

    const summary = document.createElement("summary");
    summary.className = "ticker-tower-summary";
    summary.textContent = `${loc.short} - ${loc.label}`;
    card.appendChild(summary);

    const body = document.createElement("div");
    body.className = "ticker-tower-body";

    const textField = document.createElement("div");
    textField.className = "ticker-tower-field";
    const textLabel = document.createElement("label");
    textLabel.textContent = "Text";
    const textInput = document.createElement("textarea");
    textInput.rows = 2;
    textInput.placeholder = `Scrolling text for ${loc.label} (use | for line breaks)`;
    textInput.value = isExpired ? "" : (towerTexts[loc.id] || "");

    textInput.oninput = () => {
      if (!appConfig.ticker) appConfig.ticker = { commonText: "", towerTexts: {} };
      if (!appConfig.ticker.towerTexts) appConfig.ticker.towerTexts = {};
      appConfig.ticker.towerTexts[loc.id] = textInput.value;
    };
    textField.appendChild(textLabel);
    textField.appendChild(textInput);

    const attentionField = document.createElement("div");
    attentionField.className = "ticker-tower-field";
    const attentionLabel = document.createElement("label");
    attentionLabel.textContent = "Attention";
    const attentionInput = document.createElement("input");
    attentionInput.type = "text";
    attentionInput.placeholder = `Attention tag for ${loc.short}`;
    attentionInput.value = isExpired ? "" : (towerAttentionTexts[loc.id] || "");

    attentionInput.oninput = () => {
      if (!appConfig.ticker) appConfig.ticker = { commonText: "", towerTexts: {} };
      if (!appConfig.ticker.towerAttentionTexts) appConfig.ticker.towerAttentionTexts = {};
      if (attentionInput.value.trim()) {
        appConfig.ticker.towerAttentionTexts[loc.id] = attentionInput.value;
      } else {
        delete appConfig.ticker.towerAttentionTexts[loc.id];
      }
    };
    attentionField.appendChild(attentionLabel);
    attentionField.appendChild(attentionInput);

    const expiryField = document.createElement("div");
    expiryField.className = "ticker-tower-field";
    const expiryLabel = document.createElement("label");
    expiryLabel.textContent = "Expiry (hrs)";
    const expiryInput = document.createElement("input");
    expiryInput.type = "text";
    expiryInput.className = "ticker-expiry";
    expiryInput.placeholder = "hrs";
    expiryInput.title = "Expiry in hours (leave empty = no expiry)";
    const existing = towerExpiries[loc.id];
    if (existing && existing > Date.now()) {
      const hrsLeft = Math.round((existing - Date.now()) / 3600000 * 10) / 10;
      expiryInput.value = "";
      expiryInput.placeholder = hrsLeft + "h";
    }
    expiryInput.oninput = () => {
      if (!appConfig.ticker) appConfig.ticker = { commonText: "", towerTexts: {} };
      if (!appConfig.ticker.towerExpiries) appConfig.ticker.towerExpiries = {};
      const h = parseFloat(expiryInput.value);
      if (h > 0) {
        appConfig.ticker.towerExpiries[loc.id] = Date.now() + h * 3600000;
      } else {
        delete appConfig.ticker.towerExpiries[loc.id];
      }
    };
    expiryInput.onchange = () => {
      const h = parseFloat(expiryInput.value);
      if (h > 0) {
        expiryInput.value = "";
        expiryInput.placeholder = h + "h";
      } else {
        expiryInput.placeholder = "hrs";
      }
    };

    expiryField.appendChild(expiryLabel);
    expiryField.appendChild(expiryInput);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "tower-clear-btn";
    clearBtn.textContent = "Clear";
    clearBtn.title = "Clear all ticker data for this tower";
    clearBtn.onclick = async () => {
      if (!appConfig.ticker) return;
      if (appConfig.ticker.towerTexts) delete appConfig.ticker.towerTexts[loc.id];
      if (appConfig.ticker.towerAttentionTexts) delete appConfig.ticker.towerAttentionTexts[loc.id];
      if (appConfig.ticker.towerExpiries) delete appConfig.ticker.towerExpiries[loc.id];
      textInput.value = "";
      attentionInput.value = "";
      expiryInput.value = "";
      expiryInput.placeholder = "hrs";
      await saveConfig({ silent: true });
    };

    body.appendChild(textField);
    body.appendChild(attentionField);
    body.appendChild(expiryField);
    body.appendChild(clearBtn);
    card.appendChild(body);
    container.appendChild(card);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function matchesThumbFilter(name) {
  if (thumbFilterValue === "all") return true;
  if (thumbFilterValue === "__disabled") return !config[name];
  if (thumbFilterValue === "__expired") return slideStatus(name) === "expired";

  const towers = config[name]?.towers || "";
  if (!towers) return false;
  return towers.split(",").includes(thumbFilterValue);
}

/* SLIDE VISIBILITY STATUS — mirrors viewer.js isVisible (tower-agnostic), so the
   admin thumbnail reflects what actually shows on the displays.
   Returns: 'unconfigured' | 'expired' | 'scheduled' | 'live'. */
function parseExpiryToMs(exp) {
  const n = parseInt(exp, 10);
  if (isNaN(n)) return 0;
  if (/h/i.test(exp)) return n * 3600000;
  if (/d/i.test(exp)) return n * 86400000;
  if (/m/i.test(exp)) return n * 60000;
  return n * 1000;
}

function slideStatus(name) {
  const c = config[name];
  if (!c) return "unconfigured";
  const now = new Date();

  // Date ranges: expired if all ranges are in the past; scheduled if only future.
  if (Array.isArray(c.dates) && c.dates.length) {
    let current = false, future = false;
    c.dates.forEach(d => {
      if (!d.startDate) { current = true; return; }
      const sd = new Date(d.startDate);
      let ed = null;
      if (d.endDate) { ed = new Date(d.endDate); ed.setHours(23, 59, 59, 999); }
      if (now < sd) future = true;
      else if (ed && now > ed) { /* this range is past */ }
      else current = true;
    });
    if (!current && !future) return "expired";
    if (!current && future) return "scheduled";
  }

  // Expiry duration relative to the first start date.
  if (c.expiry) {
    const ms = parseExpiryToMs(c.expiry);
    if (ms > 0 && Array.isArray(c.dates) && c.dates[0] && c.dates[0].startDate) {
      const start = new Date(c.dates[0].startDate);
      if (now.getTime() - start.getTime() > ms) return "expired";
    }
  }

  // Time-of-day windows: outside all of them → not showing right now.
  if (Array.isArray(c.times) && c.times.length) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const inAny = c.times.some(t => {
      if (!t.start || !t.end) return true;
      const [sh, sm] = t.start.split(":").map(Number);
      const [eh, em] = t.end.split(":").map(Number);
      return cur >= sh * 60 + sm && cur <= eh * 60 + em;
    });
    if (!inAny) return "scheduled";
  }

  return "live";
}

/* SELECT / CLEAR ALL LOCATIONS */
function setAllLocations(checked) {
  document.querySelectorAll("#locationPicker input[type=checkbox]").forEach(cb => cb.checked = checked);
  onLocationChange();
}

/* WHEN LOCATION CHECKBOXES CHANGE */
function onLocationChange() {
  if (!selected || !config[selected]) return;
  const checked = [...document.querySelectorAll("#locationPicker input:checked")].map(cb => cb.value);
  config[selected].towers = checked.join(",");
  render();
}

/* DETECT VIDEO FILE */
function isVideo(name) {
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(name);
}

/* BUILD MEDIA URL (uses local blob if we just uploaded it) */
function mediaUrl(name) {
  if (localBlobs[name]) return localBlobs[name];
  const bust = cacheBust[name];
  const base = `https://${repoOwner}.github.io/${repoName}/slides/${encodeURIComponent(name)}`;
  return bust ? `${base}?t=${bust}` : base;
}

function fallbackMediaUrl(name) {
  const bust = cacheBust[name] || Date.now();
  return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/slides/${encodeURIComponent(name)}?t=${bust}`;
}

/* CREATE MEDIA ELEMENT (img or video) */
function createMedia(name, { muted = true, controls = false } = {}) {
  const url = mediaUrl(name);
  const fallback = fallbackMediaUrl(name);
  if (isVideo(name)) {
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = muted;
    video.defaultMuted = !!muted;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    if (muted) video.setAttribute("muted", "");

    const applyFallback = () => {
      if (video.dataset.fallbackApplied) return;
      video.dataset.fallbackApplied = "1";
      video.src = fallback;
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
    source.src = url;
    source.type = "video/mp4";
    source.onerror = applyFallback;
    video.appendChild(source);

    if (controls) video.controls = true;
    return video;
  }
  const img = document.createElement("img");
  img.src = url;
  img.onerror = () => {
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = "1";
    img.src = fallback;
  };
  return img;
}

/* SVG ICONS */
const ICON_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-10-7-10-7a19.77 19.77 0 0 1 4.22-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 7 10 7a19.86 19.86 0 0 1-3.17 4.19"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

/* RENDER THUMBNAIL LIST */
function render() {
  thumbList.innerHTML = "";

  const visibleFiles = files.filter(matchesThumbFilter);

  // leading insert button
  thumbList.appendChild(createInsertBtn(0));

  visibleFiles.forEach((name, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    if (name === selected) div.classList.add("active");
    if (multiSelected.has(name)) div.classList.add("multi-selected");
    const enabledNow = !!config[name];
    const status = slideStatus(name);
    // Dim + hide anything not visible on the displays right now:
    // unconfigured (no config), expired (past its dates/expiry), or scheduled (future/off-hours).
    if (status !== "live") div.classList.add("disabled");
    if (status === "expired") div.classList.add("expired");
    if (status === "scheduled") div.classList.add("scheduled");

    const media = createMedia(name);
    div.appendChild(media);

    // disabled-state center icon (crossed eye)
    const overlay = document.createElement("div");
    overlay.className = "thumb-disabled-overlay";
    overlay.innerHTML = ICON_EYE_OFF;
    div.appendChild(overlay);

    // status badge for configured-but-not-live slides
    if (status === "expired" || status === "scheduled") {
      const badge = document.createElement("div");
      badge.className = "thumb-badge " + status;
      badge.textContent = status === "expired" ? "EXPIRED" : "SCHEDULED";
      div.appendChild(badge);
    }

    // offline backup marker
    if (appConfig.offlineBackup === name) {
      const badge = document.createElement("div");
      badge.className = "thumb-badge offline-backup";
      badge.textContent = "OFFLINE";
      badge.title = "Shown on displays when there is no internet at startup";
      div.appendChild(badge);
    }

    // action icons (top of thumbnail)
    const actions = document.createElement("div");
    actions.className = "thumb-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.title = enabledNow ? "Disable (remove from config)" : "Enable";
    toggleBtn.innerHTML = enabledNow ? ICON_EYE : ICON_EYE_OFF;
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      toggleEnable(name);
    };

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.title = "Delete file from repo";
    delBtn.innerHTML = ICON_TRASH;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteSlide(name);
    };

    actions.appendChild(toggleBtn);
    actions.appendChild(delBtn);
    div.appendChild(actions);

    // Refresh icon (bottom-left)
    const refreshBar = document.createElement("div");
    refreshBar.className = "thumb-refresh";
    const refreshBtn = document.createElement("button");
    refreshBtn.title = "Reload from repo";
    refreshBtn.innerHTML = ICON_REFRESH;
    refreshBtn.onclick = (e) => {
      e.stopPropagation();
      refreshThumb(name);
    };
    refreshBar.appendChild(refreshBtn);
    div.appendChild(refreshBar);

    // location tags
    const towers = config[name]?.towers;
    if (towers) {
      const tagBar = document.createElement("div");
      tagBar.className = "thumb-locations";
      towers.split(",").forEach(tid => {
        const loc = LOCATIONS.find(l => l.id === tid);
        if (loc) {
          const tag = document.createElement("span");
          tag.className = "loc-tag";
          tag.textContent = loc.short;
          tagBar.appendChild(tag);
        }
      });
      div.appendChild(tagBar);
    }

    div.onclick = (e) => {
      if (e.shiftKey && selected) {
        if (multiSelected.has(name)) {
          multiSelected.delete(name);
        } else {
          multiSelected.add(name);
        }
        updateMultiSelectBar();
        render();
      } else {
        multiSelected.clear();
        selectSlide(name);
      }
    };

    // drag
    div.draggable = true;
    div.ondragstart = () => dragIndex = i;
    div.ondrop = () => reorder(i);
    div.ondragover = e => e.preventDefault();

    thumbList.appendChild(div);

    // insert button after each thumbnail
    thumbList.appendChild(createInsertBtn(i + 1));
  });
}

/* PREVIEW SLIDE — open viewer in new tab */
function previewSlide() {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const url = local ? 'index.html' : `https://${repoOwner}.github.io/${repoName}/index.html`;
  window.open(url, '_blank');
}

/* INSERT POSITION for uploads triggered by + button */
let insertAtIndex = -1;

/* CREATE INSERT BUTTON (+ icon between thumbnails) */
function createInsertBtn(index) {
  const btn = document.createElement("div");
  btn.className = "thumb-insert";
  const b = document.createElement("button");
  b.title = "Upload new slide(s) here";
  b.textContent = "+";
  b.onclick = () => {
    insertAtIndex = index;
    bulkFileInput.click();
  };
  btn.appendChild(b);
  return btn;
}

/* TOGGLE ENABLED — disabling removes from config.json; file stays in slides/ */
async function toggleEnable(name) {
  if (config[name]) {
    delete config[name];
  } else {
    config[name] = {
      duration: "",
      times: [],
      dates: [],
      expiry: "",
      towers: defaultTowers()
    };
  }

  // keep right pane in sync if this slide is selected
  if (selected === name) {
    selectSlide(name);
  }

  render();

  try {
    await saveConfig({ silent: true });
  } catch (e) {
    alert("Failed to update config.json: " + e.message);
  }
}

/* REFRESH THUMBNAIL — drop local blob, bust cache, force reload from repo */
function refreshThumb(name) {
  if (localBlobs[name]) {
    try { URL.revokeObjectURL(localBlobs[name]); } catch (_) {}
    delete localBlobs[name];
  }
  cacheBust[name] = Date.now();
  render();
  if (selected === name) {
    // also refresh main preview
    screenEl.innerHTML = "";
    screenEl.appendChild(createMedia(name, { controls: true }));
  }
}

/* REORDER SLIDES */
function reorder(i) {
  const item = files.splice(dragIndex, 1)[0];
  files.splice(i, 0, item);
  render();
}

/* TIME SLOT BUILDER */
function buildTimeSlotsUI(name) {
  const container = document.getElementById("timeSlotsContainer");
  if (!container) return;
  container.innerHTML = "";
  const c = config[name];
  if (!c) return;
  if (!c.times) c.times = [];
  c.times.forEach((slot, i) => {
    container.appendChild(makeSlotRow(
      [
        { type: "time", val: slot.start, placeholder: "Start", onchange: v => { c.times[i].start = v; } },
        { type: "label", text: "to" },
        { type: "time", val: slot.end, placeholder: "End", onchange: v => { c.times[i].end = v; } }
      ],
      () => { c.times.splice(i, 1); buildTimeSlotsUI(name); }
    ));
  });
}

function addTimeSlot() {
  if (!selected || !config[selected]) return;
  if (!config[selected].times) config[selected].times = [];
  config[selected].times.push({ start: "", end: "" });
  buildTimeSlotsUI(selected);
}

/* DATE RANGE BUILDER */
function buildDateRangesUI(name) {
  const container = document.getElementById("dateRangesContainer");
  if (!container) return;
  container.innerHTML = "";
  const c = config[name];
  if (!c) return;
  if (!c.dates) c.dates = [];
  c.dates.forEach((range, i) => {
    container.appendChild(makeSlotRow(
      [
        { type: "date", val: range.startDate, placeholder: "Start date", onchange: v => { c.dates[i].startDate = v; } },
        { type: "label", text: "–" },
        { type: "date", val: range.endDate, placeholder: "End date", onchange: v => { c.dates[i].endDate = v; } }
      ],
      () => { c.dates.splice(i, 1); buildDateRangesUI(name); }
    ));
  });
}

function addDateRange() {
  if (!selected || !config[selected]) return;
  if (!config[selected].dates) config[selected].dates = [];
  config[selected].dates.push({ startDate: "", endDate: "" });
  buildDateRangesUI(selected);
}

/* BUILD A SLOT ROW from a field spec array */
function makeSlotRow(fields, onRemove) {
  const row = document.createElement("div");
  row.className = "slot-row";
  fields.forEach(f => {
    if (f.type === "label") {
      const span = document.createElement("span");
      span.className = "slot-sep";
      span.textContent = f.text;
      row.appendChild(span);
    } else {
      const inp = document.createElement("input");
      inp.type = f.type;
      inp.value = f.val || "";
      inp.className = "slot-input";
      inp.onchange = () => f.onchange(inp.value);
      row.appendChild(inp);
    }
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "slot-remove";
  del.textContent = "×";
  del.title = "Remove";
  del.onclick = onRemove;
  row.appendChild(del);
  return row;
}

/* UPDATE MULTI-SELECT BAR */
function updateMultiSelectBar() {
  const bar = document.getElementById("multiSelectBar");
  if (!bar) return;
  if (multiSelected.size >= 2) {
    bar.style.display = "";
    bar.querySelector(".multi-count").textContent = `${multiSelected.size} slides selected`;
  } else {
    bar.style.display = "none";
  }
}

/* APPLY SETTINGS TO ALL MULTI-SELECTED SLIDES */
function applyToMultiSelected() {
  if (multiSelected.size < 2) return;
  const towers = [...document.querySelectorAll("#locationPicker input:checked")].map(cb => cb.value).join(",");
  multiSelected.forEach(name => {
    if (!config[name]) config[name] = { duration: "", times: [], dates: [], expiry: "", towers: "" };
    if (duration.value !== "") config[name].duration = duration.value;
    config[name].towers = towers;
  });
  render();
}

/* SELECT SLIDE */
function selectSlide(name) {
  selected = name;
  updateMultiSelectBar();
  render();

  screenEl.innerHTML = "";
  const media = createMedia(name, { controls: true });
  screenEl.appendChild(media);

  const c = config[name] || {};
  titleEl.innerText = name;

  // update slide counter
  const idx = files.indexOf(name);
  const counter = document.getElementById("slideCounter");
  if (counter) counter.textContent = `${idx + 1} / ${files.length}`;

  duration.value = c.duration || "";
  expiry.value = c.expiry || "";

  buildTimeSlotsUI(name);
  buildDateRangesUI(name);

  // populate location checkboxes
  const activeTowers = (c.towers || "").split(",").filter(Boolean);
  document.querySelectorAll("#locationPicker input").forEach(cb => {
    cb.checked = activeTowers.includes(cb.value);
  });

  // offline backup checkbox (only one slide can be the backup)
  const backupCb = document.getElementById("offlineBackup");
  if (backupCb) {
    backupCb.checked = appConfig.offlineBackup === name;
    backupCb.onchange = () => {
      if (backupCb.checked) appConfig.offlineBackup = name;
      else if (appConfig.offlineBackup === name) appConfig.offlineBackup = "";
      render();
    };
  }
}

/* Force every display to clear its offline cache (shell + backup slide) and
   re-download on its next successful connection. Bumps offlineCacheVersion. */
async function clearOfflineCacheOnDisplays() {
  if (!confirm("Force all displays to clear their offline cache and re-download on the next connection?")) return;
  appConfig.offlineCacheVersion = String(Date.now());
  try {
    await saveConfig({ silent: true });
    alert("Done. Each display will clear its offline cache the next time it connects.");
  } catch (e) {
    alert("Failed to update config.json: " + e.message);
  }
}

/* NAVIGATE SLIDES (prev/next) */
function navSlide(dir) {
  if (!files.length) return;
  const idx = selected ? files.indexOf(selected) : -1;
  const next = (idx + dir + files.length) % files.length;
  selectSlide(files[next]);
}

/* UPDATE CONFIG ON INPUT (static fields) */
duration.oninput = () => {
  if (!selected || !config[selected]) return;
  config[selected].duration = duration.value;
};
expiry.oninput = () => {
  if (!selected || !config[selected]) return;
  config[selected].expiry = expiry.value;
};

/* DELETE SLIDE */
async function deleteSlide(targetName) {
  const name = targetName || selected;
  if (!name) return;

  if (!confirm(`Delete "${name}"?\n\nThis will remove the file from the repo and update config.json.`)) {
    return;
  }

  try {
    // Try to fetch the file's sha. If it doesn't exist in the repo (404),
    // treat it as already deleted and just clean up local state.
    let fileSha = null;
    try {
      const file = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides/${name}`);
      fileSha = file.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    if (fileSha) {
      try {
        await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides/${name}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "delete", sha: fileSha })
        });
      } catch (e) {
        // 404 here means file vanished between GET and DELETE — fine, proceed.
        if (e.status !== 404) throw e;
      }
    }

    // Update local state
    delete config[name];
    files = files.filter(f => f !== name);
    if (selected === name) {
      selected = null;
      screenEl.innerHTML = "";
    }
    render();

    // Persist config.json so the deleted slide isn't resurrected on next load
    await saveConfig({ silent: true });

  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}

/* ============================================================
   SCHEDULED TICKER EDITOR (ticker.txt)
   Edits the repo's ticker.txt line by line and commits it.
   Line format:  location | start | expiry | attention | message
   ============================================================ */
const TICKER_FILE = "ticker.txt";
let tickerFileSha = null;          // sha of ticker.txt for the next commit
let tickerScheduleHeader = [];     // preserved comment/instruction lines

const DEFAULT_TICKER_HEADER = [
  "# ESTANCIA NOTICEBOARD — SCHEDULED TICKER",
  "# location | start | expiry | attention | message",
  "#   location : t1c1..t5c2, club, gate, or 'all' (comma-separate several)",
  "#   start/expiry : YYYY-MM-DD HH:MM (blank start = now, blank expiry = never)",
  "#   message : use | for line breaks. # lines and blanks are ignored.",
  "# Edited via the Admin panel → Ticker Settings → Schedule."
];

function tsEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// "YYYY-MM-DD HH:MM" -> "YYYY-MM-DDTHH:MM" (for <input type=datetime-local>)
function tsToInput(s) {
  if (!s) return "";
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return "";
  const [, y, mo, d, hh, mm] = m;
  const pad = n => String(n || 0).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
}
// "YYYY-MM-DDTHH:MM" -> "YYYY-MM-DD HH:MM"
function tsFromInput(v) {
  return v ? v.replace("T", " ").slice(0, 16) : "";
}

// "YYYY-MM-DD HH:MM" -> Date (or null)
function tsParseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return new Date(+y, +mo - 1, +d, +(hh || 0), +(mm || 0), 0, 0);
}
// Date -> "YYYY-MM-DD HH:MM"
function tsDateToStr(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Stored absolute expiry -> duration in hours (relative to start, else now), for display
function tsExpiryToHours(startStr, expiryStr) {
  const exp = tsParseDate(expiryStr);
  if (!exp) return "";
  const base = tsParseDate(startStr) || new Date();
  const h = (exp.getTime() - base.getTime()) / 3600000;
  return h > 0 ? String(Math.round(h * 10) / 10) : "";
}
// Hours entered in the editor -> stored absolute expiry datetime (relative to start, else now)
function tsHoursToExpiry(startStr, hoursStr) {
  const h = parseFloat(hoursStr);
  if (!(h > 0)) return "";
  const base = tsParseDate(startStr) || new Date();
  return tsDateToStr(new Date(base.getTime() + h * 3600000));
}

function parseScheduleText(txt) {
  const header = [], rows = [];
  (txt || "").split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (t.startsWith("#")) { header.push(line); return; }
    if (!t) return;
    const parts = line.split("|");
    const location = (parts[0] || "").trim();
    if (!location) return;
    rows.push({
      location,
      start: (parts[1] || "").trim(),
      expiry: (parts[2] || "").trim(),
      attention: (parts[3] || "").trim(),
      message: parts.slice(4).join("|").trim()
    });
  });
  return { header, rows };
}

function serializeSchedule(rows) {
  const lines = tickerScheduleHeader.slice();
  if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
  rows.forEach(r => {
    if (!r.location || !r.message) return;
    lines.push(`${r.location} | ${r.start} | ${r.expiry} | ${r.attention} | ${r.message}`);
  });
  return lines.join("\n") + "\n";
}

function buildScheduleRow(r) {
  const row = document.createElement("div");
  row.className = "ticker-sched-row";
  row.innerHTML =
    `<input class="ts-location" type="text" placeholder="t3c1 / t4c1,t4c2 / all" value="${tsEsc(r.location)}">` +
    `<input class="ts-start" type="datetime-local" value="${tsToInput(r.start)}">` +
    `<input class="ts-expiry" type="number" min="0" step="0.5" placeholder="hrs" value="${tsEsc(tsExpiryToHours(r.start, r.expiry))}">` +
    `<input class="ts-attention" type="text" placeholder="badge" value="${tsEsc(r.attention)}">` +
    `<input class="ts-message" type="text" placeholder="message (| = line break)" value="${tsEsc(r.message)}">` +
    `<button type="button" class="ts-del" title="Delete line" onclick="this.closest('.ticker-sched-row').remove()">&times;</button>`;
  return row;
}

function renderScheduleRows(rows) {
  const c = document.getElementById("tickerScheduleRows");
  c.innerHTML = "";
  rows.forEach(r => c.appendChild(buildScheduleRow(r)));
}

function collectScheduleRows() {
  return Array.from(document.querySelectorAll("#tickerScheduleRows .ticker-sched-row")).map(row => {
    const start = tsFromInput(row.querySelector(".ts-start").value);
    return {
      location: row.querySelector(".ts-location").value.trim(),
      start,
      expiry: tsHoursToExpiry(start, row.querySelector(".ts-expiry").value),
      attention: row.querySelector(".ts-attention").value.trim(),
      message: row.querySelector(".ts-message").value.trim()
    };
  }).filter(r => r.location && r.message);
}

function addTickerScheduleRow() {
  document.getElementById("tickerScheduleRows")
    .appendChild(buildScheduleRow({ location: "", start: "", expiry: "", attention: "", message: "" }));
}

function closeTickerSchedule() {
  document.getElementById("tickerScheduleModal").style.display = "none";
}

async function openTickerSchedule() {
  const modal = document.getElementById("tickerScheduleModal");
  const rowsEl = document.getElementById("tickerScheduleRows");
  rowsEl.innerHTML = "<p style='opacity:.6;padding:8px'>Loading…</p>";
  modal.style.display = "flex";
  try {
    const meta = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${TICKER_FILE}`);
    tickerFileSha = meta.sha;
    const text = decodeURIComponent(escape(atob(meta.content)));
    const { header, rows } = parseScheduleText(text);
    tickerScheduleHeader = header.length ? header : DEFAULT_TICKER_HEADER.slice();
    renderScheduleRows(rows);
  } catch (e) {
    if (e.status === 404) {            // file doesn't exist yet — start fresh
      tickerFileSha = null;
      tickerScheduleHeader = DEFAULT_TICKER_HEADER.slice();
      renderScheduleRows([]);
    } else {
      rowsEl.innerHTML = `<p style='color:#f87171;padding:8px'>Failed to load ${TICKER_FILE}: ${tsEsc(e.message)}</p>`;
    }
  }
}

async function saveTickerSchedule() {
  const btn = document.getElementById("tickerScheduleSaveBtn");
  const text = serializeSchedule(collectScheduleRows());
  const prev = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const body = {
      message: "update ticker.txt",
      content: btoa(unescape(encodeURIComponent(text)))
    };
    if (tickerFileSha) body.sha = tickerFileSha;
    const res = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${TICKER_FILE}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    tickerFileSha = res?.content?.sha || tickerFileSha;
    closeTickerSchedule();
    alert("Scheduled messages saved.");
  } catch (e) {
    alert("Failed to save ticker.txt: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = prev;
  }
}
