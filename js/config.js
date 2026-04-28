let files = [];
let config = {};

/* LOCATIONS — add/remove entries here to customise towers/areas */
const LOCATIONS = [
  { id: "t1c1", label: "Tower 1 Core 1", short: "T1C1" },
  { id: "t1c2", label: "Tower 1 Core 2", short: "T1C2" },
  { id: "t2c1", label: "Tower 2 Core 1", short: "T2C1" },
  { id: "t2c2", label: "Tower 2 Core 2", short: "T2C2" },
  { id: "t3c1", label: "Tower 3 Core 1", short: "T3C1" },
  { id: "t3c2", label: "Tower 3 Core 2", short: "T3C2" },
  { id: "t4c1", label: "Tower 4 Core 1", short: "T4C1" },
  { id: "t4c2", label: "Tower 4 Core 2", short: "T4C2" },
  { id: "t5c1", label: "Tower 5 Core 1", short: "T5C1" },
  { id: "t5c2", label: "Tower 5 Core 2", short: "T5C2" },
  { id: "club", label: "Clubhouse",      short: "CLB" },
  { id: "gate", label: "Main Gate",      short: "GATE" }
];

const LEGACY_DEFAULT_TOWERS = LOCATIONS
  .filter(l => l.id !== "gate")
  .map(l => l.id)
  .join(",");

/* LOAD CONFIG */
async function load() {
  // config
  try {
    const txt = await fetch(`https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/config.txt`).then(r => r.text());
    let inSlides = false;

    txt.split("\n").forEach(l => {
      l = l.trim();
      if (!l || l.startsWith("#")) return;
      if (l.toLowerCase() === "slides:") {
        inSlides = true;
        return;
      }
      if (inSlides) {
        const p = l.split("|").map(x => x.trim());
        if (!p[0]) return;
        config[p[0]] = {
          duration: p[1] || "",
          start: p[2] || "",
          end: p[3] || "",
          startDate: p[4] || "",
          endDate: p[5] || "",
          expiry: p[6] || "",
          // Backward compatibility:
          // - No towers column (old config) => default to all except gate
          // - Explicit empty towers column => disabled
          towers: (p.length >= 8) ? (p[7] || "") : LEGACY_DEFAULT_TOWERS
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
    // Skip disabled slides — they are not present in config{}
    if (!config[n]) return;

    const c = config[n];
    content += `${n} | ${c.duration || ""} | ${c.start || ""} | ${c.end || ""} | ${c.startDate || ""} | ${c.endDate || ""} | ${c.expiry || ""} | ${c.towers || ""}\n`;
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
