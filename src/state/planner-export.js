const CONFIG_SHARE_PARAM = "wareraEcoConfig";
const PLANNER_EXPORT_PARAM = "wareraPlannerExport";
const EXPORT_VERSION = 1;
const COMPRESSED_PREFIX = "gz.";
const PLAIN_PREFIX = "js.";

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function gzipText(value) {
  if (typeof CompressionStream !== "function") {
    return null;
  }

  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipText(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Compressed links are not supported in this browser.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export function fromBase64Url(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

export async function encodePlannerExportPayload(payload) {
  const json = JSON.stringify(payload);
  const compressed = await gzipText(json);
  if (compressed) {
    return `${COMPRESSED_PREFIX}${bytesToBase64Url(compressed)}`;
  }
  return `${PLAIN_PREFIX}${bytesToBase64Url(new TextEncoder().encode(json))}`;
}

export async function decodePlannerExportPayload(value) {
  const raw = String(value || "");
  if (raw.startsWith(COMPRESSED_PREFIX)) {
    const json = await gunzipText(base64UrlToBytes(raw.slice(COMPRESSED_PREFIX.length)));
    return JSON.parse(json);
  }
  if (raw.startsWith(PLAIN_PREFIX)) {
    return JSON.parse(fromBase64Url(raw.slice(PLAIN_PREFIX.length)));
  }
  return JSON.parse(fromBase64Url(raw));
}

export function getPlannerExportParamName() {
  return PLANNER_EXPORT_PARAM;
}

export function getConfigShareParamName() {
  return CONFIG_SHARE_PARAM;
}

function cloneJson(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function prepareConfigSnapshot(snapshot, include = {}) {
  const prepared = cloneJson(snapshot);
  if (!prepared) {
    return null;
  }

  if (include.prices === false) {
    delete prepared.prices;
    delete prepared.materialProductionBonuses;
    delete prepared.syncMeta;
  }

  if (include.player === false) {
    delete prepared.importMeta;
  }

  return prepared;
}

export function buildConfigSharePayload({ active = "A", slotA, slotB, include = {} }) {
  const slots = {};
  if (include.slotA !== false && slotA) {
    slots.A = prepareConfigSnapshot(slotA, include);
  }
  if (include.slotB !== false && slotB) {
    slots.B = prepareConfigSnapshot(slotB, include);
  }

  return {
    v: EXPORT_VERSION,
    source: "warera-eco-simulator-config",
    generatedAt: new Date().toISOString(),
    active: active === "B" && slots.B ? "B" : "A",
    slots,
  };
}

export function createScenarioExport({ role, slot, snapshot, result }) {
  if (!snapshot || !result) {
    return null;
  }

  const importMeta = snapshot.importMeta && typeof snapshot.importMeta === "object"
    ? snapshot.importMeta
    : null;
  const user = importMeta?.user && typeof importMeta.user === "object"
    ? {
      id: String(importMeta.user.id || ""),
      username: String(importMeta.user.username || ""),
    }
    : null;

  return {
    role,
    slot,
    label: role === "war" ? "War factory config" : "Eco factory config",
    savedAt: snapshot.savedAt || null,
    level: Math.max(1, Math.floor(toFiniteNumber(snapshot.config?.level, result.skillLevels?.level || 1))),
    objective: String(snapshot.config?.objective || "netProfitDay"),
    profitDay: toFiniteNumber(result.netProfitDay),
    profitHour: toFiniteNumber(result.netProfitHour),
    companiesActive: Math.max(0, Math.floor(toFiniteNumber(result.companiesActive))),
    companiesConfigured: Math.max(0, Math.floor(toFiniteNumber(result.configuredCompanies))),
    employeesActive: Math.max(0, Math.floor(toFiniteNumber(result.employeesActive))),
    skillLevels: {
      energy: Math.max(0, Math.floor(toFiniteNumber(result.skillLevels?.energy))),
      entrepreneurship: Math.max(0, Math.floor(toFiniteNumber(result.skillLevels?.entrepreneurship))),
      production: Math.max(0, Math.floor(toFiniteNumber(result.skillLevels?.production))),
      companies: Math.max(0, Math.floor(toFiniteNumber(result.skillLevels?.companies))),
      management: Math.max(0, Math.floor(toFiniteNumber(result.skillLevels?.management))),
    },
    reservedSkillPoints: Math.max(0, Math.floor(toFiniteNumber(result.totalSpentPoints))),
    totalPPDay: toFiniteNumber(result.totalPPDay),
    companyPPDay: toFiniteNumber(result.companyPPDay),
    workIncomeDay: toFiniteNumber(result.workIncomeDay),
    user,
  };
}

export function buildPlannerExportPayload({ ecoScenario, warScenario, include = {} }) {
  const scenarios = {};
  if (include.eco !== false && ecoScenario) {
    scenarios.eco = ecoScenario;
  }
  if (include.war !== false && warScenario) {
    scenarios.war = warScenario;
  }

  if (include.skills === false) {
    for (const scenario of Object.values(scenarios)) {
      delete scenario.skillLevels;
      delete scenario.reservedSkillPoints;
    }
  }

  if (include.player === false) {
    for (const scenario of Object.values(scenarios)) {
      delete scenario.user;
    }
  }

  return {
    v: EXPORT_VERSION,
    source: "warera-eco-simulator",
    generatedAt: new Date().toISOString(),
    scenarios,
  };
}

export async function buildPlannerExportUrl({ origin, pathname = "/eco-simulator/", payload }) {
  const url = new URL(pathname, origin || "https://warera.xorgress.com");
  url.searchParams.set(PLANNER_EXPORT_PARAM, await encodePlannerExportPayload(payload));
  return url.toString();
}

export async function buildConfigShareUrl({ origin, pathname = "/eco-simulator/", payload }) {
  const url = new URL(pathname, origin || "https://warera.xorgress.com");
  url.searchParams.set(CONFIG_SHARE_PARAM, await encodePlannerExportPayload(payload));
  return url.toString();
}
