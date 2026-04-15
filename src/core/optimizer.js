import {
  MAX_SKILL_LEVEL,
  MATERIALS,
  OBJECTIVES,
  OPTIMIZED_SKILL_KEYS,
} from "../config/constants.js?v=20260330-09";
import {
  getActiveCompaniesForAlloc,
  getStatsForAlloc,
  levelCost,
  objectiveScore,
  scoreEntreActionForCompany,
  simulate,
} from "./simulation.js?v=20260330-09";

function getProductionBonusForSpecialization(materialBonuses, specialization, fallback = 0) {
  const bonus = Number(materialBonuses?.[specialization]);
  if (Number.isFinite(bonus)) {
    return Math.max(0, bonus);
  }
  return Math.max(0, Number(fallback) || 0);
}

function applySpecializationsToCompanyConfigs(companyConfigs, specializations = {}, materialBonuses = {}) {
  return (Array.isArray(companyConfigs) ? companyConfigs : []).map((company) => {
    const specialization = specializations[company.id] || company.specialization;
    return {
      ...company,
      specialization,
      productionBonusPct: getProductionBonusForSpecialization(
        materialBonuses,
        specialization,
        company.productionBonusPct,
      ),
    };
  });
}

export function exactOptimizeEntrePlanForAlloc(alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const bestPlan = {};
  for (const company of activeCompanies) {
    bestPlan[company.id] = 0;
  }

  if (activeCompanies.length === 0 || capPer10h <= 0) {
    const result = simulate(alloc, { ...config, manualPlanOverrideByCompanyId: bestPlan });
    return {
      checked: 1,
      bestPlan,
      bestResult: result,
      bestScore: objectiveScore(result, config.objective),
    };
  }

  const working = {};
  for (const company of activeCompanies) {
    working[company.id] = 0;
  }

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

export function heuristicOptimizeEntrePlanForAlloc(alloc, config) {
  const stats = getStatsForAlloc(alloc);
  const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
  const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
  const bestPlan = {};

  for (const company of activeCompanies) {
    bestPlan[company.id] = 0;
  }

  let checked = 0;
  if (activeCompanies.length > 0 && capPer10h > 0) {
    const ranked = activeCompanies
      .map((company) => {
        checked += 1;
        return {
          company,
          score: scoreEntreActionForCompany(company, stats, config),
        };
      })
      .sort((a, b) => b.score - a.score);

    const top = ranked[0];
    if (top && Number.isFinite(top.score) && top.score > 0) {
      bestPlan[top.company.id] = capPer10h;
    }
  }

  const bestResult = simulate(alloc, { ...config, manualPlanOverrideByCompanyId: bestPlan });
  const bestScore = objectiveScore(bestResult, config.objective);

  return {
    checked: Math.max(checked, 1),
    bestPlan,
    bestResult,
    bestScore,
  };
}

export function optimizeCompanySpecializations(alloc, config, companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    return {
      bestSpecializations: {},
      bestResult: null,
      bestScore: -Infinity,
      checked: 0,
    };
  }

  const materialIds = MATERIALS.map((m) => m.id);
  let bestSpecializations = {};
  let bestResult = null;
  let bestScore = -Infinity;
  let checked = 0;

  // For each company, assign best specialization based on its bonus
  // For simplicity, we'll use a greedy approach: assign each company the specialization
  // that maximizes the final score
  const testSpecializations = (companyIdx, currentSpecs) => {
    if (companyIdx >= companies.length) {
      // All companies assigned - evaluate this specialization combo
      checked += 1;

      // Create modified companies with new specializations
      const modifiedCompanies = companies.map((company) => {
        if (currentSpecs[company.id]) {
          return { ...company, specialization: currentSpecs[company.id] };
        }
        return company;
      });

      // Create modified config with updated companies
      const modifiedConfig = {
        ...config,
        companyConfigs: modifiedCompanies,
      };

      const result = simulate(alloc, modifiedConfig);
      const score = objectiveScore(result, config.objective);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
        bestSpecializations = { ...currentSpecs };
      }
      return;
    }

    const company = companies[companyIdx];
    // Try each material specialization
    for (const materialId of materialIds) {
      currentSpecs[company.id] = materialId;
      testSpecializations(companyIdx + 1, currentSpecs);
    }
  };

  // Start recursive assignment
  testSpecializations(0, {});

  return {
    bestSpecializations,
    bestResult,
    bestScore,
    checked,
  };
}

export function heuristicOptimizeCompanySpecializations(alloc, config, companies) {
  if (!Array.isArray(companies) || companies.length === 0) {
    return {
      bestSpecializations: {},
      bestResult: null,
      bestScore: -Infinity,
      checked: 0,
    };
  }

  const materialIds = MATERIALS.map((m) => m.id);
  const baseCompanyConfigs = Array.isArray(config.companyConfigs) && config.companyConfigs.length > 0
    ? config.companyConfigs
    : companies;
  let bestSpecializations = {};
  let checked = 0;

  for (const company of companies) {
    bestSpecializations[company.id] = company.specialization;
  }

  const buildConfigForSpecializations = (specializations) => {
    const modifiedCompanies = applySpecializationsToCompanyConfigs(
      baseCompanyConfigs,
      specializations,
      config.materialProductionBonuses,
    );
    return {
      ...config,
      configuredCompanies: modifiedCompanies.length,
      companyConfigs: modifiedCompanies,
    };
  };

  let bestResult = simulate(alloc, buildConfigForSpecializations(bestSpecializations));
  let bestScore = objectiveScore(bestResult, config.objective);
  checked += 1;

  const baselineSpecializations = { ...bestSpecializations };
  const baselineScore = bestScore;
  const baselineResult = bestResult;

  let improved = true;
  while (improved) {
    improved = false;

    for (const company of companies) {
      const originalSpec = bestSpecializations[company.id];

      for (const materialId of materialIds) {
        if (materialId === originalSpec) {
          continue;
        }

        const trialSpecializations = {
          ...bestSpecializations,
          [company.id]: materialId,
        };
        const trialResult = simulate(alloc, buildConfigForSpecializations(trialSpecializations));
        const trialScore = objectiveScore(trialResult, config.objective);
        checked += 1;

        if (trialScore > bestScore) {
          bestSpecializations = trialSpecializations;
          bestScore = trialScore;
          bestResult = trialResult;
          improved = true;
          break;
        }
      }
    }
  }

  const foundImprovement = bestScore > baselineScore;
  return {
    bestSpecializations: foundImprovement ? bestSpecializations : baselineSpecializations,
    bestResult: foundImprovement ? bestResult : baselineResult,
    bestScore: foundImprovement ? bestScore : baselineScore,
    checked,
  };
}

export function optimizeAllocationAndPlan({
  config,
  currentAlloc,
  optimizeSkill,
  optimizeEntrePlan,
  optimizeCompany,
  companies,
}) {
  if (!optimizeSkill && !optimizeEntrePlan && !optimizeCompany) {
    return {
      error: "Select at least one optimizer target: Skill Allocation, Company Specialization, or Entrepreneurship Plan.",
    };
  }

  const fixedAlloc = {
    companies: currentAlloc.companies,
    management: currentAlloc.management,
  };
  const fixedCost = levelCost(fixedAlloc.companies) + levelCost(fixedAlloc.management);
  const remainingPoints = config.totalSkillPoints - fixedCost;

  let effectiveOptimizeSkill = optimizeSkill;
  if (effectiveOptimizeSkill && remainingPoints < 0) {
    if (!optimizeEntrePlan) {
      return {
        error: `Cannot optimize skills. Fixed Companies + Management levels already spend ${fixedCost}, above total points ${config.totalSkillPoints}.`,
      };
    }
    effectiveOptimizeSkill = false;
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

  if (effectiveOptimizeSkill) {
    const bounds = {};
    for (const key of OPTIMIZED_SKILL_KEYS) {
      bounds[key] = MAX_SKILL_LEVEL;
    }
    if (config.workUsagePct <= 0) {
      bounds.energy = 0;
    }
    if (config.entreUsagePct <= 0) {
      bounds.entrepreneurship = 0;
    }

    for (let energy = 0; energy <= bounds.energy; energy += 1) {
      for (let entrepreneurship = 0; entrepreneurship <= bounds.entrepreneurship; entrepreneurship += 1) {
        for (let production = 0; production <= bounds.production; production += 1) {
          const optimizeCost = levelCost(energy) + levelCost(entrepreneurship) + levelCost(production);
          if (optimizeCost > remainingPoints) {
            continue;
          }

          const candidateAlloc = {
            energy,
            entrepreneurship,
            production,
            companies: fixedAlloc.companies,
            management: fixedAlloc.management,
          };

          // Keep optimizer responsive by using heuristic plan search inside skill search.
          evaluateCandidate(candidateAlloc, optimizeEntrePlan ? "heuristic" : null);
        }
      }
    }
  } else {
    evaluateCandidate(currentAlloc, optimizeEntrePlan ? "exact" : null);
  }

  let bestCompanySpecializations = null;
  let bestCompanyResult = bestResult;
  let bestCompanyScore = bestScore;
  let checkedCompanySpecs = 0;

  const companyConfigsForOptimization = Array.isArray(companies) ? companies : config.companyConfigs;
  if (optimizeCompany && Array.isArray(companyConfigsForOptimization) && companyConfigsForOptimization.length > 0) {
    const allocForCompany = bestAlloc || currentAlloc;
    const baseCompanyConfigs = applySpecializationsToCompanyConfigs(
      companyConfigsForOptimization,
      {},
      config.materialProductionBonuses,
    );
    const configForCompany = {
      ...config,
      configuredCompanies: baseCompanyConfigs.length,
      companyConfigs: baseCompanyConfigs,
      ...(optimizeEntrePlan && bestPlanByCompanyId
        ? { manualPlanOverrideByCompanyId: bestPlanByCompanyId }
        : {}),
    };
    const activeCompanies = getActiveCompaniesForAlloc(allocForCompany, configForCompany);
    const companyOpt = heuristicOptimizeCompanySpecializations(allocForCompany, configForCompany, activeCompanies);
    checkedCompanySpecs = companyOpt.checked;

    if (companyOpt.bestScore > bestCompanyScore) {
      bestCompanyScore = companyOpt.bestScore;
      bestCompanyResult = companyOpt.bestResult;
      bestCompanySpecializations = companyOpt.bestSpecializations;

      if (optimizeEntrePlan) {
        const optimizedCompanyConfigs = applySpecializationsToCompanyConfigs(
          baseCompanyConfigs,
          companyOpt.bestSpecializations,
          config.materialProductionBonuses,
        );
        const configForPlanAfterCompany = {
          ...config,
          configuredCompanies: optimizedCompanyConfigs.length,
          companyConfigs: optimizedCompanyConfigs,
        };
        const planResult = effectiveOptimizeSkill
          ? heuristicOptimizeEntrePlanForAlloc(allocForCompany, configForPlanAfterCompany)
          : exactOptimizeEntrePlanForAlloc(allocForCompany, configForPlanAfterCompany);
        const planScore = objectiveScore(planResult.bestResult, config.objective);
        checkedEntrePlanStates += planResult.checked;

        if (planScore >= bestCompanyScore) {
          bestCompanyScore = planScore;
          bestCompanyResult = planResult.bestResult;
          bestPlanByCompanyId = planResult.bestPlan;
        }
      }
    }
  }

  if (bestCompanyScore < bestScore) {
    console.warn("Company optimization produced worse result than skill optimization, reverting");
    bestCompanyScore = bestScore;
    bestCompanyResult = bestResult;
    bestCompanySpecializations = null;
  }

  const modeParts = [];
  if (effectiveOptimizeSkill) modeParts.push("skills");
  if (optimizeCompany) modeParts.push("company specializations");
  if (optimizeEntrePlan) modeParts.push("entrepreneurship plan");
  const modeLabel = modeParts.join(" + ");

  const planMethod = optimizeEntrePlan
    ? (effectiveOptimizeSkill ? "heuristic inside skill search" : "exact plan search")
    : "not used";

  const objectiveLabel = OBJECTIVES[config.objective]?.label || OBJECTIVES.netProfitDay.label;

  return {
    error: null,
    checkedSkillAllocs,
    checkedEntrePlanStates,
    checkedCompanySpecs,
    bestAlloc,
    bestPlanByCompanyId,
    bestCompanySpecializations,
    bestResult: bestCompanyResult || bestResult,
    bestScore: bestCompanyScore,
    modeLabel,
    planMethod,
    fixedCost,
    fixedAlloc,
    objectiveLabel,
  };
}
