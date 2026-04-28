let selected = null;
let dragIndex;

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

/* CREATE MEDIA ELEMENT (img or video) */
function createMedia(name, { muted = true, controls = false } = {}) {
  const url = mediaUrl(name);
  if (isVideo(name)) {
    const video = document.createElement("video");
    video.src = url;
    video.muted = muted;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    if (controls) video.controls = true;
    return video;
  }
  const img = document.createElement("img");
  img.src = url;
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

  // leading insert button
  thumbList.appendChild(createInsertBtn(0));

  files.forEach((name, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    if (name === selected) div.classList.add("active");
    const enabledNow = !!config[name];
    if (!enabledNow) div.classList.add("disabled");

    const media = createMedia(name);
    div.appendChild(media);

    // disabled-state center icon (crossed eye)
    const overlay = document.createElement("div");
    overlay.className = "thumb-disabled-overlay";
    overlay.innerHTML = ICON_EYE_OFF;
    div.appendChild(overlay);

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

    div.onclick = () => selectSlide(name);

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

/* INSERT POSITION for uploads triggered by + button */
let insertAtIndex = -1;

/* CREATE INSERT BUTTON (+ icon between thumbnails) */
function createInsertBtn(index) {
  const btn = document.createElement("div");
  btn.className = "thumb-insert";
  const b = document.createElement("button");
  b.title = "Upload new slide here";
  b.textContent = "+";
  b.onclick = () => {
    insertAtIndex = index;
    fileInput.click();
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
      start: "",
      end: "",
      startDate: "",
      endDate: "",
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

/* SELECT SLIDE */
function selectSlide(name) {
  selected = name;
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
  startTime.value = c.start || "";
  endTime.value = c.end || "";
  startDate.value = c.startDate || "";
  endDate.value = c.endDate || "";
  expiry.value = c.expiry || "";

  // populate location checkboxes
  const activeTowers = (c.towers || "").split(",").filter(Boolean);
  document.querySelectorAll("#locationPicker input").forEach(cb => {
    cb.checked = activeTowers.includes(cb.value);
  });
}

/* NAVIGATE SLIDES (prev/next) */
function navSlide(dir) {
  if (!files.length) return;
  const idx = selected ? files.indexOf(selected) : -1;
  const next = (idx + dir + files.length) % files.length;
  selectSlide(files[next]);
}

/* UPDATE CONFIG ON INPUT */
document.querySelectorAll(".right input").forEach(el => {
  el.oninput = () => {
    if (!selected) return;

    if (!config[selected]) {
      config[selected] = {};
    }

    config[selected] = {
      duration: duration.value,
      start: startTime.value,
      end: endTime.value,
      startDate: startDate.value,
      endDate: endDate.value,
      expiry: expiry.value,
      towers: [...document.querySelectorAll("#locationPicker input:checked")].map(cb => cb.value).join(",")
    };
  };
});

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
