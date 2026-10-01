/**
 * TabCalirizer — shared store and rule engine.
 *
 * Imported as an ES module by every window script, so all windows share a single
 * in-memory copy of the data. Data lives in <profile>/tabcalirizer.json.
 * Every save broadcasts TOPIC through Services.obs so open windows repaint.
 */

const FILE_NAME = "tabcalirizer.json";
const SCHEMA_VERSION = 1;

export const TOPIC = "tabcalirizer:changed";

export const MATCH_TYPES = {
  exact: "Exact host",
  wildcard: "Domain + all subdomains",
  base: "Base domain only",
};

export const TAB_STYLES = {
  background: "Background",
  border: "Border",
  both: "Background + border",
};

export const BORDER_POSITIONS = {
  left: "Left accent",
  outline: "Full outline",
};

export const PAGE_BORDER_STYLES = {
  solid: "Solid",
  dashed: "Dashed",
};

export const TITLE_MAX = 60;

export const PAGE_BORDER_MIN = 1;
export const PAGE_BORDER_MAX = 20;

const DEFAULT_PALETTE = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"];

const HEX_RE = /^#[0-9a-f]{6}$/i;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function filePath() {
  return PathUtils.join(PathUtils.profileDir, FILE_NAME);
}

function defaults() {
  return { version: SCHEMA_VERSION, rules: [], palette: [...DEFAULT_PALETTE] };
}

export function isValidHex(value) {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

export function normalizeHex(value) {
  return isValidHex(value) ? value.trim().toLowerCase() : null;
}

/**
 * Turns whatever the user typed ("https://www.Google.com/x", "*.google.com")
 * into { pattern, type } or null when it is not a usable host.
 */
export function parsePatternInput(input, fallbackType = "exact") {
  if (typeof input !== "string") {
    return null;
  }
  let text = input.trim().toLowerCase();
  let type = fallbackType;
  if (text.startsWith("*.")) {
    text = text.slice(2);
    type = "wildcard";
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  text = text.split(/[/?#]/)[0];
  text = text.replace(/:\d+$/, "");
  text = text.replace(/\.$/, "");
  if (!HOST_RE.test(text)) {
    return null;
  }
  return { pattern: text, type };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function makeId() {
  return Services.uuid.generateUUID().toString().slice(1, 9);
}

/** Returns a clean rule object, or null if the rule is unusable. */
export function sanitizeRule(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const parsed = parsePatternInput(String(raw.pattern ?? ""), raw.type in MATCH_TYPES ? raw.type : "exact");
  const color = normalizeHex(raw.color);
  if (!parsed || !color) {
    return null;
  }
  const page = raw.pageBorder && typeof raw.pageBorder === "object" ? raw.pageBorder : {};
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : makeId(),
    title: String(raw.title ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX),
    pattern: parsed.pattern,
    type: parsed.type,
    color,
    tabStyle: raw.tabStyle in TAB_STYLES ? raw.tabStyle : "background",
    borderPosition: raw.borderPosition in BORDER_POSITIONS ? raw.borderPosition : "left",
    pageBorder: {
      enabled: Boolean(page.enabled),
      width: clampInt(page.width, PAGE_BORDER_MIN, PAGE_BORDER_MAX, 3),
      style: page.style in PAGE_BORDER_STYLES ? page.style : "solid",
      showTitle: Boolean(page.showTitle),
    },
  };
}

function sanitizeData(raw) {
  const out = defaults();
  if (!raw || typeof raw !== "object") {
    return out;
  }
  if (Array.isArray(raw.rules)) {
    const seen = new Set();
    for (const r of raw.rules) {
      const rule = sanitizeRule(r);
      const key = rule && `${rule.type}:${rule.pattern}`;
      if (rule && !seen.has(key)) {
        seen.add(key);
        out.rules.push(rule);
      }
    }
  }
  if (Array.isArray(raw.palette)) {
    out.palette = [...new Set(raw.palette.map(normalizeHex).filter(Boolean))];
  }
  return out;
}

/* ---------- Matching ---------- */

function labelCount(host) {
  return host.split(".").length;
}

const TYPE_WEIGHT = { exact: 3, base: 2, wildcard: 1 };

function ruleMatches(rule, host) {
  switch (rule.type) {
    case "exact":
      return host === rule.pattern;
    case "base":
      // "www." is treated as the same site as the bare domain.
      return host === rule.pattern || host === `www.${rule.pattern}`;
    case "wildcard":
      return host === rule.pattern || host.endsWith(`.${rule.pattern}`);
    default:
      return false;
  }
}

/** Higher = more specific. Longer patterns beat shorter ones; then exact > base > wildcard. */
function specificity(rule) {
  return labelCount(rule.pattern) * 10 + TYPE_WEIGHT[rule.type];
}

export function matchHost(rules, host) {
  if (!host) {
    return null;
  }
  host = host.toLowerCase();
  let best = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (ruleMatches(rule, host)) {
      const score = specificity(rule);
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Host of an nsIURI, or "" for about:, file:, etc. */
export function hostOfURI(uri) {
  try {
    if (!uri || !/^https?$/.test(uri.scheme)) {
      return "";
    }
    return uri.host.toLowerCase();
  } catch {
    return "";
  }
}

export function baseDomainOf(host) {
  try {
    return Services.eTLD.getBaseDomainFromHost(host);
  } catch {
    return host;
  }
}

/** "#000000" or "#ffffff", whichever reads better on the given color. */
export function contrastText(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.179 ? "#000000" : "#ffffff";
}

/* ---------- Store ---------- */

let cache = null;
let loading = null;

export const Store = {
  async load() {
    if (cache) {
      return cache;
    }
    if (!loading) {
      loading = (async () => {
        try {
          if (await IOUtils.exists(filePath())) {
            cache = sanitizeData(await IOUtils.readJSON(filePath()));
          } else {
            cache = defaults();
          }
        } catch (err) {
          console.warn("[TabCalirizer] Could not read settings file, starting fresh:", err);
          cache = defaults();
        }
        return cache;
      })();
    }
    return loading;
  },

  /** Synchronous snapshot; null until load() has resolved once. */
  get data() {
    return cache;
  },

  async save(next) {
    cache = sanitizeData(next);
    try {
      await IOUtils.writeJSON(filePath(), cache, { tmpPath: `${filePath()}.tmp` });
    } catch (err) {
      console.error("[TabCalirizer] Could not write settings file:", err);
    }
    Services.obs.notifyObservers(null, TOPIC);
    return cache;
  },

  async update(mutator) {
    const current = structuredClone(await this.load());
    mutator(current);
    return this.save(current);
  },

  async upsertRule(rawRule) {
    const rule = sanitizeRule(rawRule);
    if (!rule) {
      throw new Error("Invalid rule");
    }
    await this.update((d) => {
      // Same pattern + type replaces the existing rule.
      d.rules = d.rules.filter((r) => r.id !== rule.id && !(r.pattern === rule.pattern && r.type === rule.type));
      d.rules.push(rule);
    });
    return rule;
  },

  async removeRule(id) {
    await this.update((d) => {
      d.rules = d.rules.filter((r) => r.id !== id);
    });
  },

  async addPaletteColor(hex) {
    const color = normalizeHex(hex);
    if (!color) {
      throw new Error("Invalid color");
    }
    await this.update((d) => {
      if (!d.palette.includes(color)) {
        d.palette.push(color);
      }
    });
  },

  async removePaletteColor(hex) {
    await this.update((d) => {
      d.palette = d.palette.filter((c) => c !== hex);
    });
  },

  exportJSON() {
    return JSON.stringify(cache ?? defaults(), null, 2);
  },

  /** Merges or replaces with imported data. Returns the number of rules imported. */
  async importJSON(text, { replace = false } = {}) {
    const incoming = sanitizeData(JSON.parse(text));
    await this.update((d) => {
      if (replace) {
        d.rules = incoming.rules;
        d.palette = incoming.palette;
        return;
      }
      for (const rule of incoming.rules) {
        d.rules = d.rules.filter((r) => !(r.pattern === rule.pattern && r.type === rule.type));
        d.rules.push(rule);
      }
      d.palette = [...new Set([...d.palette, ...incoming.palette])];
    });
    return incoming.rules.length;
  },

  /** One-shot hand-off from the browser window to the settings page ("Color this site…"). */
  pendingDraft: null,
};
