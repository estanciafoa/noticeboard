let files = [];
let config = {};

/* LOAD CONFIG */
async function load() {
  // config
  try {
    const txt = await fetch(`https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/config.txt`).then(r => r.text());
    let inSlides = false;

    txt.split("\n").forEach(l => {
      l = l.trim();
      if (l.toLowerCase() === "slides:") {
        inSlides = true;
        return;
      }
      if (inSlides) {
        const p = l.split("|").map(x => x.trim());
        config[p[0]] = {
          duration: p[1] || "",
          start: p[2] || "",
          end: p[3] || "",
          startDate: p[4] || "",
          endDate: p[5] || "",
          expiry: p[6] || ""
        };
        files.push(p[0]);
      }
    });
  } catch (e) {}

  // files
  const list = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides`);
  const repoFiles = list.map(f => f.name);

  repoFiles.forEach(f => {
    if (!files.includes(f)) files.push(f);
  });

  render();
}

/* SAVE CONFIG */
async function saveConfig({ silent = false } = {}) {
  let content = "default | 10\n\nslides:\n";

  files.forEach(n => {
    const c = config[n] || {};
    let line = n;
    if (c.duration) line += ` | ${c.duration}`;
    if (c.start) line += ` | ${c.start}`;
    if (c.end) line += ` | ${c.end}`;
    if (c.startDate) line += ` | ${c.startDate}`;
    if (c.endDate) line += ` | ${c.endDate}`;
    if (c.expiry) line += ` | ${c.expiry}`;
    content += line + "\n";
  });

  const file = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/config.txt`);

  await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/config.txt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "update config",
      content: btoa(unescape(encodeURIComponent(content))),
      sha: file.sha
    })
  });

  if (!silent) alert("Saved!");
}
