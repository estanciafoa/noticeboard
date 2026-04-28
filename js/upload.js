let newFiles = [];
let uploadSource = "single";
let collageNameTouched = false;

const COLLAGE_TITLES = {
  g: "Gardening @ Estancia",
  p: "Pest Control @ Estancia",
  h: "Housekeeping @ Estancia",
  m: "Maintenance @ Estancia",
  x: ""
};

function getCollageTypeEl() {
  return document.getElementById("collageType");
}

function getCollageTitleEl() {
  return document.getElementById("collageTitle");
}

function getCollageFileNameEl() {
  return document.getElementById("collageFileName");
}

/* FILE PICKER → SHOW MODAL WITH PREVIEW */
function handlePickedFiles(fileList, { source = "single" } = {}) {
  uploadSource = source;
  newFiles = [...fileList];
  if (!newFiles.length) return;

  uploadPreview.innerHTML = "";
  collageNameTouched = false;
  resetCollageStatus();

  newFiles.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "previewCard";

    const isVid = (f.type && f.type.startsWith("video/")) || isVideo(f.name);
    const media = document.createElement(isVid ? "video" : "img");
    media.src = URL.createObjectURL(f);
    if (isVid) {
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.autoplay = true;
    }

    const input = document.createElement("input");
    input.value = f.name;
    f.customName = f.name;
    input.oninput = () => {
      f.customName = input.value;
    };

    const status = document.createElement("div");
    status.className = "status";
    status.id = "status_" + i;

    div.appendChild(media);
    div.appendChild(input);
    div.appendChild(status);
    uploadPreview.appendChild(div);
  });

  // Reset the file input so picking the same file again retriggers onchange
  fileInput.value = "";
  if (typeof bulkFileInput !== "undefined") bulkFileInput.value = "";

  setDefaultCollageFields();
  openUploadModal();
}

fileInput.onchange = e => {
  handlePickedFiles(e.target.files, { source: "single" });
};

bulkFileInput.onchange = e => {
  handlePickedFiles(e.target.files, { source: "bulk" });
};

document.querySelectorAll('input[name="uploadMode"]').forEach(radio => {
  radio.onchange = syncUploadModalState;
});

getCollageTypeEl().onchange = () => {
  toggleCollageTitleRow();
  setDefaultCollageFields();
  scheduleCollagePreview();
};

getCollageTitleEl().oninput = () => {
  setDefaultCollageFields();
  scheduleCollagePreview();
};

getCollageFileNameEl().oninput = () => {
  collageNameTouched = true;
};

/* MODAL CONTROLS */
function openUploadModal() {
  document.getElementById("uploadModal").style.display = "flex";
  document.getElementById("uploadConfirmBtn").disabled = false;
  syncUploadModalState();
}

function closeUploadModal() {
  document.getElementById("uploadModal").style.display = "none";
  uploadPreview.innerHTML = "";
  newFiles = [];
  uploadSource = "single";
  resetCollageStatus();
}

function cancelUpload() {
  closeUploadModal();
}

function isCollageMode() {
  const selectedMode = document.querySelector('input[name="uploadMode"]:checked')?.value || "individual";
  return uploadSource === "bulk" && selectedMode === "collage";
}

function syncUploadModalState() {
  const options = document.getElementById("uploadOptions");
  const collagePanes = document.getElementById("collagePanes");
  const showBulkOptions = uploadSource === "bulk";
  const collageMode = isCollageMode();

  options.style.display = showBulkOptions ? "block" : "none";
  collagePanes.style.display = collageMode ? "flex" : "none";
  toggleCollageTitleRow();
  resetCollageStatus();

  // In collage mode, relabel the bottom Upload button
  const defaultFooter = document.getElementById("defaultModalFooter");
  const uploadBtn = document.getElementById("uploadConfirmBtn");
  if (uploadBtn) uploadBtn.textContent = collageMode ? "Upload collage" : "Upload";

  // In collage mode hide individual file cards entirely; show them in individual mode
  uploadPreview.style.display = collageMode ? "none" : "";
  if (!collageMode) {
    uploadPreview.querySelectorAll(".previewCard input").forEach(input => {
      input.style.display = "";
    });
  }

  const btn = document.getElementById("uploadConfirmBtn");
  btn.innerText = collageMode ? "Upload collage" : `Upload (${newFiles.length})`;

  if (collageMode && newFiles.length) {
    refreshCollagePreview();
  }
}

function toggleCollageTitleRow() {
  const row = document.getElementById("collageTitleRow");
  const collageType = getCollageTypeEl();
  if (!row) return;
  row.style.display = collageType.value === "x" ? "flex" : "none";
}

let collagePreviewDebounce = null;

async function refreshCollagePreview() {
  const canvas = document.getElementById("collagePreviewCanvas");
  if (!canvas || !newFiles.length) return;

  const imageFiles = newFiles.filter(f => f.type && f.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const statusEl = document.getElementById("collageStatus");
  if (statusEl) {
    statusEl.className = "collage-status";
    statusEl.innerText = "Generating preview…";
  }

  try {
    const images = await Promise.all(imageFiles.map(loadImageFile));
    const title = getCollageTitle();

    // Render at full size into the preview canvas
    const ctx = canvas.getContext("2d");
    const W = canvas.width = 1080;
    const H = canvas.height = 1920;
    const GAP = 20;
    const RADIUS = 30;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.filter = "blur(40px) brightness(0.6)";
    ctx.drawImage(images[0], 0, 0, W, H);
    ctx.filter = "none";

    const rows = Math.ceil(Math.sqrt(images.length));
    let imagesLeft = images.length;
    let currentIndex = 0;
    const rowHeight = H / rows;

    for (let row = 0; row < rows; row++) {
      const itemsInRow = Math.ceil(imagesLeft / (rows - row));
      const cellWidth = W / itemsInRow;
      const cellHeight = rowHeight;
      const y = row * rowHeight;
      for (let col = 0; col < itemsInRow; col++) {
        const img = images[currentIndex++];
        if (!img) break;
        const inset = GAP / 2;
        drawRoundedImage(ctx, img, col * cellWidth + inset, y + inset, cellWidth - GAP, cellHeight - GAP, RADIUS);
      }
      imagesLeft -= itemsInRow;
    }

    const titleH = 120;
    const titleY = 50;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(ctx, GAP, titleY, W - GAP * 2, titleH, 20);
    ctx.fill();
    ctx.font = "bold 58px 'Segoe UI', sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 25;
    ctx.shadowOffsetY = 4;
    ctx.fillText(title, W / 2, titleY + titleH / 2, W - 100);
    ctx.shadowBlur = 0;

    if (statusEl) {
      statusEl.className = "collage-status done";
      statusEl.innerText = "Preview ready. Click Upload collage to upload.";
    }
  } catch (e) {
    if (statusEl) {
      statusEl.className = "collage-status error";
      statusEl.innerText = "Preview error: " + e.message;
    }
  }
}

function scheduleCollagePreview() {
  if (!isCollageMode()) return;
  clearTimeout(collagePreviewDebounce);
  collagePreviewDebounce = setTimeout(refreshCollagePreview, 300);
}

function resetCollageStatus() {
  const status = document.getElementById("collageStatus");
  if (!status) return;
  status.className = "collage-status";
  status.innerText = isCollageMode() ? "Collage output will be uploaded as a single PNG slide." : "";
}

function setDefaultCollageFields() {
  const collageFileName = getCollageFileNameEl();
  const defaultTitle = getCollageTitle();
  if (!collageNameTouched) {
    collageFileName.value = `${slugify(defaultTitle || "estancia-collage") || "estancia-collage"}.png`;
  }
}

function getCollageTitle() {
  const collageType = getCollageTypeEl();
  const collageTitle = getCollageTitleEl();
  const type = collageType.value || "g";
  if (type === "x") {
    return (collageTitle.value || "Estancia Collage").trim();
  }
  return COLLAGE_TITLES[type] || "Estancia Collage";
}

function normalizeUploadName(name, fallbackBase = "slide", fallbackExt = ".png") {
  let value = String(name || "").trim();
  if (!value) value = fallbackBase + fallbackExt;
  value = value.replace(/[\\/:*?"<>|]+/g, "-");
  if (!/\.[a-z0-9]+$/i.test(value)) value += fallbackExt;
  return value;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function confirmUpload() {
  const btn = document.getElementById("uploadConfirmBtn");
  btn.disabled = true;
  btn.innerText = isCollageMode() ? "Generating…" : "Uploading…";

  await upload();

  // If everything succeeded, close. Otherwise keep modal open so user sees errors.
  const anyError = !!document.querySelector("#uploadModal .status.error, #uploadModal .collage-status.error");
  if (!anyError) {
    closeUploadModal();
  } else {
    btn.disabled = false;
    btn.innerText = "Retry";
  }
}

async function buildUploadEntries() {
  if (!isCollageMode()) {
    return newFiles.map((file, index) => ({
      file,
      name: normalizeUploadName(file.customName || file.name, `slide-${index + 1}`, isVideo(file.name) ? ".mp4" : ".png"),
      statusEl: document.getElementById("status_" + index),
      statusClass: "status"
    }));
  }

  const statusEl = document.getElementById("collageStatus");
  statusEl.className = "collage-status";
  statusEl.innerText = "Generating collage…";

  const fileName = normalizeUploadName(getCollageFileNameEl().value, "estancia-collage", ".png");
  const file = await buildCollageFile(newFiles, fileName, getCollageTitle());

  return [{
    file,
    name: file.name,
    statusEl,
    statusClass: "collage-status"
  }];
}

/* UPLOAD FILES TO GITHUB */
async function upload() {
  let entries;
  try {
    entries = await buildUploadEntries();
  } catch (e) {
    const statusEl = document.getElementById("collageStatus");
    if (statusEl) {
      statusEl.className = "collage-status error";
      statusEl.innerText = "Error: " + e.message;
    }
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const statusEl = entry.statusEl;

    // Skip already-uploaded files (when user clicks Retry)
    if (statusEl.classList.contains("done")) continue;

    try {
      statusEl.className = entry.statusClass;
      statusEl.innerText = "Uploading…";

      const base64 = await toBase64(entry.file);

      await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides/${entry.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "upload", content: base64 })
      });

      // Cache a local blob URL so the thumbnail/preview shows the file
      // immediately, before GitHub Pages rebuilds + the CDN propagates.
      // Click the refresh icon on the thumb later to switch to the repo copy.
      try {
        if (localBlobs[entry.name]) URL.revokeObjectURL(localBlobs[entry.name]);
        localBlobs[entry.name] = URL.createObjectURL(entry.file);
      } catch (_) {}

      if (!files.includes(entry.name)) {
        // Insert at the position where + was clicked, or append at end
        if (typeof insertAtIndex === "number" && insertAtIndex >= 0) {
          files.splice(insertAtIndex, 0, entry.name);
          insertAtIndex++;
        } else {
          files.push(entry.name);
        }
      }

      statusEl.className = `${entry.statusClass} done`;
      statusEl.innerText = "Done";
    } catch (e) {
      statusEl.className = `${entry.statusClass} error`;
      statusEl.innerText = "Error: " + e.message;
    }
  }

  render();
  insertAtIndex = -1;
}

async function buildCollageFile(fileList, fileName, title) {
  if (!fileList.length) throw new Error("Please choose at least one image.");
  if (fileList.some(file => !(file.type && file.type.startsWith("image/")))) {
    throw new Error("Collage mode supports image files only.");
  }

  const images = await Promise.all(fileList.map(loadImageFile));
  const blob = await renderCollageBlob(images, title);
  return new File([blob], fileName, { type: "image/png" });
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`Failed to load ${file.name}`));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function renderCollageBlob(imgs, title) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width = 1080;
  const H = canvas.height = 1920;
  const GAP = 20;
  const RADIUS = 30;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  ctx.filter = "blur(40px) brightness(0.6)";
  ctx.drawImage(imgs[0], 0, 0, W, H);
  ctx.filter = "none";

  // Images fill the entire canvas edge-to-edge
  const rows = Math.ceil(Math.sqrt(imgs.length));
  let imagesLeft = imgs.length;
  let currentIndex = 0;
  const rowHeight = H / rows;

  for (let row = 0; row < rows; row++) {
    const itemsInRow = Math.ceil(imagesLeft / (rows - row));
    const cellWidth = W / itemsInRow;
    const cellHeight = rowHeight;
    const y = row * rowHeight;

    for (let col = 0; col < itemsInRow; col++) {
      const img = imgs[currentIndex++];
      if (!img) break;
      // Thin gap between cells, rounded corners
      const inset = GAP / 2;
      drawRoundedImage(ctx, img,
        col * cellWidth + inset, y + inset,
        cellWidth - GAP, cellHeight - GAP, RADIUS);
    }

    imagesLeft -= itemsInRow;
  }

  // Title overlay on top of images
  const titleH = 120;
  const titleY = 50;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  roundRect(ctx, GAP, titleY, W - GAP * 2, titleH, 20);
  ctx.fill();

  ctx.font = "bold 58px 'Segoe UI', sans-serif";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 25;
  ctx.shadowOffsetY = 4;
  ctx.fillText(title, W / 2, titleY + titleH / 2, W - 100);
  ctx.shadowBlur = 0;

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error("Failed to generate collage."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function drawRoundedImage(ctx, img, x, y, width, height, radius) {
  const imgRatio = img.width / img.height;
  const boxRatio = width / height;
  let sx;
  let sy;
  let sw;
  let sh;

  if (imgRatio > boxRatio) {
    sh = img.height;
    sw = sh * boxRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
