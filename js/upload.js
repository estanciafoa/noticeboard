let newFiles = [];

/* FILE PICKER → SHOW MODAL WITH PREVIEW */
fileInput.onchange = e => {
  newFiles = [...e.target.files];
  if (!newFiles.length) return;

  uploadPreview.innerHTML = "";

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
    input.oninput = () => f.customName = input.value;

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

  openUploadModal();
};

/* MODAL CONTROLS */
function openUploadModal() {
  document.getElementById("uploadModal").style.display = "flex";
  document.getElementById("uploadConfirmBtn").disabled = false;
  document.getElementById("uploadConfirmBtn").innerText = `Upload (${newFiles.length})`;
}

function closeUploadModal() {
  document.getElementById("uploadModal").style.display = "none";
  uploadPreview.innerHTML = "";
  newFiles = [];
}

function cancelUpload() {
  closeUploadModal();
}

async function confirmUpload() {
  const btn = document.getElementById("uploadConfirmBtn");
  btn.disabled = true;
  btn.innerText = "Uploading…";

  await upload();

  // If everything succeeded, close. Otherwise keep modal open so user sees errors.
  const anyError = !!document.querySelector("#uploadPreview .status.error");
  if (!anyError) {
    closeUploadModal();
  } else {
    btn.disabled = false;
    btn.innerText = "Retry";
  }
}

/* UPLOAD FILES TO GITHUB */
async function upload() {
  for (let i = 0; i < newFiles.length; i++) {
    const f = newFiles[i];
    const name = f.customName || f.name;
    const statusEl = document.getElementById("status_" + i);

    // Skip already-uploaded files (when user clicks Retry)
    if (statusEl.classList.contains("done")) continue;

    try {
      statusEl.className = "status";
      statusEl.innerText = "Uploading…";

      const base64 = await toBase64(f);

      await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "upload", content: base64 })
      });

      // Cache a local blob URL so the thumbnail/preview shows the file
      // immediately, before GitHub Pages rebuilds + the CDN propagates.
      // Click the refresh icon on the thumb later to switch to the repo copy.
      try {
        if (localBlobs[name]) URL.revokeObjectURL(localBlobs[name]);
        localBlobs[name] = URL.createObjectURL(f);
      } catch (_) {}

      if (!files.includes(name)) {
        // Insert at the position where + was clicked, or append at end
        if (typeof insertAtIndex === "number" && insertAtIndex >= 0) {
          files.splice(insertAtIndex, 0, name);
          insertAtIndex++;  // shift for next file in batch
        } else {
          files.push(name);
        }
      }
      statusEl.className = "status done";
      statusEl.innerText = "Done";

    } catch (e) {
      statusEl.className = "status error";
      statusEl.innerText = "Error: " + e.message;
    }
  }
  render();
  insertAtIndex = -1;  // reset after upload
}
