const BASE_STATS = {
  entrepreneurship: 30,
  energy: 30,
  production: 10,
  companies: 2,
  management: 4,
};

const LEVEL_GAINS = {
  entrepreneurship: 5,
  energy: 10,
  production: 3,
  companies: 1,
  management: 2,
};

const SKILL_KEYS = ["energy", "entrepreneurship", "production", "companies", "management"];
const MAX_SKILL_LEVEL = 10;

const AE_RATES = {
  1: 24,
  2: 48,
  3: 72,
  4: 96,
  5: 120,
  6: 144,
  7: 168,
};

const CYCLES_PER_DAY = 24 / 10;
const STORAGE_KEY = "warera-eco-simulator-v2";
const COMPARE_STORAGE_KEY = "warera-eco-simulator-compare-v1";
const LEGACY_REFERENCE_STORAGE_KEY = "warera-eco-simulator-reference-v1";
const PRICE_API_URL = "https://api2.warera.io/trpc/itemTrading.getPrices";

const MATERIALS = [
  { id: "limestone", name: "Limestone", pp: 1, ingredients: {} },
  { id: "iron", name: "Iron", pp: 1, ingredients: {} },
  { id: "petroleum", name: "Petroleum", pp: 1, ingredients: {} },
  { id: "concrete", name: "Concrete", pp: 10, ingredients: { limestone: 10 } },
  { id: "steel", name: "Steel", pp: 10, ingredients: { iron: 10 } },
  { id: "oil", name: "Oil", pp: 1, ingredients: { petroleum: 1 } },
  { id: "grain", name: "Grain", pp: 1, ingredients: {} },
  { id: "livestock", name: "Livestock", pp: 20, ingredients: {} },
  { id: "fish", name: "Fish", pp: 40, ingredients: {} },
  { id: "bread", name: "Bread", pp: 10, ingredients: { grain: 10 } },
  { id: "steak", name: "Steak", pp: 20, ingredients: { livestock: 1 } },
  { id: "cooked_fish", name: "Cooked Fish", pp: 40, ingredients: { fish: 1 } },
  { id: "lead", name: "Lead", pp: 1, ingredients: {} },
  { id: "light_ammo", name: "Light Ammo", pp: 1, ingredients: { lead: 1 } },
  { id: "ammo", name: "Ammo", pp: 4, ingredients: { lead: 4 } },
  { id: "heavy_ammo", name: "Heavy Ammo", pp: 16, ingredients: { lead: 16 } },
  { id: "mysterious_plant", name: "Mysterious Plant", pp: 1, ingredients: {} },
  { id: "pill", name: "Pill", pp: 200, ingredients: { mysterious_plant: 200 } },
];

const MATERIAL_MAP = new Map(MATERIALS.map((m) => [m.id, m]));

const OBJECTIVES = {
  netProfitDay: { label: "Net Profit / Day", score: (r) => r.netProfitDay },
  totalPPDay: { label: "Total PP / Day", score: (r) => r.totalPPDay },
  companyPPDay: { label: "Company PP / Day", score: (r) => r.companyPPDay },
  unitsDay: { label: "Produced Units / Day", score: (r) => r.unitsDay },
  workIncomeDay: { label: "Work Wage Income / Day", score: (r) => r.workIncomeDay },
};

const OPTIMIZED_SKILL_KEYS = ["energy", "entrepreneurship", "production"];

let companyConfigsState = [];
let nextCompanyId = 1;
let compareState = {
  active: "A",
  slots: { A: null, B: null },
};
let entrePlanSlotsState = [];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function bonusMultiplier(bonusPct) {
  return 1 + (Math.max(0, bonusPct) / 100);
}

function fidelityMultiplier(fidelityPct) {
  return 1 + (clamp(fidelityPct, 0, 10) / 100);
}

function num(id, fallback = 0) {
  const el = document.getElementById(id);
  const parsed = Number.parseFloat(el.value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function intNum(id, fallback = 0) {
  return Math.floor(num(id, fallback));
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "0.00";
}

function fmtSignedDelta(n, digits = 2) {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return fmt(0, digits);
  const sign = n > 0 ? "+" : "-";
  return `${sign}${fmt(Math.abs(n), digits)}`;
}

function deltaClassForValue(n) {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return "delta-neutral";
  return n > 0 ? "delta-positive" : "delta-negative";
}

function deltaSuffix(currentValue, referenceValue, digits = 2) {
  if (!Number.isFinite(referenceValue)) return "";
  const delta = currentValue - referenceValue;
  const formattedDelta = fmtSignedDelta(delta, digits);
  const zeroDisplay = fmt(0, digits);
  if (
    formattedDelta === zeroDisplay ||
    formattedDelta === `+${zeroDisplay}` ||
    formattedDelta === `-${zeroDisplay}`
  ) {
    return "";
  }
  return ` <span class="delta-note ${deltaClassForValue(delta)}">${formattedDelta} vs other scenario</span>`;
}

function getAllocationsFromInputs() {
  return {
    energy: clamp(intNum("alloc-energy"), 0, MAX_SKILL_LEVEL),
    entrepreneurship: clamp(intNum("alloc-entrepreneurship"), 0, MAX_SKILL_LEVEL),
    production: clamp(intNum("alloc-production"), 0, MAX_SKILL_LEVEL),
    companies: clamp(intNum("alloc-companies"), 0, MAX_SKILL_LEVEL),
    management: clamp(intNum("alloc-management"), 0, MAX_SKILL_LEVEL),
  };
}

function setAllocationsToInputs(alloc) {
  document.getElementById("alloc-energy").value = alloc.energy;
  document.getElementById("alloc-entrepreneurship").value = alloc.entrepreneurship;
  document.getElementById("alloc-production").value = alloc.production;
  document.getElementById("alloc-companies").value = alloc.companies;
  document.getElementById("alloc-management").value = alloc.management;
}

function getPrices() {
  const prices = {};
  for (const material of MATERIALS) {
    prices[material.id] = Math.max(0, num(`price-${material.id}`));
  }
  return prices;
}

function createDefaultWorkerConfig(overrides = {}) {
  return {
    energyPer10h: Math.max(0, Number(overrides.energyPer10h ?? 100) || 0),
    productionPerAction: Math.max(0, Number(overrides.productionPerAction ?? 31) || 0),
    fidelityPct: clamp(Number(overrides.fidelityPct ?? 0) || 0, 0, 10),
  };
}

function sanitizeWorkerConfig(raw, defaults = {}) {
  return {
    energyPer10h: Math.max(0, Number(raw?.energyPer10h ?? defaults.energyPer10h ?? 100) || 0),
    productionPerAction: Math.max(0, Number(raw?.productionPerAction ?? defaults.productionPerAction ?? 31) || 0),
    fidelityPct: clamp(Number(raw?.fidelityPct ?? defaults.fidelityPct ?? 0) || 0, 0, 10),
  };
}

function workerCount(company) {
  return Array.isArray(company?.workers) ? company.workers.length : 0;
}

function createDefaultCompanyConfig(specialization = "iron") {
  const materialId = MATERIAL_MAP.has(specialization) ? specialization : MATERIALS[0].id;
  const config = {
    id: nextCompanyId,
    specialization: materialId,
    aeLevel: 1,
    productionBonusPct: 0,
    manualActionsPer10h: 0,
    workers: [],
    wagePerPP: 0.135,
  };
  nextCompanyId += 1;
  return config;
}

function sanitizeCompanyConfig(raw, defaults = {}) {
  const idCandidate = Number(raw?.id);
  const id = Number.isInteger(idCandidate) && idCandidate > 0 ? idCandidate : nextCompanyId++;
  const specialization = MATERIAL_MAP.has(raw?.specialization) ? raw.specialization : MATERIALS[0].id;
  const aeLevel = clamp(Math.floor(Number(raw?.aeLevel) || 1), 1, 7);
  const productionBonusPct = Math.max(0, Number(raw?.productionBonusPct) || 0);
  const manualActionsPer10h = Math.max(0, Math.floor(Number(raw?.manualActionsPer10h) || 0));
  const workerDefaults = {
    energyPer10h: Math.max(0, Number(raw?.employeeEnergyPer10h ?? defaults.employeeEnergyPer10h ?? 100) || 0),
    productionPerAction: Math.max(0, Number(raw?.employeeProductionPerAction ?? defaults.employeeProductionPerAction ?? 31) || 0),
    fidelityPct: clamp(Number(raw?.workerFidelityPct ?? defaults.workerFidelityPct ?? 0) || 0, 0, 10),
  };
  let workers = [];
  if (Array.isArray(raw?.workers)) {
    workers = raw.workers.map((worker) => sanitizeWorkerConfig(worker, workerDefaults));
  } else {
    const workerCountLegacy = Math.max(0, Math.floor(Number(raw?.workers) || 0));
    workers = Array.from({ length: workerCountLegacy }, () => createDefaultWorkerConfig(workerDefaults));
  }
  const hasWage = raw?.wagePerPP !== undefined && raw?.wagePerPP !== null && raw?.wagePerPP !== "";
  const wagePerPP = hasWage ? Math.max(0, Number(raw.wagePerPP) || 0) : 0.135;
  return { id, specialization, aeLevel, productionBonusPct, manualActionsPer10h, workers, wagePerPP };
}

function setCompanyConfigs(configs, defaults = {}) {
  const normalized = (Array.isArray(configs) ? configs : [])
    .map((raw) => sanitizeCompanyConfig(raw, defaults))
    .filter((company, idx, arr) => arr.findIndex((c) => c.id === company.id) === idx);

  companyConfigsState = normalized.length > 0
    ? normalized
    : [createDefaultCompanyConfig("iron"), createDefaultCompanyConfig("steel")];

  const maxId = companyConfigsState.reduce((max, company) => Math.max(max, company.id), 0);
  nextCompanyId = Math.max(nextCompanyId, maxId + 1);
}

function getCompanyConfigs() {
  return companyConfigsState.map((company) => ({
    ...company,
    workers: Array.isArray(company.workers)
      ? company.workers.map((worker) => ({ ...worker }))
      : [],
  }));
}

function sanitizeEntrePlanSlots(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => {
    const parsed = Math.floor(Number(value));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
}

function getEntrePlanSlotsState() {
  return sanitizeEntrePlanSlots(entrePlanSlotsState);
}

function setEntrePlanSlotsState(slots) {
  entrePlanSlotsState = sanitizeEntrePlanSlots(slots);
}

function getConfigFromInputs() {
  const level = Math.max(1, intNum("level", 1));
  const objective = document.getElementById("objective").value;
  const companyConfigs = getCompanyConfigs();
  const configuredCompanies = companyConfigs.length;
  const totalWorkersConfigured = companyConfigs.reduce((sum, company) => sum + workerCount(company), 0);

  return {
    level,
    totalSkillPoints: level * 4,
    objective,
    workUsagePct: clamp(num("work-usage"), 0, 100) / 100,
    entreUsagePct: clamp(num("entre-usage"), 0, 100) / 100,
    companyUtilizationPct: clamp(num("company-utilization"), 0, 100) / 100,
    ownWagePerPP: Math.max(0, num("own-wage")),
    entrePlanSlots: getEntrePlanSlotsState(),
    configuredCompanies,
    totalWorkersConfigured,
    companyConfigs,
    prices: getPrices(),
  };
}

function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const config = raw.config || {};
  const alloc = raw.alloc || {};
  const prices = raw.prices || {};
  const rawCompanyConfigs = Array.isArray(raw.companyConfigs) ? raw.companyConfigs : [];
  const objective = OBJECTIVES[config.objective] ? config.objective : "netProfitDay";
  const hasLegacyEmployeePPDay = config.employeePPDay !== undefined && config.employeePPDay !== null && config.employeePPDay !== "";
  const legacyEmployeePPDay = Math.max(0, Number(config.employeePPDay) || 0);
  const employeeEnergy10h = Math.max(0, Number(config.employeeEnergy10h ?? 100) || 0);
  const defaultActionsPerDay = Math.max(1, Math.floor(employeeEnergy10h / 10) * CYCLES_PER_DAY);
  const employeeProductionFromConfig = config.employeeProductionCapacity ?? config.employeeProductionPerAction;
  const employeeProductionPerAction = employeeProductionFromConfig !== undefined && employeeProductionFromConfig !== null && employeeProductionFromConfig !== ""
    ? Math.max(0, Number(employeeProductionFromConfig) || 0)
    : (hasLegacyEmployeePPDay ? Math.max(0, legacyEmployeePPDay / defaultActionsPerDay) : 31);
  const companyFallbacks = { employeeEnergyPer10h: employeeEnergy10h, employeeProductionPerAction };
  const companyConfigs = rawCompanyConfigs.map((company) => sanitizeCompanyConfig(company, companyFallbacks));

  const normalizedPrices = {};
  for (const material of MATERIALS) {
    normalizedPrices[material.id] = Math.max(0, Number(prices[material.id]) || 0);
  }

  return {
    savedAt: raw.savedAt || new Date().toISOString(),
    config: {
      level: Math.max(1, Math.floor(Number(config.level) || 1)),
      workUsage: clamp(Number(config.workUsage) || 0, 0, 100),
      entreUsage: clamp(Number(config.entreUsage) || 0, 0, 100),
      companyUtilization: clamp(Number(config.companyUtilization) || 0, 0, 100),
      ownWage: Math.max(0, Number(config.ownWage) || 0),
      optimizeSkill: config.optimizeSkill !== false,
      optimizeEntrePlan: config.optimizeEntrePlan === true,
      entrePlanSlots: sanitizeEntrePlanSlots(config.entrePlanSlots),
      objective,
    },
    alloc: {
      energy: clamp(Math.floor(Number(alloc.energy) || 0), 0, MAX_SKILL_LEVEL),
      entrepreneurship: clamp(Math.floor(Number(alloc.entrepreneurship) || 0), 0, MAX_SKILL_LEVEL),
      production: clamp(Math.floor(Number(alloc.production) || 0), 0, MAX_SKILL_LEVEL),
      companies: clamp(Math.floor(Number(alloc.companies) || 0), 0, MAX_SKILL_LEVEL),
      management: clamp(Math.floor(Number(alloc.management) || 0), 0, MAX_SKILL_LEVEL),
    },
    prices: normalizedPrices,
    companyConfigs,
  };
}

function captureSnapshotFromInputs() {
  return normalizeSnapshot({
    savedAt: new Date().toISOString(),
    config: {
      level: document.getElementById("level").value,
      workUsage: document.getElementById("work-usage").value,
      entreUsage: document.getElementById("entre-usage").value,
      companyUtilization: document.getElementById("company-utilization").value,
      ownWage: document.getElementById("own-wage").value,
      optimizeSkill: document.getElementById("optimize-skill-toggle")?.checked !== false,
      optimizeEntrePlan: document.getElementById("optimize-entre-plan-toggle")?.checked === true,
      entrePlanSlots: getEntrePlanSlotsState(),
      objective: document.getElementById("objective").value,
    },
    alloc: getAllocationsFromInputs(),
    prices: getPrices(),
    companyConfigs: getCompanyConfigs(),
  });
}

function buildConfigFromSnapshot(snapshot) {
  const level = Math.max(1, Math.floor(Number(snapshot?.config?.level) || 1));
  const companyConfigs = Array.isArray(snapshot?.companyConfigs)
    ? snapshot.companyConfigs.map((company) => sanitizeCompanyConfig(company))
    : [];
  const configuredCompanies = companyConfigs.length;
  const totalWorkersConfigured = companyConfigs.reduce((sum, company) => sum + workerCount(company), 0);
  const prices = {};
  for (const material of MATERIALS) {
    prices[material.id] = Math.max(0, Number(snapshot?.prices?.[material.id]) || 0);
  }

  return {
    level,
    totalSkillPoints: level * 4,
    objective: OBJECTIVES[snapshot?.config?.objective] ? snapshot.config.objective : "netProfitDay",
    workUsagePct: clamp(Number(snapshot?.config?.workUsage) || 0, 0, 100) / 100,
    entreUsagePct: clamp(Number(snapshot?.config?.entreUsage) || 0, 0, 100) / 100,
    companyUtilizationPct: clamp(Number(snapshot?.config?.companyUtilization) || 0, 0, 100) / 100,
    ownWagePerPP: Math.max(0, Number(snapshot?.config?.ownWage) || 0),
    entrePlanSlots: sanitizeEntrePlanSlots(snapshot?.config?.entrePlanSlots),
    configuredCompanies,
    totalWorkersConfigured,
    companyConfigs,
    prices,
  };
}

function simulateFromSnapshot(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return null;
  const config = buildConfigFromSnapshot(normalized);
  return simulate(normalized.alloc, config);
}

function applySnapshotToInputs(snapshot, shouldRerender = true) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return;

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  };

  setValue("level", normalized.config.level);
  setValue("work-usage", normalized.config.workUsage);
  setValue("entre-usage", normalized.config.entreUsage);
  setValue("company-utilization", normalized.config.companyUtilization);
  setValue("own-wage", normalized.config.ownWage);
  setValue("objective", normalized.config.objective);
  const optimizeSkillToggle = document.getElementById("optimize-skill-toggle");
  const optimizeEntrePlanToggle = document.getElementById("optimize-entre-plan-toggle");
  if (optimizeSkillToggle) optimizeSkillToggle.checked = normalized.config.optimizeSkill !== false;
  if (optimizeEntrePlanToggle) optimizeEntrePlanToggle.checked = normalized.config.optimizeEntrePlan === true;
  setEntrePlanSlotsState(normalized.config.entrePlanSlots);
  setAllocationsToInputs(normalized.alloc);
  for (const material of MATERIALS) {
    setValue(`price-${material.id}`, normalized.prices[material.id]);
  }
  setCompanyConfigs(normalized.companyConfigs);
  renderCompanyEditor();
  if (shouldRerender) {
    rerenderFromCurrentState();
  }
}

function normalizeCompareState(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    active: raw.active === "B" ? "B" : "A",
    slots: {
      A: normalizeSnapshot(raw?.slots?.A),
      B: normalizeSnapshot(raw?.slots?.B),
    },
  };
}

function saveCompareState() {
  localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareState));
}

function loadLegacyReferenceSnapshot() {
  const raw = localStorage.getItem(LEGACY_REFERENCE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeSnapshot(parsed);
  } catch (err) {
    console.error("Failed to load legacy reference snapshot:", err);
    localStorage.removeItem(LEGACY_REFERENCE_STORAGE_KEY);
    return null;
  }
}

function loadCompareState() {
  const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
  if (!raw) {
    compareState = {
      active: "A",
      slots: { A: null, B: null },
    };
  } else {
    try {
      const parsed = JSON.parse(raw);
      compareState = normalizeCompareState(parsed) || {
        active: "A",
        slots: { A: null, B: null },
      };
    } catch (err) {
      console.error("Failed to load compare state:", err);
      compareState = {
        active: "A",
        slots: { A: null, B: null },
      };
      localStorage.removeItem(COMPARE_STORAGE_KEY);
    }
  }

  const currentSnapshot = captureSnapshotFromInputs();
  const legacySnapshot = loadLegacyReferenceSnapshot();

  if (!compareState.slots.A) compareState.slots.A = currentSnapshot;
  if (!compareState.slots.B) compareState.slots.B = legacySnapshot || currentSnapshot;

  if (!compareState.slots[compareState.active]) {
    compareState.active = "A";
  }

  localStorage.removeItem(LEGACY_REFERENCE_STORAGE_KEY);
  saveCompareState();
}

function getDisplayTimestamp(isoString) {
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return String(isoString || "");
  return dt.toLocaleString();
}

function getApiKeysForMaterial(materialId) {
  const explicitMap = {
    cooked_fish: ["cookedFish"],
    light_ammo: ["lightAmmo"],
    heavy_ammo: ["heavyAmmo"],
    mysterious_plant: ["mysteriousPlant", "coca"],
    pill: ["pill", "cocain"],
  };
  if (explicitMap[materialId]) return explicitMap[materialId];
  return [materialId.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
}

function getItemImageFile(materialId) {
  const explicitMap = {
    cooked_fish: "cookedFish.png",
    light_ammo: "lightAmmo.png",
    heavy_ammo: "heavyAmmo.png",
    mysterious_plant: "coca.png",
    pill: "cocain.png",
  };
  if (explicitMap[materialId]) return explicitMap[materialId];
  return `${materialId}.png`;
}

function getItemImagePath(materialId) {
  return `./images/items/${getItemImageFile(materialId)}`;
}

function getMaterialDepth(materialId, memo = new Map()) {
  if (memo.has(materialId)) return memo.get(materialId);
  const material = MATERIAL_MAP.get(materialId);
  if (!material) return 0;
  const ingredientIds = Object.keys(material.ingredients);
  if (ingredientIds.length === 0) {
    memo.set(materialId, 0);
    return 0;
  }

  const depth = 1 + Math.max(...ingredientIds.map((id) => getMaterialDepth(id, memo)));
  memo.set(materialId, depth);
  return depth;
}

function getProductionOrder() {
  const depthMemo = new Map();
  return MATERIALS.slice().sort((a, b) => {
    const depthDiff = getMaterialDepth(a.id, depthMemo) - getMaterialDepth(b.id, depthMemo);
    if (depthDiff !== 0) return depthDiff;
    return a.name.localeCompare(b.name);
  });
}

function levelCost(level) {
  return (level * (level + 1)) / 2;
}

function nextLevelCost(currentLevel) {
  return currentLevel + 1;
}

function refundFromLevelDecrease(currentLevel) {
  return currentLevel;
}

function maxAffordableLevel(points) {
  return Math.floor((Math.sqrt(1 + (8 * points)) - 1) / 2);
}

function createEmptyAllocation() {
  return {
    energy: 0,
    entrepreneurship: 0,
    production: 0,
    companies: 0,
    management: 0,
  };
}

function getSkillCosts(alloc) {
  return {
    energy: levelCost(alloc.energy),
    entrepreneurship: levelCost(alloc.entrepreneurship),
    production: levelCost(alloc.production),
    companies: levelCost(alloc.companies),
    management: levelCost(alloc.management),
  };
}

function getTotalSpentPoints(alloc) {
  return SKILL_KEYS.reduce((sum, key) => sum + levelCost(alloc[key]), 0);
}

function getSkillLevelBounds(config, totalSkillPoints) {
  const globalMax = Math.min(MAX_SKILL_LEVEL, maxAffordableLevel(totalSkillPoints));
  const bounds = {
    energy: globalMax,
    entrepreneurship: globalMax,
    production: globalMax,
    companies: globalMax,
    management: globalMax,
  };

  const companiesNeeded = Math.max(0, config.configuredCompanies - BASE_STATS.companies);
  const managementNeeded = Math.max(0, config.totalWorkersConfigured - BASE_STATS.management);

  bounds.companies = Math.min(globalMax, Math.ceil(companiesNeeded / LEVEL_GAINS.companies));
  bounds.management = Math.min(globalMax, Math.ceil(managementNeeded / LEVEL_GAINS.management));

  if (config.workUsagePct <= 0) {
    bounds.energy = 0;
  }
  if (config.entreUsagePct <= 0) {
    bounds.entrepreneurship = 0;
  }

  return bounds;
}

function getIngredientCostPerUnit(material, prices) {
  return Object.entries(material.ingredients).reduce((sum, [ingredientId, qty]) => {
    return sum + (Math.max(0, qty) * (prices[ingredientId] || 0));
  }, 0);
}

function scoreEntreActionForCompany(company, stats, config) {
  const material = MATERIAL_MAP.get(company.specialization);
  if (!material || material.pp <= 0) return -Infinity;

  const ppPerAction = stats.production * bonusMultiplier(company.productionBonusPct) * config.companyUtilizationPct;
  if (!Number.isFinite(ppPerAction) || ppPerAction <= 0) return -Infinity;

  const unitsPerAction = ppPerAction / material.pp;
  const ingredientCostPerUnit = getIngredientCostPerUnit(material, config.prices);
  const profitPerAction = (unitsPerAction * (config.prices[material.id] || 0)) - (unitsPerAction * ingredientCostPerUnit);

  if (config.objective === "netProfitDay") return profitPerAction;
  if (config.objective === "totalPPDay" || config.objective === "companyPPDay") return ppPerAction;
  if (config.objective === "unitsDay") return unitsPerAction;
  return 0;
}

function buildEntrepreneurshipPlan(activeCompanies, allCompanyConfigs, stats, config, planOverrideByCompanyId = null) {
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const requestedByCompanyId = {};
  const effectiveByCompanyId = {};
  for (const company of activeCompanies) {
    requestedByCompanyId[company.id] = 0;
    effectiveByCompanyId[company.id] = 0;
  }

  if (capPer10h <= 0 || activeCompanies.length === 0) {
    return {
      capPer10h,
      requestedTotalPer10h: 0,
      requestedActiveTotalPer10h: 0,
      effectiveTotalPer10h: 0,
      overCapPer10h: 0,
      unassignedPer10h: 0,
      requestedInactiveCompaniesPer10h: 0,
      requestedByCompanyId,
      effectiveByCompanyId,
    };
  }

  const activeIds = new Set(activeCompanies.map((company) => company.id));
  if (planOverrideByCompanyId) {
    let requestedActiveTotalPer10h = 0;
    let effectiveTotalPer10h = 0;
    let requestedInactiveCompaniesPer10h = 0;

    for (const company of allCompanyConfigs) {
      const requested = Math.max(0, Math.floor(Number(planOverrideByCompanyId[company.id]) || 0));
      if (!activeIds.has(company.id)) {
        requestedInactiveCompaniesPer10h += requested;
      }
    }

    let remaining = capPer10h;
    for (const company of activeCompanies) {
      const requested = Math.max(0, Math.floor(Number(planOverrideByCompanyId[company.id]) || 0));
      requestedByCompanyId[company.id] = requested;
      requestedActiveTotalPer10h += requested;
      const effective = Math.min(requested, remaining);
      effectiveByCompanyId[company.id] = effective;
      effectiveTotalPer10h += effective;
      remaining -= effective;
    }

    return {
      capPer10h,
      requestedTotalPer10h: requestedActiveTotalPer10h + requestedInactiveCompaniesPer10h,
      requestedActiveTotalPer10h,
      effectiveTotalPer10h,
      overCapPer10h: Math.max(0, requestedActiveTotalPer10h - effectiveTotalPer10h),
      unassignedPer10h: Math.max(0, capPer10h - effectiveTotalPer10h),
      requestedInactiveCompaniesPer10h,
      requestedByCompanyId,
      effectiveByCompanyId,
    };
  }

  const rawSlots = sanitizeEntrePlanSlots(config.entrePlanSlots).slice(0, capPer10h);
  let requestedActiveTotalPer10h = 0;
  let requestedInactiveCompaniesPer10h = 0;
  let effectiveTotalPer10h = 0;

  for (const slotCompanyId of rawSlots) {
    if (!slotCompanyId) continue;
    if (activeIds.has(slotCompanyId)) {
      requestedByCompanyId[slotCompanyId] += 1;
      effectiveByCompanyId[slotCompanyId] += 1;
      requestedActiveTotalPer10h += 1;
      effectiveTotalPer10h += 1;
    } else {
      requestedInactiveCompaniesPer10h += 1;
    }
  }

  return {
    capPer10h,
    requestedTotalPer10h: requestedActiveTotalPer10h + requestedInactiveCompaniesPer10h,
    requestedActiveTotalPer10h,
    effectiveTotalPer10h,
    overCapPer10h: 0,
    unassignedPer10h: Math.max(0, capPer10h - effectiveTotalPer10h),
    requestedInactiveCompaniesPer10h,
    requestedByCompanyId,
    effectiveByCompanyId,
  };
}

function getStatsForAlloc(alloc) {
  return {
    energy: BASE_STATS.energy + (alloc.energy * LEVEL_GAINS.energy),
    entrepreneurship: BASE_STATS.entrepreneurship + (alloc.entrepreneurship * LEVEL_GAINS.entrepreneurship),
    production: BASE_STATS.production + (alloc.production * LEVEL_GAINS.production),
    companies: BASE_STATS.companies + (alloc.companies * LEVEL_GAINS.companies),
    management: BASE_STATS.management + (alloc.management * LEVEL_GAINS.management),
  };
}

function getActiveCompaniesForAlloc(alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const companiesActive = Math.min(config.configuredCompanies, stats.companies);
  return config.companyConfigs.slice(0, companiesActive);
}

function exactOptimizeEntrePlanForAlloc(alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const bestPlan = {};
  for (const company of activeCompanies) bestPlan[company.id] = 0;

  if (activeCompanies.length === 0 || capPer10h <= 0) {
    const result = simulate(alloc, { ...config, manualPlanOverrideByCompanyId: bestPlan });
    return { checked: 1, bestPlan, bestResult: result, bestScore: objectiveScore(result, config.objective) };
  }

  const working = {};
  for (const company of activeCompanies) working[company.id] = 0;
  let bestResult = null;
  let bestScore = -Infinity;
  let checked = 0;

  function dfs(index, remaining) {
    if (index >= activeCompanies.length) {
      const result = simulate(alloc, { ...config, manualPlanOverrideByCompanyId: working });
      const score = objectiveScore(result, config.objective);
      checked += 1;
      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        for (const company of activeCompanies) {
          bestPlan[company.id] = Math.max(0, Math.floor(Number(working[company.id]) || 0));
        }
      }
      return;
    }
    const company = activeCompanies[index];
    for (let actions = 0; actions <= remaining; actions += 1) {
      working[company.id] = actions;
      dfs(index + 1, remaining - actions);
    }
  }

  dfs(0, capPer10h);
  return { checked, bestPlan, bestResult, bestScore };
}

function heuristicOptimizeEntrePlanForAlloc(alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const bestPlan = {};
  for (const company of activeCompanies) bestPlan[company.id] = 0;

  let checked = 0;
  if (activeCompanies.length > 0 && capPer10h > 0) {
    const ranked = activeCompanies
      .map((company) => {
        checked += 1;
        return { company, score: scoreEntreActionForCompany(company, stats, config) };
      })
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    if (top && Number.isFinite(top.score) && top.score > 0) {
      bestPlan[top.company.id] = capPer10h;
    }
  }

  const bestResult = simulate(alloc, { ...config, manualPlanOverrideByCompanyId: bestPlan });
  const bestScore = objectiveScore(bestResult, config.objective);
  return { checked: Math.max(checked, 1), bestPlan, bestResult, bestScore };
}

function applyEntrePlanToState(planByCompanyId, alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const slots = [];

  for (const company of activeCompanies) {
    const requested = Math.max(0, Math.floor(Number(planByCompanyId?.[company.id]) || 0));
    for (let i = 0; i < requested && slots.length < capPer10h; i += 1) {
      slots.push(company.id);
    }
    if (slots.length >= capPer10h) break;
  }
  while (slots.length < capPer10h) {
    slots.push(null);
  }

  setEntrePlanSlotsState(slots);
}

function simulate(alloc, config) {
  const clampedAlloc = {
    energy: clamp(alloc.energy, 0, MAX_SKILL_LEVEL),
    entrepreneurship: clamp(alloc.entrepreneurship, 0, MAX_SKILL_LEVEL),
    production: clamp(alloc.production, 0, MAX_SKILL_LEVEL),
    companies: clamp(alloc.companies, 0, MAX_SKILL_LEVEL),
    management: clamp(alloc.management, 0, MAX_SKILL_LEVEL),
  };
  const totalSpentPoints = getTotalSpentPoints(clampedAlloc);
  const isAllocationValid = totalSpentPoints <= config.totalSkillPoints;

  const stats = {
    energy: BASE_STATS.energy + (clampedAlloc.energy * LEVEL_GAINS.energy),
    entrepreneurship: BASE_STATS.entrepreneurship + (clampedAlloc.entrepreneurship * LEVEL_GAINS.entrepreneurship),
    production: BASE_STATS.production + (clampedAlloc.production * LEVEL_GAINS.production),
    companies: BASE_STATS.companies + (clampedAlloc.companies * LEVEL_GAINS.companies),
    management: BASE_STATS.management + (clampedAlloc.management * LEVEL_GAINS.management),
  };

  const configuredCompanies = config.configuredCompanies;
  const companiesActive = Math.min(configuredCompanies, stats.companies);
  const inactiveCompanies = Math.max(0, configuredCompanies - companiesActive);
  const activeCompanies = config.companyConfigs.slice(0, companiesActive);

  const energyActionsPerDay = Math.floor(stats.energy / 10) * CYCLES_PER_DAY * config.workUsagePct;
  const entrepreneurshipPlan = buildEntrepreneurshipPlan(
    activeCompanies,
    config.companyConfigs,
    stats,
    config,
    config.manualPlanOverrideByCompanyId || null
  );
  const entreActionsPerDay = entrepreneurshipPlan.effectiveTotalPer10h * CYCLES_PER_DAY * config.entreUsagePct;
  const entreActionsRequestedInactiveCompaniesPer10h = entrepreneurshipPlan.requestedInactiveCompaniesPer10h;

  const workRawPPDay = energyActionsPerDay * stats.production;
  const workPPDay = workRawPPDay;
  const manualCompanyBasePPDay = entreActionsPerDay * stats.production;
  const requestedWorkersActive = activeCompanies.reduce((sum, company) => sum + workerCount(company), 0);
  const workersInInactiveCompanies = config.companyConfigs
    .slice(companiesActive)
    .reduce((sum, company) => sum + workerCount(company), 0);

  const companyCountConfiguredByMaterial = {};
  const companyCountActiveByMaterial = {};
  const companyPPByMaterial = {};
  for (const material of MATERIALS) {
    companyCountConfiguredByMaterial[material.id] = 0;
    companyCountActiveByMaterial[material.id] = 0;
    companyPPByMaterial[material.id] = 0;
  }

  for (const company of config.companyConfigs) {
    companyCountConfiguredByMaterial[company.specialization] += 1;
  }

  let manualCompanyPPDay = 0;
  let employeeRawPPDay = 0;
  let employeePPDay = 0;
  let autoCompanyPPDay = 0;
  let payrollCostDay = 0;
  const companyCards = [];
  let managementRemaining = stats.management;
  let effectiveWorkersActive = 0;

  for (const company of activeCompanies) {
    companyCountActiveByMaterial[company.specialization] += 1;
    const companyWorkers = Array.isArray(company.workers) ? company.workers : [];
    const activeWorkerCount = Math.min(companyWorkers.length, Math.max(0, managementRemaining));
    const activeWorkers = companyWorkers.slice(0, activeWorkerCount);
    const inactiveWorkers = Math.max(0, companyWorkers.length - activeWorkerCount);
    managementRemaining -= activeWorkerCount;
    effectiveWorkersActive += activeWorkerCount;

    const manualActionsRequestedPer10h = entrepreneurshipPlan.requestedByCompanyId[company.id] || 0;
    const manualActionsEffectivePer10h = entrepreneurshipPlan.effectiveByCompanyId[company.id] || 0;
    const manualActionsPerDay = manualActionsEffectivePer10h * CYCLES_PER_DAY * config.entreUsagePct;
    const manualBasePPDay = manualActionsPerDay * stats.production;
    const manualPPDay = manualBasePPDay * bonusMultiplier(company.productionBonusPct);
    let workerRawPPDay = 0;
    let workerPPDay = 0;
    for (const worker of activeWorkers) {
      const actionsPerDay = Math.floor(worker.energyPer10h / 10) * CYCLES_PER_DAY;
      const rawPPDay = actionsPerDay * worker.productionPerAction;
      workerRawPPDay += rawPPDay;
      workerPPDay += rawPPDay
        * bonusMultiplier(company.productionBonusPct)
        * fidelityMultiplier(worker.fidelityPct);
    }
    const aePPDay = AE_RATES[company.aeLevel] || 0;
    const ppBudgetDay = (manualPPDay + aePPDay + workerPPDay) * config.companyUtilizationPct;
    companyPPByMaterial[company.specialization] += ppBudgetDay;

    manualCompanyPPDay += manualPPDay;
    employeeRawPPDay += workerRawPPDay;
    autoCompanyPPDay += aePPDay;
    employeePPDay += workerPPDay;
    payrollCostDay += workerRawPPDay * config.companyUtilizationPct * company.wagePerPP;

    companyCards.push({
      ...company,
      aePPDay,
      effectiveWorkers: activeWorkerCount,
      inactiveWorkers,
      manualActionsRequestedPer10h,
      manualActionsEffectivePer10h,
      manualBasePPDay,
      manualPPDay,
      workerRawPPDay,
      workerPPDay,
      ppBudgetDay,
    });
  }

  const inactiveWorkersDueToManagement = Math.max(0, requestedWorkersActive - effectiveWorkersActive);
  const totalInactiveWorkers = inactiveWorkersDueToManagement + workersInInactiveCompanies;
  const employeesActive = effectiveWorkersActive;
  const companyPPDay = manualCompanyPPDay + autoCompanyPPDay + employeePPDay;

  const inventory = {};
  const producedUnits = {};
  const ppUsedByMaterial = {};
  const ppWastedByMaterial = {};
  const ingredientPurchaseCostByMaterial = {};
  const boughtForProductionByMaterial = {};
  for (const material of MATERIALS) {
    inventory[material.id] = 0;
    producedUnits[material.id] = 0;
    ppUsedByMaterial[material.id] = 0;
    ppWastedByMaterial[material.id] = 0;
    ingredientPurchaseCostByMaterial[material.id] = 0;
    boughtForProductionByMaterial[material.id] = 0;
  }

  const order = getProductionOrder();
  for (const material of order) {
    const budget = companyPPByMaterial[material.id] || 0;
    if (budget <= 0 || material.pp <= 0) {
      continue;
    }

    const ingredientEntries = Object.entries(material.ingredients);
    const byPP = budget / material.pp;
    let produced = byPP;
    if (!Number.isFinite(produced) || produced < 0) produced = 0;

    if (ingredientEntries.length > 0) {
      for (const [ingId, qty] of ingredientEntries) {
        if (qty <= 0) continue;
        const required = produced * qty;
        const available = Math.max(0, inventory[ingId]);
        const consumedFromStock = Math.min(available, required);
        const missingToBuy = Math.max(0, required - consumedFromStock);
        inventory[ingId] -= consumedFromStock;
        boughtForProductionByMaterial[ingId] += missingToBuy;
        ingredientPurchaseCostByMaterial[material.id] += missingToBuy * (config.prices[ingId] || 0);
      }
    }

    inventory[material.id] += produced;
    producedUnits[material.id] += produced;

    const ppUsed = produced * material.pp;
    ppUsedByMaterial[material.id] = ppUsed;
    ppWastedByMaterial[material.id] = Math.max(0, budget - ppUsed);
  }

  const soldUnits = {};
  const consumedInternally = {};
  const revenueByMaterial = {};
  let unitsDay = 0;
  let revenueDay = 0;
  let usedCompanyPPDay = 0;
  let wastedCompanyPPDay = 0;

  for (const material of MATERIALS) {
    soldUnits[material.id] = Math.max(0, inventory[material.id]);
    consumedInternally[material.id] = Math.max(0, producedUnits[material.id] - soldUnits[material.id]);
    revenueByMaterial[material.id] = soldUnits[material.id] * (config.prices[material.id] || 0);

    unitsDay += soldUnits[material.id];
    revenueDay += revenueByMaterial[material.id];
    usedCompanyPPDay += ppUsedByMaterial[material.id];
    wastedCompanyPPDay += ppWastedByMaterial[material.id];
  }

  const companyPPUsedOrWastedDay = usedCompanyPPDay + wastedCompanyPPDay;
  const unusedCompanyPPDay = Math.max(0, companyPPDay - companyPPUsedOrWastedDay);
  let ingredientCostDay = 0;
  for (const material of MATERIALS) {
    ingredientCostDay += ingredientPurchaseCostByMaterial[material.id] || 0;
  }
  const totalPPDay = workPPDay + companyPPDay;
  const unitsHour = unitsDay / 24;

  const workIncomeDay = workRawPPDay * config.ownWagePerPP;
  const netProfitDay = workIncomeDay + revenueDay - payrollCostDay - ingredientCostDay;
  const netProfitHour = netProfitDay / 24;

  const productionBreakdown = order.map((material) => ({
    id: material.id,
    name: material.name,
    companiesConfigured: companyCountConfiguredByMaterial[material.id] || 0,
    companiesActive: companyCountActiveByMaterial[material.id] || 0,
    ppBudgetDay: companyPPByMaterial[material.id] || 0,
    ppUsedDay: ppUsedByMaterial[material.id] || 0,
    ppWastedDay: ppWastedByMaterial[material.id] || 0,
    producedDay: producedUnits[material.id] || 0,
    soldDay: soldUnits[material.id] || 0,
    consumedInternalDay: consumedInternally[material.id] || 0,
    boughtForProductionDay: boughtForProductionByMaterial[material.id] || 0,
    price: config.prices[material.id] || 0,
    revenueDay: revenueByMaterial[material.id] || 0,
  }));

  return {
    isAllocationValid,
    totalSpentPoints,
    skillLevels: { ...clampedAlloc },
    stats,
    companiesActive,
    employeesActive,
    energyActionsPerDay,
    entreActionsPerDay,
    workRawPPDay,
    workPPDay,
    manualCompanyBasePPDay,
    manualCompanyPPDay,
    employeeRawPPDay,
    autoCompanyPPDay,
    employeePPDay,
    companyPPDay,
    usedCompanyPPDay,
    wastedCompanyPPDay,
    unusedCompanyPPDay,
    totalPPDay,
    totalPPHour: totalPPDay / 24,
    workIncomeDay,
    revenueDay,
    ingredientCostDay,
    payrollCostDay,
    netProfitDay,
    netProfitHour,
    unitsDay,
    unitsHour,
    configuredCompanies,
    inactiveCompanies,
    requestedWorkersActive,
    effectiveWorkersActive,
    workersInInactiveCompanies,
    inactiveWorkersDueToManagement,
    totalInactiveWorkers,
    entreActionsCapPer10h: entrepreneurshipPlan.capPer10h,
    entreActionsRequestedPer10h: entrepreneurshipPlan.requestedTotalPer10h,
    entreActionsRequestedActivePer10h: entrepreneurshipPlan.requestedActiveTotalPer10h,
    entreActionsRequestedInactiveCompaniesPer10h,
    entreActionsEffectivePer10h: entrepreneurshipPlan.effectiveTotalPer10h,
    entreActionsOverCapPer10h: entrepreneurshipPlan.overCapPer10h,
    entreActionsUnassignedPer10h: entrepreneurshipPlan.unassignedPer10h,
    companyCards,
    companyPPByMaterial,
    producedUnits,
    soldUnits,
    consumedInternally,
    productionBreakdown,
  };
}

function objectiveScore(result, objectiveKey) {
  const objective = OBJECTIVES[objectiveKey] || OBJECTIVES.netProfitDay;
  return objective.score(result);
}

function estimateSearchVolume(bounds) {
  return SKILL_KEYS.reduce((product, key) => product * (bounds[key] + 1), 1);
}

function exactOptimize(config) {
  const total = config.totalSkillPoints;
  const bounds = getSkillLevelBounds(config, total);

  let checked = 0;
  let bestAlloc = null;
  let bestResult = null;
  let bestScore = -Infinity;
  const working = createEmptyAllocation();

  function searchBySkill(index, usedPoints) {
    if (index >= SKILL_KEYS.length) {
      const alloc = { ...working };
      const result = simulate(alloc, config);
      const score = objectiveScore(result, config.objective);
      checked += 1;

      if (score > bestScore) {
        bestScore = score;
        bestAlloc = alloc;
        bestResult = result;
      }
      return;
    }

    const skill = SKILL_KEYS[index];
    const maxForSkill = Math.min(bounds[skill], maxAffordableLevel(total - usedPoints));
    for (let level = 0; level <= maxForSkill; level += 1) {
      const addedCost = levelCost(level);
      const newUsed = usedPoints + addedCost;
      if (newUsed > total) break;
      working[skill] = level;
      searchBySkill(index + 1, newUsed);
    }
  }

  searchBySkill(0, 0);

  return { method: "exact", checked, bestAlloc, bestResult, bestScore };
}

function randomAllocation(totalPoints, bounds) {
  const alloc = createEmptyAllocation();
  let usedPoints = 0;

  while (true) {
    const candidates = SKILL_KEYS.filter((skill) =>
      alloc[skill] < bounds[skill] && (usedPoints + nextLevelCost(alloc[skill])) <= totalPoints
    );
    if (candidates.length === 0) break;
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    usedPoints += nextLevelCost(alloc[picked]);
    alloc[picked] += 1;
  }

  return alloc;
}

function hillClimbOptimize(config) {
  const total = config.totalSkillPoints;
  const bounds = getSkillLevelBounds(config, total);

  let globalBestAlloc = null;
  let globalBestResult = null;
  let globalBestScore = -Infinity;
  let checked = 0;

  for (let restart = 0; restart < 25; restart += 1) {
    let alloc = randomAllocation(total, bounds);
    let currentResult = simulate(alloc, config);
    let currentScore = objectiveScore(currentResult, config.objective);
    checked += 1;

    let improved = true;
    let safety = 0;

    while (improved && safety < 400) {
      improved = false;
      safety += 1;
      let bestNeighborAlloc = alloc;
      let bestNeighborResult = currentResult;
      let bestNeighborScore = currentScore;
      const usedPoints = getTotalSpentPoints(alloc);

      for (const skill of SKILL_KEYS) {
        if (alloc[skill] < bounds[skill] && (usedPoints + nextLevelCost(alloc[skill])) <= total) {
          const candidate = { ...alloc, [skill]: alloc[skill] + 1 };
          const candidateResult = simulate(candidate, config);
          const candidateScore = objectiveScore(candidateResult, config.objective);
          checked += 1;

          if (candidateScore > bestNeighborScore) {
            bestNeighborAlloc = candidate;
            bestNeighborResult = candidateResult;
            bestNeighborScore = candidateScore;
            improved = true;
          }
        }
      }

      for (const skill of SKILL_KEYS) {
        if (alloc[skill] <= 0) continue;
        const candidate = { ...alloc, [skill]: alloc[skill] - 1 };
        const candidateResult = simulate(candidate, config);
        const candidateScore = objectiveScore(candidateResult, config.objective);
        checked += 1;

        if (candidateScore > bestNeighborScore) {
          bestNeighborAlloc = candidate;
          bestNeighborResult = candidateResult;
          bestNeighborScore = candidateScore;
          improved = true;
        }
      }

      for (const from of SKILL_KEYS) {
        if (alloc[from] <= 0) continue;
        for (const to of SKILL_KEYS) {
          if (from === to) continue;
          if (alloc[to] >= bounds[to]) continue;

          const afterMovePoints = usedPoints - refundFromLevelDecrease(alloc[from]) + nextLevelCost(alloc[to]);
          if (afterMovePoints > total) continue;

          const candidate = { ...alloc };
          candidate[from] -= 1;
          candidate[to] += 1;
          const candidateResult = simulate(candidate, config);
          const candidateScore = objectiveScore(candidateResult, config.objective);
          checked += 1;

          if (candidateScore > bestNeighborScore) {
            bestNeighborAlloc = candidate;
            bestNeighborResult = candidateResult;
            bestNeighborScore = candidateScore;
            improved = true;
          }
        }
      }

      if (improved) {
        alloc = bestNeighborAlloc;
        currentResult = bestNeighborResult;
        currentScore = bestNeighborScore;
      }
    }

    if (currentScore > globalBestScore) {
      globalBestScore = currentScore;
      globalBestAlloc = alloc;
      globalBestResult = currentResult;
    }
  }

  return {
    method: "hill-climb",
    checked,
    bestAlloc: globalBestAlloc,
    bestResult: globalBestResult,
    bestScore: globalBestScore,
  };
}

function optimizeAllocation() {
  const config = getConfigFromInputs();
  const currentAlloc = getAllocationsFromInputs();
  let optimizeSkill = document.getElementById("optimize-skill-toggle")?.checked === true;
  const optimizeEntrePlan = document.getElementById("optimize-entre-plan-toggle")?.checked === true;
  const optimizerStatusEl = document.getElementById("optimizer-status");

  if (!optimizeSkill && !optimizeEntrePlan) {
    optimizerStatusEl.textContent = "Select at least one optimizer target: Skill Allocation or Entrepreneurship Plan.";
    return;
  }

  const fixedAlloc = {
    companies: currentAlloc.companies,
    management: currentAlloc.management,
  };
  const fixedCost = levelCost(fixedAlloc.companies) + levelCost(fixedAlloc.management);
  const remainingPoints = config.totalSkillPoints - fixedCost;

  if (optimizeSkill && remainingPoints < 0) {
    if (!optimizeEntrePlan) {
      optimizerStatusEl.textContent = `Cannot optimize skills. Fixed Companies + Management levels already spend ${fixedCost}, above total points ${config.totalSkillPoints}.`;
      return;
    }
    optimizeSkill = false;
  }

  let checkedSkillAllocs = 0;
  let checkedEntrePlanStates = 0;
  let bestAlloc = null;
  let bestPlanByCompanyId = null;
  let bestResult = null;
  let bestScore = -Infinity;

  const evaluateCandidate = (candidateAlloc, planMethod = null) => {
    checkedSkillAllocs += 1;
    let result = null;
    let planByCompanyId = null;

    if (optimizeEntrePlan) {
      const planResult = planMethod === "exact"
        ? exactOptimizeEntrePlanForAlloc(candidateAlloc, config)
        : heuristicOptimizeEntrePlanForAlloc(candidateAlloc, config);
      checkedEntrePlanStates += planResult.checked;
      result = planResult.bestResult;
      planByCompanyId = planResult.bestPlan;
    } else {
      result = simulate(candidateAlloc, config);
    }

    const score = objectiveScore(result, config.objective);
    if (score > bestScore) {
      bestScore = score;
      bestAlloc = candidateAlloc;
      bestPlanByCompanyId = planByCompanyId;
      bestResult = result;
    }
  };

  if (optimizeSkill) {
    const bounds = {};
    for (const key of OPTIMIZED_SKILL_KEYS) {
      bounds[key] = MAX_SKILL_LEVEL;
    }
    if (config.workUsagePct <= 0) bounds.energy = 0;
    if (config.entreUsagePct <= 0) bounds.entrepreneurship = 0;

    for (let energy = 0; energy <= bounds.energy; energy += 1) {
      for (let entrepreneurship = 0; entrepreneurship <= bounds.entrepreneurship; entrepreneurship += 1) {
        for (let production = 0; production <= bounds.production; production += 1) {
          const optimizeCost = levelCost(energy) + levelCost(entrepreneurship) + levelCost(production);
          if (optimizeCost > remainingPoints) continue;

          const candidateAlloc = {
            energy,
            entrepreneurship,
            production,
            companies: fixedAlloc.companies,
            management: fixedAlloc.management,
          };

          // Use fast plan search inside skill loop to keep optimizer responsive.
          evaluateCandidate(candidateAlloc, optimizeEntrePlan ? "heuristic" : null);
        }
      }
    }
  } else {
    evaluateCandidate(currentAlloc, optimizeEntrePlan ? "exact" : null);
  }

  if (bestAlloc) {
    setAllocationsToInputs(bestAlloc);
  }
  if (optimizeEntrePlan && bestPlanByCompanyId) {
    applyEntrePlanToState(bestPlanByCompanyId, bestAlloc || currentAlloc, config);
    renderCompanyEditor();
  }
  rerenderFromCurrentState();

  const modeLabel = optimizeSkill && optimizeEntrePlan
    ? "skills + entrepreneurship plan"
    : (optimizeSkill ? "skills only" : "entrepreneurship plan only");
  const planMethod = optimizeEntrePlan
    ? (optimizeSkill ? "heuristic inside skill search" : "exact plan search")
    : "not used";
  const fixedInfo = `Fixed: Companies L${fixedAlloc.companies}, Management L${fixedAlloc.management} (cost ${fixedCost}).`;
  optimizerStatusEl.textContent = `Optimizer (${modeLabel}) checked ${checkedSkillAllocs.toLocaleString()} skill allocations and ${checkedEntrePlanStates.toLocaleString()} entrepreneurship-plan states (${planMethod}). ${fixedInfo} Best ${OBJECTIVES[config.objective].label}: ${fmt(bestScore)}.`;
}

function getCompareSlotLabel(slot) {
  return slot === "B" ? "Scenario B" : "Scenario A";
}

function renderReferenceComparison() {
  const toggleBtn = document.getElementById("compare-switch-btn");
  const statusEl = document.getElementById("reference-status");
  if (!toggleBtn || !statusEl) return null;

  const activeSlot = compareState.active === "B" ? "B" : "A";
  const compareSlot = activeSlot === "A" ? "B" : "A";
  const activeSnapshot = normalizeSnapshot(compareState.slots[activeSlot]);
  const compareSnapshot = normalizeSnapshot(compareState.slots[compareSlot]);

  toggleBtn.disabled = !compareSnapshot;
  toggleBtn.textContent = `Switch to ${getCompareSlotLabel(compareSlot)}`;

  if (!compareSnapshot) {
    statusEl.textContent = `${getCompareSlotLabel(activeSlot)} is active and auto-saved on every change.`;
    return null;
  }

  const activeSavedAt = getDisplayTimestamp(activeSnapshot?.savedAt);
  const compareSavedAt = getDisplayTimestamp(compareSnapshot.savedAt);
  statusEl.textContent = `${getCompareSlotLabel(activeSlot)} is active (auto-saved). Comparing against ${getCompareSlotLabel(compareSlot)}. Saved: ${getCompareSlotLabel(activeSlot)} ${activeSavedAt}, ${getCompareSlotLabel(compareSlot)} ${compareSavedAt}.`;

  const compareResult = simulateFromSnapshot(compareSnapshot);
  return compareResult || null;
}

function updatePointsSummary(config, alloc) {
  const summaryEl = document.getElementById("points-summary");
  const warningEl = document.getElementById("allocation-warning");
  const used = getTotalSpentPoints(alloc);
  const costs = getSkillCosts(alloc);
  const remaining = config.totalSkillPoints - used;

  summaryEl.textContent = `Total points: ${config.totalSkillPoints} | Spent: ${used} | Remaining: ${remaining} | Costs -> E:${costs.energy}, Ent:${costs.entrepreneurship}, P:${costs.production}, C:${costs.companies}, M:${costs.management}`;
  if (remaining < 0) {
    warningEl.classList.remove("hidden");
    warningEl.textContent = `Spent points exceed total by ${Math.abs(remaining)}. Lower one or more skill levels.`;
  } else {
    warningEl.classList.add("hidden");
    warningEl.textContent = "";
  }
}

function render(result) {
  renderEntrepreneurshipPlanEditor();
  const config = getConfigFromInputs();
  const alloc = getAllocationsFromInputs();
  updatePointsSummary(config, alloc);

  const capsWarningEl = document.getElementById("caps-warning");
  const companySummaryEl = document.getElementById("company-summary");
  const companyWarningEl = document.getElementById("company-warning");
  const planSummaryEl = document.getElementById("entre-plan-summary");
  const planWarningEl = document.getElementById("entre-plan-warning");
  const capWarnings = [];
  const companyWarnings = [];
  const planWarnings = [];

  if (result.configuredCompanies > result.stats.companies) {
    capWarnings.push(`Configured companies (${result.configuredCompanies}) exceed your companies limit (${result.stats.companies}). Only first ${result.companiesActive} companies are active.`);
  }
  if (result.requestedWorkersActive > result.stats.management) {
    capWarnings.push(`Assigned workers on active companies (${fmt(result.requestedWorkersActive, 2)}) exceed management limit (${result.stats.management}). Extra workers on later companies are inactive.`);
  }
  if (result.entreActionsRequestedInactiveCompaniesPer10h > 0) {
    capWarnings.push(`Entrepreneurship plan includes ${fmt(result.entreActionsRequestedInactiveCompaniesPer10h, 2)} actions/10h on inactive companies. These actions are ignored.`);
    planWarnings.push(`Inactive-company requested actions: ${fmt(result.entreActionsRequestedInactiveCompaniesPer10h, 2)} /10h ignored.`);
  }
  if (result.entreActionsOverCapPer10h > 0) {
    capWarnings.push(`Entrepreneurship plan exceeds cap by ${fmt(result.entreActionsOverCapPer10h, 2)} actions/10h. Extra actions on later companies are ignored.`);
    planWarnings.push(`Over cap by ${fmt(result.entreActionsOverCapPer10h, 2)} actions/10h; trimmed from later companies.`);
  }
  if (result.companiesActive <= 0 && result.entreActionsCapPer10h > 0) {
    capWarnings.push("No active company available for entrepreneurship actions. Entrepreneurship PP from self-work is currently 0.");
  }
  if (!result.isAllocationValid) {
    capWarnings.push("Skill allocation is invalid because spent points are above your available total.");
  }
  if (result.configuredCompanies === 0) {
    companyWarnings.push("No company is configured. Add companies in the setup section.");
  }
  if (result.inactiveCompanies > 0) {
    companyWarnings.push(`${result.inactiveCompanies} last-added companies are inactive due to company limit.`);
  }
  if (result.inactiveWorkersDueToManagement > 0) {
    companyWarnings.push(`${fmt(result.inactiveWorkersDueToManagement, 2)} workers are inactive due to management limit (applied from last-added workers on active companies).`);
  }
  if (result.workersInInactiveCompanies > 0) {
    companyWarnings.push(`${fmt(result.workersInInactiveCompanies, 2)} workers are inactive because their companies are inactive.`);
  }

  companySummaryEl.textContent = `Configured companies: ${result.configuredCompanies} | Active companies: ${result.companiesActive} | Workers(active requested/effective): ${fmt(result.requestedWorkersActive, 2)} / ${fmt(result.effectiveWorkersActive, 2)} | Inactive workers: ${fmt(result.totalInactiveWorkers, 2)} | Entre actions/10h (cap/requested/effective): ${fmt(result.entreActionsCapPer10h, 2)} / ${fmt(result.entreActionsRequestedPer10h, 2)} / ${fmt(result.entreActionsEffectivePer10h, 2)}`;
  if (planSummaryEl) {
    planSummaryEl.textContent = `Entre actions / 10h | Cap: ${fmt(result.entreActionsCapPer10h, 2)} | Requested: ${fmt(result.entreActionsRequestedPer10h, 2)} (Active ${fmt(result.entreActionsRequestedActivePer10h, 2)} + Inactive ${fmt(result.entreActionsRequestedInactiveCompaniesPer10h, 2)}) | Effective: ${fmt(result.entreActionsEffectivePer10h, 2)} | Unassigned: ${fmt(result.entreActionsUnassignedPer10h, 2)}`;
  }
  if (planWarningEl) {
    if (planWarnings.length > 0) {
      planWarningEl.classList.remove("hidden");
      planWarningEl.textContent = planWarnings.join(" ");
    } else {
      planWarningEl.classList.add("hidden");
      planWarningEl.textContent = "";
    }
  }
  if (companyWarnings.length > 0) {
    companyWarningEl.classList.remove("hidden");
    companyWarningEl.textContent = companyWarnings.join(" ");
  } else {
    companyWarningEl.classList.add("hidden");
    companyWarningEl.textContent = "";
  }

  if (capWarnings.length > 0) {
    capsWarningEl.classList.remove("hidden");
    capsWarningEl.textContent = capWarnings.join(" ");
  } else {
    capsWarningEl.classList.add("hidden");
    capsWarningEl.textContent = "";
  }

  const referenceResult = renderReferenceComparison();

  const resultGrid = document.getElementById("result-grid");
  const costs = getSkillCosts(result.skillLevels);
  const referenceCosts = referenceResult ? getSkillCosts(referenceResult.skillLevels) : null;
  const productionRows = result.productionBreakdown
    .filter((item) => item.companiesConfigured > 0 || item.producedDay > 0 || item.soldDay > 0 || item.boughtForProductionDay > 0)
    .map((item) => `
      <tr>
        <td><img class="item-icon" src="${getItemImagePath(item.id)}" alt="${item.name} icon"></td>
        <td>${item.name}</td>
        <td class="mono">${item.companiesActive}/${item.companiesConfigured}</td>
        <td class="mono">${fmt(item.producedDay, 2)}</td>
        <td class="mono">${fmt(item.consumedInternalDay, 2)}</td>
        <td class="mono">${fmt(item.boughtForProductionDay, 2)}</td>
        <td class="mono">${fmt(item.soldDay, 2)}</td>
        <td class="mono">${fmt(item.revenueDay, 2)}</td>
      </tr>
    `)
    .join("");

  resultGrid.innerHTML = `
    <article class="card">
      <h3>Skill Levels</h3>
      <p>Energy Level: <span class="mono">${result.skillLevels.energy}</span>${deltaSuffix(result.skillLevels.energy, referenceResult?.skillLevels.energy, 0)} (Cost <span class="mono">${costs.energy}</span>${deltaSuffix(costs.energy, referenceCosts?.energy, 0)})</p>
      <p>Entrepreneurship Level: <span class="mono">${result.skillLevels.entrepreneurship}</span>${deltaSuffix(result.skillLevels.entrepreneurship, referenceResult?.skillLevels.entrepreneurship, 0)} (Cost <span class="mono">${costs.entrepreneurship}</span>${deltaSuffix(costs.entrepreneurship, referenceCosts?.entrepreneurship, 0)})</p>
      <p>Production Level: <span class="mono">${result.skillLevels.production}</span>${deltaSuffix(result.skillLevels.production, referenceResult?.skillLevels.production, 0)} (Cost <span class="mono">${costs.production}</span>${deltaSuffix(costs.production, referenceCosts?.production, 0)})</p>
      <p>Companies Level: <span class="mono">${result.skillLevels.companies}</span>${deltaSuffix(result.skillLevels.companies, referenceResult?.skillLevels.companies, 0)} (Cost <span class="mono">${costs.companies}</span>${deltaSuffix(costs.companies, referenceCosts?.companies, 0)})</p>
      <p>Management Level: <span class="mono">${result.skillLevels.management}</span>${deltaSuffix(result.skillLevels.management, referenceResult?.skillLevels.management, 0)} (Cost <span class="mono">${costs.management}</span>${deltaSuffix(costs.management, referenceCosts?.management, 0)})</p>
      <p>Spent Points: <span class="mono">${result.totalSpentPoints}</span>${deltaSuffix(result.totalSpentPoints, referenceResult?.totalSpentPoints, 0)}</p>
    </article>
    <article class="card">
      <h3>Derived Stats</h3>
      <p>Energy Bar: <span class="mono">${result.stats.energy}</span>${deltaSuffix(result.stats.energy, referenceResult?.stats.energy, 0)}</p>
      <p>Entrepreneurship Bar: <span class="mono">${result.stats.entrepreneurship}</span>${deltaSuffix(result.stats.entrepreneurship, referenceResult?.stats.entrepreneurship, 0)}</p>
      <p>Production / Action: <span class="mono">${result.stats.production}</span>${deltaSuffix(result.stats.production, referenceResult?.stats.production, 0)}</p>
      <p>Companies Limit: <span class="mono">${result.stats.companies}</span>${deltaSuffix(result.stats.companies, referenceResult?.stats.companies, 0)}</p>
      <p>Management Limit: <span class="mono">${result.stats.management}</span>${deltaSuffix(result.stats.management, referenceResult?.stats.management, 0)}</p>
    </article>
    <article class="card">
      <h3>PP Flow</h3>
      <p>Work PP / Day: <span class="mono">${fmt(result.workPPDay)}</span>${deltaSuffix(result.workPPDay, referenceResult?.workPPDay)}</p>
      <p>Entre Actions / 10h (Cap | Requested | Effective): <span class="mono">${fmt(result.entreActionsCapPer10h, 2)} | ${fmt(result.entreActionsRequestedPer10h, 2)} | ${fmt(result.entreActionsEffectivePer10h, 2)}</span></p>
      <p>Manual Company PP / Day (base -> boosted): <span class="mono">${fmt(result.manualCompanyBasePPDay)} -> ${fmt(result.manualCompanyPPDay)}</span>${deltaSuffix(result.manualCompanyPPDay, referenceResult?.manualCompanyPPDay)}</p>
      <p>AE Company PP / Day: <span class="mono">${fmt(result.autoCompanyPPDay)}</span>${deltaSuffix(result.autoCompanyPPDay, referenceResult?.autoCompanyPPDay)}</p>
      <p>Employee PP / Day (raw -> boosted): <span class="mono">${fmt(result.employeeRawPPDay)} -> ${fmt(result.employeePPDay)}</span>${deltaSuffix(result.employeePPDay, referenceResult?.employeePPDay)}</p>
      <p>Company PP / Day: <span class="mono">${fmt(result.companyPPDay)}</span>${deltaSuffix(result.companyPPDay, referenceResult?.companyPPDay)}</p>
      <p>Used Company PP / Day: <span class="mono">${fmt(result.usedCompanyPPDay)}</span>${deltaSuffix(result.usedCompanyPPDay, referenceResult?.usedCompanyPPDay)}</p>
      <p>Wasted Company PP / Day: <span class="mono">${fmt(result.wastedCompanyPPDay)}</span>${deltaSuffix(result.wastedCompanyPPDay, referenceResult?.wastedCompanyPPDay)}</p>
      <p>Idle Company PP / Day: <span class="mono">${fmt(result.unusedCompanyPPDay)}</span>${deltaSuffix(result.unusedCompanyPPDay, referenceResult?.unusedCompanyPPDay)}</p>
      <p>Total PP / Day: <span class="mono">${fmt(result.totalPPDay)}</span>${deltaSuffix(result.totalPPDay, referenceResult?.totalPPDay)}</p>
      <p>Total PP / Hour: <span class="mono">${fmt(result.totalPPHour)}</span>${deltaSuffix(result.totalPPHour, referenceResult?.totalPPHour)}</p>
    </article>
    <article class="card">
      <h3>Production</h3>
      <p>Total Sellable Units / Day: <span class="mono">${fmt(result.unitsDay)}</span>${deltaSuffix(result.unitsDay, referenceResult?.unitsDay)}</p>
      <p>Total Sellable Units / Hour: <span class="mono">${fmt(result.unitsHour)}</span>${deltaSuffix(result.unitsHour, referenceResult?.unitsHour)}</p>
      <div class="table-wrap">
        <table class="prod-table">
          <thead>
            <tr>
              <th>Icon</th>
              <th>Item</th>
              <th>Factories A/C</th>
              <th>Produced/Day</th>
              <th>Used Internally</th>
              <th>Bought for Production</th>
              <th>Sold/Day</th>
              <th>Revenue/Day</th>
            </tr>
          </thead>
          <tbody>
            ${productionRows || `<tr><td colspan="8">No production configured.</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
    <article class="card">
      <h3>Profit</h3>
      <p>Work Wage Income / Day (raw PP): <span class="mono">${fmt(result.workIncomeDay)}</span>${deltaSuffix(result.workIncomeDay, referenceResult?.workIncomeDay)}</p>
      <p>Sales Revenue / Day: <span class="mono">${fmt(result.revenueDay)}</span>${deltaSuffix(result.revenueDay, referenceResult?.revenueDay)}</p>
      <p>Market Ingredient Cost / Day: <span class="mono">${fmt(result.ingredientCostDay)}</span>${deltaSuffix(result.ingredientCostDay, referenceResult?.ingredientCostDay)}</p>
      <p>Employee Payroll / Day (raw PP): <span class="mono">${fmt(result.payrollCostDay)}</span>${deltaSuffix(result.payrollCostDay, referenceResult?.payrollCostDay)}</p>
      <p>Net Profit / Day: <span class="mono">${fmt(result.netProfitDay)}</span>${deltaSuffix(result.netProfitDay, referenceResult?.netProfitDay)}</p>
      <p>Net Profit / Hour: <span class="mono">${fmt(result.netProfitHour)}</span>${deltaSuffix(result.netProfitHour, referenceResult?.netProfitHour)}</p>
    </article>
  `;
}

function saveState() {
  const state = {
    config: {
      level: document.getElementById("level").value,
      workUsage: document.getElementById("work-usage").value,
      entreUsage: document.getElementById("entre-usage").value,
      companyUtilization: document.getElementById("company-utilization").value,
      ownWage: document.getElementById("own-wage").value,
      optimizeSkill: document.getElementById("optimize-skill-toggle")?.checked !== false,
      optimizeEntrePlan: document.getElementById("optimize-entre-plan-toggle")?.checked === true,
      entrePlanSlots: getEntrePlanSlotsState(),
      objective: document.getElementById("objective").value,
    },
    alloc: getAllocationsFromInputs(),
    prices: getPrices(),
    companyConfigs: getCompanyConfigs(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    const c = parsed.config || {};
    const a = parsed.alloc || {};
    const p = parsed.prices || {};
    const savedCompanyConfigs = parsed.companyConfigs;

    const maybeSet = (id, value) => {
      if (value === undefined || value === null) return;
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    const maybeSetSkillLevel = (id, value) => {
      if (value === undefined || value === null) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = clamp(Math.floor(Number(value) || 0), 0, MAX_SKILL_LEVEL);
    };

    maybeSet("level", c.level);
    const hasLegacyEmployeePPDay = c.employeePPDay !== undefined && c.employeePPDay !== null && c.employeePPDay !== "";
    const legacyEmployeePPDay = Math.max(0, Number(c.employeePPDay) || 0);
    const legacyEmployeeEnergy10h = Math.max(0, Number(c.employeeEnergy10h ?? 100) || 0);
    const legacyActionsPerDay = Math.max(1, Math.floor(legacyEmployeeEnergy10h / 10) * CYCLES_PER_DAY);
    const legacyEmployeeProductionValue = c.employeeProductionCapacity ?? c.employeeProductionPerAction;
    const legacyEmployeeProductionPerAction = legacyEmployeeProductionValue !== undefined && legacyEmployeeProductionValue !== null && legacyEmployeeProductionValue !== ""
      ? Math.max(0, Number(legacyEmployeeProductionValue) || 0)
      : (hasLegacyEmployeePPDay ? Math.max(0, legacyEmployeePPDay / legacyActionsPerDay) : 31);
    const companyDefaults = {
      employeeEnergyPer10h: legacyEmployeeEnergy10h,
      employeeProductionPerAction: legacyEmployeeProductionPerAction,
    };
    maybeSet("work-usage", c.workUsage);
    maybeSet("entre-usage", c.entreUsage);
    maybeSet("company-utilization", c.companyUtilization);
    maybeSet("own-wage", c.ownWage);
    maybeSet("objective", c.objective);
    const optimizeSkillToggle = document.getElementById("optimize-skill-toggle");
    const optimizeEntrePlanToggle = document.getElementById("optimize-entre-plan-toggle");
    if (optimizeSkillToggle) optimizeSkillToggle.checked = c.optimizeSkill !== false;
    if (optimizeEntrePlanToggle) optimizeEntrePlanToggle.checked = c.optimizeEntrePlan === true;
    if (!OBJECTIVES[document.getElementById("objective").value]) {
      document.getElementById("objective").value = "netProfitDay";
    }

    maybeSetSkillLevel("alloc-energy", a.energy);
    maybeSetSkillLevel("alloc-entrepreneurship", a.entrepreneurship);
    maybeSetSkillLevel("alloc-production", a.production);
    maybeSetSkillLevel("alloc-companies", a.companies);
    maybeSetSkillLevel("alloc-management", a.management);

    for (const material of MATERIALS) {
      maybeSet(`price-${material.id}`, p[material.id]);
    }

    if (Array.isArray(savedCompanyConfigs) && savedCompanyConfigs.length > 0) {
      setCompanyConfigs(savedCompanyConfigs, companyDefaults);
    } else {
      setCompanyConfigs([createDefaultCompanyConfig("iron"), createDefaultCompanyConfig("steel")]);
    }

    const savedSlots = sanitizeEntrePlanSlots(c.entrePlanSlots);
    if (savedSlots.length > 0) {
      setEntrePlanSlotsState(savedSlots);
    } else {
      const allocNow = getAllocationsFromInputs();
      const statsNow = getStatsForAlloc(allocNow);
      const activeNow = getActiveCompaniesForAlloc(allocNow, {
        configuredCompanies: companyConfigsState.length,
        companyConfigs: getCompanyConfigs(),
      });
      const capNow = Math.max(0, Math.floor(statsNow.entrepreneurship / 10));
      const derivedSlots = [];
      for (const company of activeNow) {
        const count = Math.max(0, Math.floor(Number(company.manualActionsPer10h) || 0));
        for (let i = 0; i < count && derivedSlots.length < capNow; i += 1) {
          derivedSlots.push(company.id);
        }
      }
      while (derivedSlots.length < capNow) derivedSlots.push(null);
      setEntrePlanSlotsState(derivedSlots);
    }
  } catch (err) {
    console.error("Failed to load saved state:", err);
    setCompanyConfigs([createDefaultCompanyConfig("iron"), createDefaultCompanyConfig("steel")]);
    setEntrePlanSlotsState([]);
  }
}

function buildMaterialInputs() {
  const priceGrid = document.getElementById("price-grid");
  priceGrid.innerHTML = MATERIALS.map((m) => `
    <label class="price-row">
      <img class="item-icon" src="${getItemImagePath(m.id)}" alt="${m.name} icon" loading="lazy">
      <span>${m.name} Price</span>
      <div class="price-input-wrap">
        <input id="price-${m.id}" type="number" min="0" step="0.01" value="1">
      </div>
    </label>
  `).join("");
}

function syncEntrePlanSlotsForCurrentContext(config, alloc) {
  const stats = getStatsForAlloc(alloc);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const activeIds = new Set(activeCompanies.map((company) => company.id));
  const currentSlots = getEntrePlanSlotsState();
  const nextSlots = [];

  for (let i = 0; i < capPer10h; i += 1) {
    const currentId = currentSlots[i];
    nextSlots.push(currentId && activeIds.has(currentId) ? currentId : null);
  }

  setEntrePlanSlotsState(nextSlots);
  return { capPer10h, activeCompanies, slots: nextSlots };
}

function renderEntrepreneurshipPlanEditor() {
  const editorEl = document.getElementById("entre-plan-editor");
  if (!editorEl) return;

  const config = getConfigFromInputs();
  const alloc = getAllocationsFromInputs();
  const { capPer10h, activeCompanies, slots } = syncEntrePlanSlotsForCurrentContext(config, alloc);

  if (capPer10h <= 0) {
    editorEl.innerHTML = `<p class="hint worker-empty">No entrepreneurship actions available per 10h at current skill level.</p>`;
    return;
  }

  if (activeCompanies.length === 0) {
    editorEl.innerHTML = `<p class="hint worker-empty">No active company available. Increase Companies Limit skill or reduce configured companies.</p>`;
    return;
  }

  editorEl.innerHTML = slots.map((companyId, index) => {
    return `
      <div class="entre-plan-row">
        <span class="entre-plan-company mono">Action ${index + 1}</span>
        <select data-action="set-plan-slot" data-slot-index="${index}">
          <option value="">Skip</option>
          ${activeCompanies.map((company, activeIndex) => {
            const material = MATERIAL_MAP.get(company.specialization) || MATERIALS[0];
            const selected = company.id === companyId ? "selected" : "";
            const displayIndex = companyConfigsState.findIndex((c) => c.id === company.id) + 1;
            const labelIndex = displayIndex > 0 ? displayIndex : (activeIndex + 1);
            return `<option value="${company.id}" ${selected}>Company ${labelIndex} (${material.name})</option>`;
          }).join("")}
        </select>
      </div>
    `;
  }).join("");
}

function renderCompanyEditor() {
  const editorEl = document.getElementById("companies-editor");
  if (!editorEl) return;

  editorEl.innerHTML = companyConfigsState.map((company, index) => {
    const material = MATERIAL_MAP.get(company.specialization) || MATERIALS[0];
    const workers = Array.isArray(company.workers) ? company.workers : [];
    const workersMarkup = workers.length === 0
      ? `<p class="hint worker-empty">No workers added yet.</p>`
      : `
        <div class="worker-grid-head">
          <span class="mono">#</span>
          <span>E / 10h</span>
          <span>P / Act</span>
          <span>Fidelity</span>
          <span></span>
        </div>
        ${workers.map((worker, workerIndex) => `
          <div class="worker-grid-row">
            <span class="worker-no mono">${workerIndex + 1}</span>
            <input type="number" min="0" step="1" value="${worker.energyPer10h}" data-action="set-worker-energy" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Energy per 10h">
            <input type="number" min="0" step="0.1" value="${worker.productionPerAction}" data-action="set-worker-production" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Production per Action">
            <input type="number" min="0" max="10" step="0.1" value="${worker.fidelityPct}" data-action="set-worker-fidelity" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Fidelity Percent">
            <button type="button" class="inline-btn worker-remove-btn" data-action="remove-worker" data-company-id="${company.id}" data-worker-index="${workerIndex}">Remove</button>
          </div>
        `).join("")}
      `;

    return `
      <article class="company-card" data-company-id="${company.id}">
        <div class="company-head">
          <h3>Company ${index + 1}</h3>
          <button type="button" class="inline-btn" data-action="remove-company" data-company-id="${company.id}">Remove</button>
        </div>
        <label>
          Specialization
          <select class="spec-select" style="background-image: url('${getItemImagePath(material.id)}');" data-action="set-specialization" data-company-id="${company.id}">
            ${MATERIALS.map((m) => `<option value="${m.id}" ${m.id === company.specialization ? "selected" : ""}>${m.name}</option>`).join("")}
          </select>
        </label>
        <label>
          Company AE Level
          <select data-action="set-ae" data-company-id="${company.id}">
            ${Object.entries(AE_RATES).map(([level, rate]) => `<option value="${level}" ${Number(level) === company.aeLevel ? "selected" : ""}>AE ${level} (${rate}/day)</option>`).join("")}
          </select>
        </label>
        <label>
          Production Bonus (%)
          <input type="number" min="0" step="0.1" value="${company.productionBonusPct}" data-action="set-company-bonus" data-company-id="${company.id}">
        </label>
        <div class="worker-row">
          <span>Workers: <span class="mono">${workers.length}</span></span>
          <button type="button" class="inline-btn" data-action="add-worker" data-company-id="${company.id}">+ Add Worker</button>
        </div>
        <div class="worker-list">${workersMarkup}</div>
        <label>
          Worker Wage / PP
          <input type="number" min="0" step="0.01" value="${company.wagePerPP}" data-action="set-wage" data-company-id="${company.id}">
        </label>
      </article>
    `;
  }).join("");

  renderEntrepreneurshipPlanEditor();
}

function rerenderFromCurrentState() {
  const result = simulate(getAllocationsFromInputs(), getConfigFromInputs());
  render(result);
  saveState();
  saveCurrentToActiveCompareSlot();
}

function saveCurrentToActiveCompareSlot() {
  const snapshot = captureSnapshotFromInputs();
  if (!snapshot) return;

  const activeSlot = compareState.active === "B" ? "B" : "A";
  const otherSlot = activeSlot === "A" ? "B" : "A";
  compareState.active = activeSlot;
  compareState.slots[activeSlot] = snapshot;
  if (!compareState.slots[otherSlot]) {
    compareState.slots[otherSlot] = snapshot;
  }
  saveCompareState();
}

function switchCompareScenario() {
  saveCurrentToActiveCompareSlot();

  const targetSlot = compareState.active === "A" ? "B" : "A";
  const targetSnapshot = compareState.slots[targetSlot];
  compareState.active = targetSlot;

  if (targetSnapshot) {
    applySnapshotToInputs(targetSnapshot, false);
  }

  saveCompareState();
  rerenderFromCurrentState();
}

async function syncPricesFromApi() {
  const button = document.getElementById("sync-prices-btn");
  const statusEl = document.getElementById("price-sync-status");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Syncing...";
  statusEl.textContent = "Fetching latest prices from WarEra API...";

  try {
    const response = await fetch(PRICE_API_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const apiData = payload?.result?.data;
    if (!apiData || typeof apiData !== "object") {
      throw new Error("Unexpected API response format.");
    }

    let updated = 0;
    const missing = [];

    for (const material of MATERIALS) {
      const apiKeys = getApiKeysForMaterial(material.id);
      const value = apiKeys.map((key) => apiData[key]).find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
      if (typeof value === "number" && Number.isFinite(value)) {
        const input = document.getElementById(`price-${material.id}`);
        if (input) {
          input.value = String(value);
          updated += 1;
        }
      } else {
        missing.push(material.name);
      }
    }

    rerenderFromCurrentState();

    const timestamp = new Date().toLocaleString();
    statusEl.textContent = `Synced ${updated} prices at ${timestamp}.${missing.length ? ` Missing in API: ${missing.join(", ")}.` : ""}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Price sync failed: ${message}`;
    console.error("Price sync failed:", err);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function bindEvents() {
  const inputIds = [
    "level",
    "alloc-energy",
    "alloc-entrepreneurship",
    "alloc-production",
    "alloc-companies",
    "alloc-management",
    "objective",
    "work-usage",
    "entre-usage",
    "company-utilization",
    "own-wage",
    "optimize-skill-toggle",
    "optimize-entre-plan-toggle",
    ...MATERIALS.map((m) => `price-${m.id}`),
  ];

  for (const id of inputIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", () => {
      rerenderFromCurrentState();
    });
    el.addEventListener("change", () => {
      rerenderFromCurrentState();
    });
  }

  const companiesEditorEl = document.getElementById("companies-editor");
  companiesEditorEl.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;

    const action = target.dataset.action;
    const companyId = Number(target.dataset.companyId);
    const idx = companyConfigsState.findIndex((company) => company.id === companyId);

    if (action === "remove-company") {
      if (idx >= 0) {
        companyConfigsState.splice(idx, 1);
        renderCompanyEditor();
        rerenderFromCurrentState();
      }
      return;
    }

    if (idx < 0) return;
    const company = companyConfigsState[idx];

    if (action === "add-worker") {
      if (!Array.isArray(company.workers)) company.workers = [];
      company.workers.push(createDefaultWorkerConfig());
      renderCompanyEditor();
      rerenderFromCurrentState();
      return;
    }

    if (action === "remove-worker") {
      const workerIndex = Math.max(0, Math.floor(Number(target.dataset.workerIndex) || 0));
      if (!Array.isArray(company.workers)) company.workers = [];
      if (workerIndex < company.workers.length) {
        company.workers.splice(workerIndex, 1);
      }
      renderCompanyEditor();
      rerenderFromCurrentState();
    }
  });

  companiesEditorEl.addEventListener("change", (event) => {
    const changed = event.target.closest("[data-action='set-wage'], [data-action='set-ae'], [data-action='set-specialization'], [data-action='set-company-bonus'], [data-action='set-worker-fidelity'], [data-action='set-worker-energy'], [data-action='set-worker-production']");
    if (!changed) return;
    const companyId = Number(changed.dataset.companyId);
    const idx = companyConfigsState.findIndex((company) => company.id === companyId);
    if (idx < 0) return;
    const company = companyConfigsState[idx];
    const workerIndex = Math.max(0, Math.floor(Number(changed.dataset.workerIndex) || 0));
    const workerActions = ["set-worker-fidelity", "set-worker-energy", "set-worker-production"];

    if (changed.dataset.action === "set-wage") {
      company.wagePerPP = Math.max(0, Number(changed.value) || 0);
    } else if (changed.dataset.action === "set-ae") {
      company.aeLevel = clamp(Math.floor(Number(changed.value) || 1), 1, 7);
    } else if (changed.dataset.action === "set-specialization") {
      company.specialization = MATERIAL_MAP.has(changed.value) ? changed.value : company.specialization;
    } else if (changed.dataset.action === "set-company-bonus") {
      company.productionBonusPct = Math.max(0, Number(changed.value) || 0);
    } else if (changed.dataset.action === "set-worker-fidelity") {
      if (!Array.isArray(company.workers) || !company.workers[workerIndex]) return;
      company.workers[workerIndex].fidelityPct = clamp(Number(changed.value) || 0, 0, 10);
    } else if (changed.dataset.action === "set-worker-energy") {
      if (!Array.isArray(company.workers) || !company.workers[workerIndex]) return;
      company.workers[workerIndex].energyPer10h = Math.max(0, Number(changed.value) || 0);
    } else if (changed.dataset.action === "set-worker-production") {
      if (!Array.isArray(company.workers) || !company.workers[workerIndex]) return;
      company.workers[workerIndex].productionPerAction = Math.max(0, Number(changed.value) || 0);
    }
    if (changed.dataset.action === "set-specialization" || changed.dataset.action === "set-company-bonus" || workerActions.includes(changed.dataset.action)) {
      renderCompanyEditor();
    }
    rerenderFromCurrentState();
  });

  const planEditorEl = document.getElementById("entre-plan-editor");
  planEditorEl.addEventListener("input", (event) => {
    const changed = event.target.closest("[data-action='set-plan-slot']");
    if (!changed) return;
    const slotIndex = Math.max(0, Math.floor(Number(changed.dataset.slotIndex) || 0));
    const slots = getEntrePlanSlotsState();
    const companyId = Math.floor(Number(changed.value));
    slots[slotIndex] = Number.isInteger(companyId) && companyId > 0 ? companyId : null;
    setEntrePlanSlotsState(slots);
    rerenderFromCurrentState();
  });
  planEditorEl.addEventListener("change", (event) => {
    const changed = event.target.closest("[data-action='set-plan-slot']");
    if (!changed) return;
    const slotIndex = Math.max(0, Math.floor(Number(changed.dataset.slotIndex) || 0));
    const slots = getEntrePlanSlotsState();
    const companyId = Math.floor(Number(changed.value));
    slots[slotIndex] = Number.isInteger(companyId) && companyId > 0 ? companyId : null;
    setEntrePlanSlotsState(slots);
    rerenderFromCurrentState();
  });

  document.getElementById("company-add-btn").addEventListener("click", () => {
    companyConfigsState.push(createDefaultCompanyConfig());
    renderCompanyEditor();
    rerenderFromCurrentState();
  });

  document.getElementById("company-remove-btn").addEventListener("click", () => {
    if (companyConfigsState.length === 0) return;
    companyConfigsState.pop();
    renderCompanyEditor();
    rerenderFromCurrentState();
  });

  document.getElementById("optimize-btn").addEventListener("click", optimizeAllocation);
  document.getElementById("sync-prices-btn").addEventListener("click", () => {
    syncPricesFromApi();
  });
  document.getElementById("compare-switch-btn").addEventListener("click", switchCompareScenario);
}

function init() {
  buildMaterialInputs();
  setCompanyConfigs([createDefaultCompanyConfig("iron"), createDefaultCompanyConfig("steel")]);
  loadState();
  loadCompareState();
  applySnapshotToInputs(compareState.slots[compareState.active], false);
  renderCompanyEditor();
  bindEvents();

  rerenderFromCurrentState();
  syncPricesFromApi();
}

init();
