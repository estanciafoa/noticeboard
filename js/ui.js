let selected = null;
let dragIndex;

/* DETECT VIDEO FILE */
function isVideo(name) {
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(name);
}

/* CREATE MEDIA ELEMENT (img or video) */
function createMedia(name, { muted = true, controls = false } = {}) {
  const url = `https://${repoOwner}.github.io/${repoName}/slides/${name}`;
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

/* RENDER THUMBNAIL LIST */
function render() {
  thumbList.innerHTML = "";

  files.forEach((name, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    if (name === selected) div.classList.add("active");

    const media = createMedia(name);
    div.appendChild(media);

    div.onclick = () => selectSlide(name);

    // drag
    div.draggable = true;
    div.ondragstart = () => dragIndex = i;
    div.ondrop = () => reorder(i);
    div.ondragover = e => e.preventDefault();

    thumbList.appendChild(div);
  });
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

  enabled.checked = !!config[name];
  duration.value = c.duration || "";
  startTime.value = c.start || "";
  endTime.value = c.end || "";
  startDate.value = c.startDate || "";
  endDate.value = c.endDate || "";
  expiry.value = c.expiry || "";
}

/* UPDATE CONFIG ON INPUT */
document.querySelectorAll(".right input").forEach(el => {
  el.oninput = () => {
    if (!selected) return;

    if (!enabled.checked) {
      delete config[selected];
      return;
    }

    config[selected] = {
      duration: duration.value,
      start: startTime.value,
      end: endTime.value,
      startDate: startDate.value,
      endDate: endDate.value,
      expiry: expiry.value
    };
  };
});

/* DELETE SLIDE */
async function deleteSlide() {
  if (!selected) return;

  if (!confirm(`Delete "${selected}"?\n\nThis will remove the file from the repo and update config.txt.`)) {
    return;
  }

  const name = selected;

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
    selected = null;
    screenEl.innerHTML = "";
    render();

    // Persist config.txt so the deleted slide isn't resurrected on next load
    await saveConfig({ silent: true });

  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}
