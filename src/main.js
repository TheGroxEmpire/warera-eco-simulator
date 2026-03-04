import {
  COMPARE_STORAGE_KEY,
  CYCLES_PER_DAY,
  DEFAULT_OBJECTIVE_KEY,
  LEGACY_REFERENCE_STORAGE_KEY,
  MATERIALS,
  MAX_SKILL_LEVEL,
  OBJECTIVES,
  PRICE_API_URL,
  STORAGE_KEY,
} from "./config/constants.js";
import {
  buildEntrePlanSlotsFromPlan,
  getActiveCompaniesForAlloc,
  getApiKeysForMaterial,
  getStatsForAlloc,
  sanitizeEntrePlanSlots,
  simulate,
} from "./core/simulation.js";
import { fmt } from "./core/math.js";
import { optimizeAllocationAndPlan } from "./core/optimizer.js";
import { createCompanyState } from "./state/company-state.js";
import { createEditorUI } from "./ui/editor.js";
import { bindEvents as bindUiEvents } from "./ui/events.js";
import { createResultsRenderer } from "./ui/results.js";

let compareState = {
  active: "A",
  slots: { A: null, B: null },
};
const companyState = createCompanyState();
const {
  createDefaultWorkerConfig,
  workerCount,
  createDefaultCompanyConfig,
  sanitizeCompanyConfig,
  setCompanyConfigs,
  getCompanyConfigs,
  getCompanyConfigsMutable,
  getEntrePlanSlotsState,
  setEntrePlanSlotsState,
} = companyState;
let editorUI = null;
let resultsRenderer = null;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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
  const objective = OBJECTIVES[config.objective] ? config.objective : DEFAULT_OBJECTIVE_KEY;
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
    objective: OBJECTIVES[snapshot?.config?.objective] ? snapshot.config.objective : DEFAULT_OBJECTIVE_KEY,
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

function applyEntrePlanToState(planByCompanyId, alloc, config) {
  const slots = buildEntrePlanSlotsFromPlan(planByCompanyId, alloc, config);
  setEntrePlanSlotsState(slots);
}

function optimizeAllocation() {
  const config = getConfigFromInputs();
  const currentAlloc = getAllocationsFromInputs();
  const optimizeSkill = document.getElementById("optimize-skill-toggle")?.checked === true;
  const optimizeEntrePlan = document.getElementById("optimize-entre-plan-toggle")?.checked === true;
  const optimizerStatusEl = document.getElementById("optimizer-status");

  const optimization = optimizeAllocationAndPlan({
    config,
    currentAlloc,
    optimizeSkill,
    optimizeEntrePlan,
  });

  if (optimization.error) {
    optimizerStatusEl.textContent = optimization.error;
    return;
  }

  if (optimization.bestAlloc) {
    setAllocationsToInputs(optimization.bestAlloc);
  }
  if (optimizeEntrePlan && optimization.bestPlanByCompanyId) {
    applyEntrePlanToState(optimization.bestPlanByCompanyId, optimization.bestAlloc || currentAlloc, config);
    renderCompanyEditor();
  }

  rerenderFromCurrentState();

  const fixedInfo = `Fixed: Companies L${optimization.fixedAlloc.companies}, Management L${optimization.fixedAlloc.management} (cost ${optimization.fixedCost}).`;
  optimizerStatusEl.textContent = `Optimizer (${optimization.modeLabel}) checked ${optimization.checkedSkillAllocs.toLocaleString()} skill allocations and ${optimization.checkedEntrePlanStates.toLocaleString()} entrepreneurship-plan states (${optimization.planMethod}). ${fixedInfo} Best ${optimization.objectiveLabel}: ${fmt(optimization.bestScore)}.`;
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

function render(result) {
  resultsRenderer?.render(result);
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
      document.getElementById("objective").value = DEFAULT_OBJECTIVE_KEY;
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
        configuredCompanies: getCompanyConfigsMutable().length,
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
  editorUI?.buildMaterialInputs();
}

function renderEntrepreneurshipPlanEditor() {
  editorUI?.renderEntrepreneurshipPlanEditor();
}

function renderCompanyEditor() {
  editorUI?.renderCompanyEditor();
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
  bindUiEvents({
    getCompanyConfigsMutable,
    createDefaultWorkerConfig,
    createDefaultCompanyConfig,
    getEntrePlanSlotsState,
    setEntrePlanSlotsState,
    renderCompanyEditor,
    rerenderFromCurrentState,
    optimizeAllocation,
    syncPricesFromApi,
    switchCompareScenario,
  });
}

function init() {
  editorUI = createEditorUI({
    getConfigFromInputs,
    getAllocationsFromInputs,
    getCompanyConfigsMutable,
    getEntrePlanSlotsState,
    setEntrePlanSlotsState,
  });
  resultsRenderer = createResultsRenderer({
    getConfigFromInputs,
    getAllocationsFromInputs,
    renderEntrepreneurshipPlanEditor,
    getReferenceResult: renderReferenceComparison,
  });

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
