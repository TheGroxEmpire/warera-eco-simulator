import { MATERIAL_MAP, MATERIALS } from "../config/constants.js?v=20260330-09";
import { sanitizeEntrePlanSlots } from "../core/simulation.js?v=20260330-09";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createCompanyState() {
  let companyConfigsState = [];
  let nextCompanyId = 1;
  let entrePlanSlotsState = [];

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

    return {
      id,
      specialization,
      aeLevel,
      productionBonusPct,
      manualActionsPer10h,
      workers,
      wagePerPP,
    };
  }

  function setCompanyConfigs(configs, defaults = {}, options = {}) {
    const allowEmpty = options?.allowEmpty === true;
    const normalized = (Array.isArray(configs) ? configs : [])
      .map((raw) => sanitizeCompanyConfig(raw, defaults))
      .filter((company, idx, arr) => arr.findIndex((candidate) => candidate.id === company.id) === idx);

    companyConfigsState = normalized.length > 0
      ? normalized
      : (allowEmpty ? [] : [createDefaultCompanyConfig("iron"), createDefaultCompanyConfig("steel")]);

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

  function getCompanyConfigsMutable() {
    return companyConfigsState;
  }

  function getEntrePlanSlotsState() {
    return sanitizeEntrePlanSlots(entrePlanSlotsState);
  }

  function setEntrePlanSlotsState(slots) {
    entrePlanSlotsState = sanitizeEntrePlanSlots(slots);
  }

  return {
    createDefaultWorkerConfig,
    sanitizeWorkerConfig,
    workerCount,
    createDefaultCompanyConfig,
    sanitizeCompanyConfig,
    setCompanyConfigs,
    getCompanyConfigs,
    getCompanyConfigsMutable,
    getEntrePlanSlotsState,
    setEntrePlanSlotsState,
  };
}
