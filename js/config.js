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

const DEFAULT_DURATION_SECONDS = 10;
const DEFAULT_TRANSITION_EFFECT = "fade";
const DEFAULT_TRANSITION_MS = 700;

let appConfig = {
  defaultDuration: DEFAULT_DURATION_SECONDS,
  transitionEffect: DEFAULT_TRANSITION_EFFECT,
  transitionMs: DEFAULT_TRANSITION_MS,
  emergency: {
    enabled: false,
    slide: "",
    towers: ""
  }
};

/* LOAD CONFIG */
async function load() {
  files = [];
  config = {};

  const res = await fetch(`https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/config.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to load config.json (HTTP ${res.status})`);

  const json = await res.json();
  const slides = Array.isArray(json.slides) ? json.slides : [];

  appConfig.defaultDuration = Number(json.defaultDuration) > 0 ? Number(json.defaultDuration) : DEFAULT_DURATION_SECONDS;
  appConfig.transitionEffect = json.transitionEffect || DEFAULT_TRANSITION_EFFECT;
  appConfig.transitionMs = Number(json.transitionMs) > 0 ? Number(json.transitionMs) : DEFAULT_TRANSITION_MS;
  appConfig.emergency = {
    enabled: !!json.emergency?.enabled,
    slide: json.emergency?.slide || "",
    towers: json.emergency?.towers || ""
  };

  slides.forEach(s => {
    if (!s || !s.name) return;
    const name = String(s.name).trim();
    if (!name) return;

    // Migrate old flat start/end → times array
    let times = [];
    if (Array.isArray(s.times)) {
      times = s.times.filter(t => t && t.start && t.end);
    } else if (s.start && s.end) {
      times = [{ start: s.start, end: s.end }];
    }

    // Migrate old flat startDate/endDate → dates array
    let dates = [];
    if (Array.isArray(s.dates)) {
      dates = s.dates.filter(d => d && d.startDate);
    } else if (s.startDate) {
      dates = [{ startDate: s.startDate, endDate: s.endDate || "" }];
    }

    config[name] = {
      duration: s.duration == null ? "" : String(s.duration),
      times,
      dates,
      expiry: s.expiry || "",
      towers: s.towers || ""
    };
    files.push(name);
  });

  // files
  const list = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/slides`);
  const repoFiles = list.map(f => f.name);

  repoFiles.forEach(f => {
    if (!files.includes(f)) files.push(f);
  });

  render();

  // Auto-select the first slide so the preview isn't empty
  if (files.length && !selected) {
    selectSlide(files[0]);
  }
}

/* SAVE CONFIG */
async function saveConfig({ silent = false } = {}) {
  const payload = {
    defaultDuration: appConfig.defaultDuration,
    transitionEffect: appConfig.transitionEffect,
    transitionMs: appConfig.transitionMs,
    emergency: {
      enabled: !!appConfig.emergency?.enabled,
      slide: appConfig.emergency?.slide || "",
      towers: appConfig.emergency?.towers || ""
    },
    slides: files
      .filter(n => !!config[n])
      .map(n => {
        const c = config[n];
        return {
          name: n,
          duration: c.duration || "",
          times: c.times || [],
          dates: c.dates || [],
          expiry: c.expiry || "",
          towers: c.towers || ""
        };
      })
  };

  let existingSha;
  try {
    const file = await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/config.json`);
    existingSha = file.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  await githubFetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/config.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "update config.json",
      content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
      ...(existingSha ? { sha: existingSha } : {})
    })
  });

  if (!silent) alert("Saved!");
}
