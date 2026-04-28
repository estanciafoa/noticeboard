let newFiles = [];

/* UPLOAD FILE CHANGE HANDLER */
fileInput.onchange = e => {
  newFiles = [...e.target.files];
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
    input.oninput = () => f.customName = input.value;

    const status = document.createElement("div");
    status.id = "status_" + i;

    div.appendChild(media);
    div.appendChild(input);
    div.appendChild(status);
    uploadPreview.appendChild(div);
  });

  upload();
};

/* UPLOAD FILES TO GITHUB */
async function upload() {
  for (let i = 0; i < newFiles.length; i++) {
    const f = newFiles[i];
    const name = f.customName || f.name;

    try {
      document.getElementById("status_" + i).innerText = "Uploading";

      const base64 = await toBase64(f);

      await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "upload", content: base64 })
      });

      files.push(name);
      document.getElementById("status_" + i).innerText = "Done";

    } catch (e) {
      document.getElementById("status_" + i).innerText = "Error";
    }
  }
  render();
}
