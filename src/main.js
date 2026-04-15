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
} from "./config/constants.js?v=20260330-09";
import {
  buildEntrePlanSlotsFromPlan,
  getActiveCompaniesForAlloc,
  getApiKeysForMaterial,
  getStatsForAlloc,
  sanitizeEntrePlanSlots,
  simulate,
} from "./core/simulation.js?v=20260330-09";
import { fmt } from "./core/math.js?v=20260330-09";
import { optimizeAllocationAndPlan } from "./core/optimizer.js?v=20260330-09";
import { importWareraUserData } from "./integrations/warera-import.js?v=20260330-09";
import {
  copySnapshotToOtherCompareSlot,
  getOtherCompareSlot,
  getPriceSyncSummary,
  updateCompareSlotsWithPrices,
} from "./state/compare-state.js?v=20260330-09";
import { createCompanyState } from "./state/company-state.js?v=20260330-09";
import { createEditorUI } from "./ui/editor.js?v=20260330-09";
import { bindEvents as bindUiEvents } from "./ui/events.js?v=20260330-09";
import { createResultsRenderer } from "./ui/results.js?v=20260330-09";

let compareState = {
  active: "A",
  slots: { A: null, B: null },
};
let importedScenarioMeta = null;
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

function getMaterialProductionBonuses() {
  const bonuses = {};
  for (const material of MATERIALS) {
    bonuses[material.id] = Math.max(0, num(`material-bonus-${material.id}`));
  }
  return bonuses;
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
    materialProductionBonuses: getMaterialProductionBonuses(),
  };
}

function normalizeImportedScenarioMeta(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const user = raw.user && typeof raw.user === "object" ? raw.user : {};
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const userId = String(user.id || "").trim();
  const username = String(user.username || "").trim();

  if (!userId && !username) {
    return null;
  }

  return {
    searchText: String(raw.searchText || "").trim(),
    statusMessage: typeof raw.statusMessage === "string" ? raw.statusMessage : "",
    statusTone: raw.statusTone === "success" || raw.statusTone === "error" ? raw.statusTone : "default",
    level: Math.max(1, Math.floor(Number(raw.level) || 1)),
    user: {
      id: userId,
      username: username || "Unknown User",
      avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : "",
    },
    summary: {
      companiesFound: Math.max(0, Math.floor(Number(summary.companiesFound) || 0)),
      companiesImported: Math.max(0, Math.floor(Number(summary.companiesImported) || 0)),
      companiesSkipped: Math.max(0, Math.floor(Number(summary.companiesSkipped) || 0)),
      workersImported: Math.max(0, Math.floor(Number(summary.workersImported) || 0)),
      workerProfilesMissing: Math.max(0, Math.floor(Number(summary.workerProfilesMissing) || 0)),
      matchedBy: summary.matchedBy === "userId" ? "userId" : "search",
      exactUsernameMatch: summary.exactUsernameMatch === true,
      searchCandidateCount: Math.max(0, Math.floor(Number(summary.searchCandidateCount) || 0)),
    },
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
      : [],
  };
}

function getImportedScenarioMetaSnapshot() {
  return importedScenarioMeta ? structuredClone(importedScenarioMeta) : null;
}

function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const config = raw.config || {};
  const alloc = raw.alloc || {};
  const prices = raw.prices || {};
  const hasCompanyConfigs = Array.isArray(raw.companyConfigs);
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

  const normalizedBonuses = {};
  const bonuses = raw.materialProductionBonuses || {};
  for (const material of MATERIALS) {
    normalizedBonuses[material.id] = Math.max(0, Number(bonuses[material.id]) || 0);
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
      optimizeFactory: config.optimizeFactory === true,
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
    materialProductionBonuses: normalizedBonuses,
    companyConfigs,
    hasCompanyConfigs,
    importMeta: normalizeImportedScenarioMeta(raw.importMeta),
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
      optimizeFactory: document.getElementById("optimize-factory-toggle")?.checked === true,
      optimizeEntrePlan: document.getElementById("optimize-entre-plan-toggle")?.checked === true,
      entrePlanSlots: getEntrePlanSlotsState(),
      objective: document.getElementById("objective").value,
    },
    alloc: getAllocationsFromInputs(),
    prices: getPrices(),
    materialProductionBonuses: getMaterialProductionBonuses(),
    companyConfigs: getCompanyConfigs(),
    importMeta: getImportedScenarioMetaSnapshot(),
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
  const optimizeFactoryToggle = document.getElementById("optimize-factory-toggle");
  const optimizeEntrePlanToggle = document.getElementById("optimize-entre-plan-toggle");
  if (optimizeSkillToggle) optimizeSkillToggle.checked = normalized.config.optimizeSkill !== false;
  if (optimizeFactoryToggle) optimizeFactoryToggle.checked = normalized.config.optimizeFactory === true;
  if (optimizeEntrePlanToggle) optimizeEntrePlanToggle.checked = normalized.config.optimizeEntrePlan === true;
  setEntrePlanSlotsState(normalized.config.entrePlanSlots);
  setAllocationsToInputs(normalized.alloc);
  for (const material of MATERIALS) {
    setValue(`price-${material.id}`, normalized.prices[material.id]);
    setValue(`material-bonus-${material.id}`, normalized.materialProductionBonuses[material.id]);
  }
  setCompanyConfigs(normalized.companyConfigs, {}, { allowEmpty: normalized.hasCompanyConfigs === true });
  applyImportedScenarioMeta(normalized.importMeta);
  renderCompanyEditor();
  buildMaterialBonusInputs();
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
  const companies = getCompanyConfigs();
  const optimizeSkill = document.getElementById("optimize-skill-toggle")?.checked === true;
  const optimizeFactory = document.getElementById("optimize-factory-toggle")?.checked === true;
  const optimizeEntrePlan = document.getElementById("optimize-entre-plan-toggle")?.checked === true;
  const optimizerStatusEl = document.getElementById("optimizer-status");

  const optimization = optimizeAllocationAndPlan({
    config,
    currentAlloc,
    optimizeSkill,
    optimizeFactory,
    optimizeEntrePlan,
    companies,
  });

  if (optimization.error) {
    optimizerStatusEl.textContent = optimization.error;
    return;
  }

  if (optimization.bestAlloc) {
    setAllocationsToInputs(optimization.bestAlloc);
  }
  if (optimizeFactory && optimization.bestFactorySpecializations) {
    // Apply optimized specializations to companies
    const companyConfigsState = getCompanyConfigsMutable();
    for (const company of companyConfigsState) {
      if (optimization.bestFactorySpecializations[company.id]) {
        company.specialization = optimization.bestFactorySpecializations[company.id];
      }
    }
    renderCompanyEditor();
  }
  if (optimizeEntrePlan && optimization.bestPlanByCompanyId) {
    applyEntrePlanToState(optimization.bestPlanByCompanyId, optimization.bestAlloc || currentAlloc, config);
    renderCompanyEditor();
  }

  // Show status message
  const statusParts = [];
  if (optimization.bestAlloc) statusParts.push("Skills");
  if (optimizeFactory && optimization.bestFactorySpecializations && Object.keys(optimization.bestFactorySpecializations).length > 0) {
    statusParts.push("Factory specializations");
  }
  if (optimizeEntrePlan && optimization.bestPlanByCompanyId) statusParts.push("Entrepreneurship plan");
  
  if (statusParts.length > 0) {
    optimizerStatusEl.textContent = `Optimized: ${statusParts.join(", ")}. Checked ${optimization.checkedSkillAllocs || 0} skill allocs, ${optimization.checkedFactorySpecs || 0} factory specs, ${optimization.checkedEntrePlanStates || 0} plan states.`;
  } else {
    optimizerStatusEl.textContent = "No changes found - current configuration is already optimal.";
  }

  rerenderFromCurrentState();
}

function getCompareSlotLabel(slot) {
  return slot === "B" ? "Scenario B" : "Scenario A";
}

function renderReferenceComparison() {
  const toggleBtn = document.getElementById("compare-switch-btn");
  const copyBtn = document.getElementById("compare-copy-btn");
  const statusEl = document.getElementById("reference-status");
  if (!toggleBtn || !copyBtn || !statusEl) return null;

  const activeSlot = compareState.active === "B" ? "B" : "A";
  const compareSlot = getOtherCompareSlot(activeSlot);
  const activeSnapshot = normalizeSnapshot(compareState.slots[activeSlot]);
  const compareSnapshot = normalizeSnapshot(compareState.slots[compareSlot]);

  toggleBtn.disabled = !compareSnapshot;
  toggleBtn.textContent = `Switch to ${getCompareSlotLabel(compareSlot)}`;
  copyBtn.disabled = !activeSnapshot;
  copyBtn.textContent = `Copy to ${getCompareSlotLabel(compareSlot)}`;

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

function applyPricesToInputs(prices) {
  for (const material of MATERIALS) {
    const input = document.getElementById(`price-${material.id}`);
    if (input && typeof prices[material.id] === "number" && Number.isFinite(prices[material.id])) {
      input.value = String(prices[material.id]);
    }
  }
}

function updateCompareSnapshotsWithPrices(prices) {
  const savedAt = new Date().toISOString();
  compareState = updateCompareSlotsWithPrices(compareState, prices, savedAt);
  saveCompareState();
}

async function fetchLatestPricesFromApi() {
  const response = await fetch(PRICE_API_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const apiData = payload?.result?.data;
  if (!apiData || typeof apiData !== "object") {
    throw new Error("Unexpected API response format.");
  }

  const prices = {};
  let updated = 0;
  const missing = [];

  for (const material of MATERIALS) {
    const value = getApiKeysForMaterial(material.id)
      .map((key) => apiData[key])
      .find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));

    if (typeof value === "number" && Number.isFinite(value)) {
      prices[material.id] = value;
      updated += 1;
    } else {
      missing.push(material.name);
    }
  }

  return { prices, updated, missing };
}

async function refreshLatestPrices({
  updateCurrentInputs = true,
  updateCompareSnapshots = true,
  rerenderAfter = true,
  setStatus = true,
  statusPrefix = "Fetching latest prices from WarEra API...",
} = {}) {
  const statusEl = document.getElementById("price-sync-status");
  if (setStatus && statusEl) {
    statusEl.textContent = statusPrefix;
  }

  const { prices, updated, missing } = await fetchLatestPricesFromApi();

  if (updateCurrentInputs) {
    applyPricesToInputs(prices);
  }
  if (updateCompareSnapshots) {
    updateCompareSnapshotsWithPrices(prices);
  }
  if (rerenderAfter) {
    rerenderFromCurrentState();
  }
  if (setStatus && statusEl) {
    statusEl.textContent = getPriceSyncSummary(updated, missing);
  }

  return { prices, updated, missing };
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function setUserImportStatus(message, tone = "default") {
  const statusEl = document.getElementById("user-import-status");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "status-error", "status-success", "status-info");

  if (tone === "error") {
    statusEl.classList.add("status-error");
  } else if (tone === "success") {
    statusEl.classList.add("status-success");
  } else {
    statusEl.classList.add("status-info");
  }
}

function clearUserImportStatus() {
  const statusEl = document.getElementById("user-import-status");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = "";
  statusEl.className = "status-banner hidden";
}

function clearUserImportSummary() {
  const summaryEl = document.getElementById("user-import-summary");
  if (!summaryEl) {
    return;
  }

  summaryEl.replaceChildren();
  summaryEl.classList.add("hidden");
}

function applyImportedScenarioMeta(meta) {
  importedScenarioMeta = normalizeImportedScenarioMeta(meta);

  const searchInput = document.getElementById("user-search");
  if (searchInput) {
    searchInput.value = importedScenarioMeta?.searchText || "";
  }

  if (!importedScenarioMeta) {
    clearUserImportStatus();
    clearUserImportSummary();
    return;
  }

  if (importedScenarioMeta.statusMessage) {
    setUserImportStatus(importedScenarioMeta.statusMessage, importedScenarioMeta.statusTone);
  } else {
    clearUserImportStatus();
  }

  renderUserImportSummary(importedScenarioMeta);
}

function renderUserImportSummary(imported) {
  const summaryEl = document.getElementById("user-import-summary");
  if (!summaryEl) {
    return;
  }

  summaryEl.replaceChildren();

  const cardEl = document.createElement("div");
  cardEl.className = "user-import-summary-card";

  if (imported.user.avatarUrl) {
    const avatarEl = document.createElement("img");
    avatarEl.className = "user-import-avatar";
    avatarEl.src = imported.user.avatarUrl;
    avatarEl.alt = `${imported.user.username} avatar`;
    avatarEl.loading = "lazy";
    cardEl.append(avatarEl);
  }

  const detailsEl = document.createElement("div");
  detailsEl.className = "user-import-meta";

  const nameEl = document.createElement("p");
  nameEl.className = "user-import-name";
  nameEl.textContent = imported.user.username;

  const idEl = document.createElement("p");
  idEl.className = "user-import-id mono";
  idEl.textContent = imported.user.id;

  const summaryTextEl = document.createElement("p");
  summaryTextEl.className = "hint";
  summaryTextEl.textContent = `Level ${imported.level} | Companies imported: ${imported.summary.companiesImported}/${imported.summary.companiesFound} | Workers imported: ${imported.summary.workersImported}`;

  detailsEl.append(nameEl, idEl, summaryTextEl);

  if (imported.warnings.length > 0) {
    const warningEl = document.createElement("p");
    warningEl.className = "hint";
    warningEl.textContent = imported.warnings.join(" ");
    detailsEl.append(warningEl);
  }

  cardEl.append(detailsEl);
  summaryEl.append(cardEl);
  summaryEl.classList.remove("hidden");
}

async function importUserFromApi() {
  const searchInput = document.getElementById("user-search");
  const button = document.getElementById("user-import-btn");
  if (!searchInput || !button) {
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  searchInput.disabled = true;
  button.textContent = "Importing...";
  setUserImportStatus("Looking up WarEra user data and building simulator state...");

  try {
    const imported = await importWareraUserData(searchInput.value);
    const successMessagePrefix = `Imported ${imported.user.username}. Skills, level, companies, worker stats, company production bonuses from country, region, and ruling party data, and company wages were refreshed. Your own wage stays manual.`;

    document.getElementById("level").value = String(imported.level);
    setAllocationsToInputs(imported.alloc);
    setCompanyConfigs(imported.companyConfigs, {}, { allowEmpty: true });
    setEntrePlanSlotsState([]);

    const searchNote = imported.summary.matchedBy === "search" && imported.summary.searchCandidateCount > 1 && !imported.summary.exactUsernameMatch
      ? ` Selected the first of ${imported.summary.searchCandidateCount} search matches.`
      : "";
    const skippedNote = imported.summary.companiesSkipped > 0
      ? ` Skipped ${imported.summary.companiesSkipped} ${pluralize(imported.summary.companiesSkipped, "company")} that could not be mapped into the simulator.`
      : "";
    const workerFallbackNote = imported.summary.workerProfilesMissing > 0
      ? ` ${imported.summary.workerProfilesMissing} ${pluralize(imported.summary.workerProfilesMissing, "worker profile")} used default energy/production values.`
      : "";
    const successMessage = `${successMessagePrefix}${searchNote}${skippedNote}${workerFallbackNote}`;

    applyImportedScenarioMeta({
      ...imported,
      searchText: searchInput.value,
      statusMessage: successMessage,
      statusTone: "success",
    });
    renderCompanyEditor();
    rerenderFromCurrentState();

    setUserImportStatus(
      successMessage,
      "success",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    importedScenarioMeta = null;
    setUserImportStatus(`User import failed: ${message}`, "error");
    clearUserImportSummary();
    console.error("User import failed:", err);
  } finally {
    button.disabled = false;
    searchInput.disabled = false;
    button.textContent = originalLabel;
  }
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
      optimizeFactory: document.getElementById("optimize-factory-toggle")?.checked === true,
      optimizeEntrePlan: document.getElementById("optimize-entre-plan-toggle")?.checked === true,
      entrePlanSlots: getEntrePlanSlotsState(),
      objective: document.getElementById("objective").value,
    },
    alloc: getAllocationsFromInputs(),
    prices: getPrices(),
    materialProductionBonuses: getMaterialProductionBonuses(),
    companyConfigs: getCompanyConfigs(),
    importMeta: getImportedScenarioMetaSnapshot(),
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
    const savedImportMeta = normalizeImportedScenarioMeta(parsed.importMeta);

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
    const optimizeFactoryToggle = document.getElementById("optimize-factory-toggle");
    const optimizeEntrePlanToggle = document.getElementById("optimize-entre-plan-toggle");
    if (optimizeSkillToggle) optimizeSkillToggle.checked = c.optimizeSkill !== false;
    if (optimizeFactoryToggle) optimizeFactoryToggle.checked = c.optimizeFactory === true;
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
      maybeSet(`material-bonus-${material.id}`, parsed.materialProductionBonuses?.[material.id] || 0);
    }

    if (Array.isArray(savedCompanyConfigs)) {
      setCompanyConfigs(savedCompanyConfigs, companyDefaults, { allowEmpty: true });
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

    applyImportedScenarioMeta(savedImportMeta);
  } catch (err) {
    console.error("Failed to load saved state:", err);
    setCompanyConfigs([createDefaultCompanyConfig("iron"), createDefaultCompanyConfig("steel")]);
    setEntrePlanSlotsState([]);
    applyImportedScenarioMeta(null);
  }
}

function buildMaterialInputs() {
  editorUI?.buildMaterialInputs();
}

function buildMaterialBonusInputs() {
  editorUI?.buildMaterialBonusInputs();
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

function copyCurrentScenarioToOtherSlot() {
  const snapshot = captureSnapshotFromInputs();
  if (!snapshot) {
    return;
  }

  compareState = copySnapshotToOtherCompareSlot(compareState, snapshot);
  saveCompareState();
  rerenderFromCurrentState();
}

async function switchCompareScenario() {
  const toggleBtn = document.getElementById("compare-switch-btn");
  const copyBtn = document.getElementById("compare-copy-btn");
  saveCurrentToActiveCompareSlot();

  if (toggleBtn) {
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Switching...";
  }
  if (copyBtn) {
    copyBtn.disabled = true;
  }

  try {
    try {
      await refreshLatestPrices({
        updateCurrentInputs: true,
        updateCompareSnapshots: true,
        rerenderAfter: false,
        setStatus: true,
        statusPrefix: "Refreshing latest prices for Scenario A and Scenario B...",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusEl = document.getElementById("price-sync-status");
      if (statusEl) {
        statusEl.textContent = `Price sync failed before scenario switch: ${message}`;
      }
      console.error("Price sync failed before scenario switch:", err);
    }

    const targetSlot = getOtherCompareSlot(compareState.active);
    const targetSnapshot = compareState.slots[targetSlot];
    compareState.active = targetSlot;

    if (targetSnapshot) {
      applySnapshotToInputs(targetSnapshot, false);
    }

    saveCompareState();
    rerenderFromCurrentState();
  } finally {
    if (toggleBtn) {
      toggleBtn.disabled = false;
    }
    if (copyBtn) {
      copyBtn.disabled = false;
    }
  }
}

async function syncPricesFromApi() {
  const button = document.getElementById("sync-prices-btn");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Syncing...";

  try {
    await refreshLatestPrices({
      updateCurrentInputs: true,
      updateCompareSnapshots: true,
      rerenderAfter: true,
      setStatus: true,
      statusPrefix: "Fetching latest prices from WarEra API...",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusEl = document.getElementById("price-sync-status");
    if (statusEl) {
      statusEl.textContent = `Price sync failed: ${message}`;
    }
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
    importUserFromApi,
    copyCurrentScenarioToOtherSlot,
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
  buildMaterialBonusInputs();
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
