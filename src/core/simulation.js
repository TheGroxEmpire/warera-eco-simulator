import {
  AE_RATES,
  BASE_STATS,
  CYCLES_PER_DAY,
  DEFAULT_OBJECTIVE_KEY,
  LEVEL_GAINS,
  MATERIAL_MAP,
  MATERIALS,
  MAX_SKILL_LEVEL,
  OBJECTIVES,
  SKILL_KEYS,
} from "../config/constants.js?v=20260330-09";
import { bonusMultiplier, clamp, fidelityMultiplier } from "./math.js?v=20260330-09";

export function sanitizeEntrePlanSlots(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((value) => {
    const parsed = Math.floor(Number(value));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
}

export function workerCount(company) {
  return Array.isArray(company?.workers) ? company.workers.length : 0;
}

export function getApiKeysForMaterial(materialId) {
  const explicitMap = {
    cooked_fish: ["cookedFish"],
    light_ammo: ["lightAmmo"],
    heavy_ammo: ["heavyAmmo"],
    mysterious_plant: ["mysteriousPlant", "coca"],
    pill: ["pill", "cocain"],
  };

  if (explicitMap[materialId]) {
    return explicitMap[materialId];
  }

  return [materialId.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
}

export function getItemImageFile(materialId) {
  const explicitMap = {
    cooked_fish: "cookedFish.png",
    light_ammo: "lightAmmo.png",
    heavy_ammo: "heavyAmmo.png",
    mysterious_plant: "coca.png",
    pill: "cocain.png",
  };

  if (explicitMap[materialId]) {
    return explicitMap[materialId];
  }

  return `${materialId}.png`;
}

export function getItemImagePath(materialId) {
  return `./images/items/${getItemImageFile(materialId)}`;
}

function getMaterialDepth(materialId, memo = new Map()) {
  if (memo.has(materialId)) {
    return memo.get(materialId);
  }

  const material = MATERIAL_MAP.get(materialId);
  if (!material) {
    return 0;
  }

  const ingredientIds = Object.keys(material.ingredients);
  if (ingredientIds.length === 0) {
    memo.set(materialId, 0);
    return 0;
  }

  const depth = 1 + Math.max(...ingredientIds.map((id) => getMaterialDepth(id, memo)));
  memo.set(materialId, depth);
  return depth;
}

export function getProductionOrder() {
  const depthMemo = new Map();
  return MATERIALS.slice().sort((a, b) => {
    const depthDiff = getMaterialDepth(a.id, depthMemo) - getMaterialDepth(b.id, depthMemo);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return a.name.localeCompare(b.name);
  });
}

export function levelCost(level) {
  return (level * (level + 1)) / 2;
}

export function nextLevelCost(currentLevel) {
  return currentLevel + 1;
}

export function refundFromLevelDecrease(currentLevel) {
  return currentLevel;
}

export function maxAffordableLevel(points) {
  return Math.floor((Math.sqrt(1 + (8 * points)) - 1) / 2);
}

export function createEmptyAllocation() {
  return {
    energy: 0,
    entrepreneurship: 0,
    production: 0,
    companies: 0,
    management: 0,
  };
}

export function getSkillCosts(alloc) {
  return {
    energy: levelCost(alloc.energy),
    entrepreneurship: levelCost(alloc.entrepreneurship),
    production: levelCost(alloc.production),
    companies: levelCost(alloc.companies),
    management: levelCost(alloc.management),
  };
}

export function getTotalSpentPoints(alloc) {
  return SKILL_KEYS.reduce((sum, key) => sum + levelCost(alloc[key]), 0);
}

export function getStatsForAlloc(alloc) {
  return {
    energy: BASE_STATS.energy + (alloc.energy * LEVEL_GAINS.energy),
    entrepreneurship: BASE_STATS.entrepreneurship + (alloc.entrepreneurship * LEVEL_GAINS.entrepreneurship),
    production: BASE_STATS.production + (alloc.production * LEVEL_GAINS.production),
    companies: BASE_STATS.companies + (alloc.companies * LEVEL_GAINS.companies),
    management: BASE_STATS.management + (alloc.management * LEVEL_GAINS.management),
  };
}

export function getSkillLevelBounds(config, totalSkillPoints) {
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

export function getIngredientCostPerUnit(material, prices) {
  return Object.entries(material.ingredients).reduce((sum, [ingredientId, qty]) => {
    return sum + (Math.max(0, qty) * (prices[ingredientId] || 0));
  }, 0);
}

export function scoreEntreActionForCompany(company, stats, config) {
  const material = MATERIAL_MAP.get(company.specialization);
  if (!material || material.pp <= 0) {
    return -Infinity;
  }

  const ppPerAction = stats.production * bonusMultiplier(company.productionBonusPct) * config.companyUtilizationPct;
  if (!Number.isFinite(ppPerAction) || ppPerAction <= 0) {
    return -Infinity;
  }

  const unitsPerAction = ppPerAction / material.pp;
  const ingredientCostPerUnit = getIngredientCostPerUnit(material, config.prices);
  const profitPerAction = (unitsPerAction * (config.prices[material.id] || 0)) - (unitsPerAction * ingredientCostPerUnit);

  if (config.objective === "netProfitDay") {
    return profitPerAction;
  }
  if (config.objective === "totalPPDay" || config.objective === "companyPPDay") {
    return ppPerAction;
  }
  if (config.objective === "unitsDay") {
    return unitsPerAction;
  }

  return 0;
}

export function getActiveCompaniesForAlloc(alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const companiesActive = Math.min(config.configuredCompanies, stats.companies);
  return config.companyConfigs.slice(0, companiesActive);
}

export function buildEntrepreneurshipPlan(activeCompanies, allCompanyConfigs, stats, config, planOverrideByCompanyId = null) {
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
      skippedPer10h: 0,
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
    let requestedTotalPer10h = 0;

    for (const company of allCompanyConfigs) {
      const requested = Math.max(0, Math.floor(Number(planOverrideByCompanyId[company.id]) || 0));
      requestedTotalPer10h += requested;
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
      skippedPer10h: Math.max(0, capPer10h - requestedTotalPer10h),
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
  let skippedPer10h = Math.max(0, capPer10h - rawSlots.length);

  for (const slotCompanyId of rawSlots) {
    if (!slotCompanyId) {
      skippedPer10h += 1;
      continue;
    }

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
    skippedPer10h,
    unassignedPer10h: Math.max(0, capPer10h - effectiveTotalPer10h),
    requestedInactiveCompaniesPer10h,
    requestedByCompanyId,
    effectiveByCompanyId,
  };
}

export function buildEntrePlanSlotsFromPlan(planByCompanyId, alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const slots = [];

  for (const company of activeCompanies) {
    const requested = Math.max(0, Math.floor(Number(planByCompanyId?.[company.id]) || 0));
    for (let i = 0; i < requested && slots.length < capPer10h; i += 1) {
      slots.push(company.id);
    }
    if (slots.length >= capPer10h) {
      break;
    }
  }

  while (slots.length < capPer10h) {
    slots.push(null);
  }

  return slots;
}

function initializePerMaterialValue(defaultValue = 0) {
  const values = {};
  for (const material of MATERIALS) {
    values[material.id] = defaultValue;
  }
  return values;
}

export function simulate(alloc, config) {
  const clampedAlloc = {
    energy: clamp(alloc.energy, 0, MAX_SKILL_LEVEL),
    entrepreneurship: clamp(alloc.entrepreneurship, 0, MAX_SKILL_LEVEL),
    production: clamp(alloc.production, 0, MAX_SKILL_LEVEL),
    companies: clamp(alloc.companies, 0, MAX_SKILL_LEVEL),
    management: clamp(alloc.management, 0, MAX_SKILL_LEVEL),
  };

  const totalSpentPoints = getTotalSpentPoints(clampedAlloc);
  const isAllocationValid = totalSpentPoints <= config.totalSkillPoints;

  const stats = getStatsForAlloc(clampedAlloc);

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
    config.manualPlanOverrideByCompanyId || null,
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

  const companyCountConfiguredByMaterial = initializePerMaterialValue();
  const companyCountActiveByMaterial = initializePerMaterialValue();
  const companyPPByMaterial = initializePerMaterialValue();

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
    const companyProductionBonusMultiplier = bonusMultiplier(company.productionBonusPct);

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
    const manualPPDay = manualBasePPDay * companyProductionBonusMultiplier;

    let workerRawPPDay = 0;
    let workerPPDay = 0;
    let workerPayrollCostDay = 0;

    for (const worker of activeWorkers) {
      const actionsPerDay = Math.floor(worker.energyPer10h / 10) * CYCLES_PER_DAY;
      const rawPPDay = actionsPerDay * worker.productionPerAction;
      workerRawPPDay += rawPPDay;
      workerPPDay += rawPPDay
        * companyProductionBonusMultiplier
        * fidelityMultiplier(worker.fidelityPct);
      workerPayrollCostDay += rawPPDay * config.companyUtilizationPct * worker.wagePerPP;
    }

    const aePPDay = (AE_RATES[company.aeLevel] || 0) * companyProductionBonusMultiplier;
    const ppBudgetDay = (manualPPDay + aePPDay + workerPPDay) * config.companyUtilizationPct;
    companyPPByMaterial[company.specialization] += ppBudgetDay;

    manualCompanyPPDay += manualPPDay;
    employeeRawPPDay += workerRawPPDay;
    autoCompanyPPDay += aePPDay;
    employeePPDay += workerPPDay;
    payrollCostDay += workerPayrollCostDay;

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

  const inventory = initializePerMaterialValue();
  const producedUnits = initializePerMaterialValue();
  const ppUsedByMaterial = initializePerMaterialValue();
  const ppWastedByMaterial = initializePerMaterialValue();
  const ingredientPurchaseCostByMaterial = initializePerMaterialValue();
  const boughtForProductionByMaterial = initializePerMaterialValue();

  const order = getProductionOrder();
  for (const material of order) {
    const budget = companyPPByMaterial[material.id] || 0;
    if (budget <= 0 || material.pp <= 0) {
      continue;
    }

    const ingredientEntries = Object.entries(material.ingredients);
    let produced = budget / material.pp;
    if (!Number.isFinite(produced) || produced < 0) {
      produced = 0;
    }

    if (ingredientEntries.length > 0) {
      for (const [ingredientId, quantityPerUnit] of ingredientEntries) {
        if (quantityPerUnit <= 0) {
          continue;
        }

        const required = produced * quantityPerUnit;
        const available = Math.max(0, inventory[ingredientId]);
        const consumedFromStock = Math.min(available, required);
        const missingToBuy = Math.max(0, required - consumedFromStock);

        inventory[ingredientId] -= consumedFromStock;
        boughtForProductionByMaterial[ingredientId] += missingToBuy;
        ingredientPurchaseCostByMaterial[material.id] += missingToBuy * (config.prices[ingredientId] || 0);
      }
    }

    inventory[material.id] += produced;
    producedUnits[material.id] += produced;

    const ppUsed = produced * material.pp;
    ppUsedByMaterial[material.id] = ppUsed;
    ppWastedByMaterial[material.id] = Math.max(0, budget - ppUsed);
  }

  const soldUnits = initializePerMaterialValue();
  const consumedInternally = initializePerMaterialValue();
  const revenueByMaterial = initializePerMaterialValue();
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
  const totalPPHour = totalPPDay / 24;
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
    configuredCompanies,
    inactiveCompanies,
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
    totalPPHour,

    workIncomeDay,
    revenueDay,
    ingredientCostDay,
    payrollCostDay,
    netProfitDay,
    netProfitHour,

    unitsDay,
    unitsHour,

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
    entreActionsSkippedPer10h: entrepreneurshipPlan.skippedPer10h,
    entreActionsUnassignedPer10h: entrepreneurshipPlan.unassignedPer10h,

    companyCards,
    companyPPByMaterial,
    producedUnits,
    soldUnits,
    consumedInternally,
    productionBreakdown,
  };
}

export function objectiveScore(result, objectiveKey) {
  const objective = OBJECTIVES[objectiveKey] || OBJECTIVES[DEFAULT_OBJECTIVE_KEY];
  return objective.score(result);
}

export function estimateSearchVolume(bounds) {
  return SKILL_KEYS.reduce((product, key) => product * (bounds[key] + 1), 1);
}
