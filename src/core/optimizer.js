import {
  MAX_SKILL_LEVEL,
  OBJECTIVES,
  OPTIMIZED_SKILL_KEYS,
} from "../config/constants.js?v=20260330-08";
import {
  getActiveCompaniesForAlloc,
  getStatsForAlloc,
  levelCost,
  objectiveScore,
  scoreEntreActionForCompany,
  simulate,
} from "./simulation.js?v=20260330-08";

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

export function optimizeAllocationAndPlan({
  config,
  currentAlloc,
  optimizeSkill,
  optimizeEntrePlan,
}) {
  if (!optimizeSkill && !optimizeEntrePlan) {
    return {
      error: "Select at least one optimizer target: Skill Allocation or Entrepreneurship Plan.",
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

  const modeLabel = effectiveOptimizeSkill && optimizeEntrePlan
    ? "skills + entrepreneurship plan"
    : (effectiveOptimizeSkill ? "skills only" : "entrepreneurship plan only");

  const planMethod = optimizeEntrePlan
    ? (effectiveOptimizeSkill ? "heuristic inside skill search" : "exact plan search")
    : "not used";

  const objectiveLabel = OBJECTIVES[config.objective]?.label || OBJECTIVES.netProfitDay.label;

  return {
    error: null,
    checkedSkillAllocs,
    checkedEntrePlanStates,
    bestAlloc,
    bestPlanByCompanyId,
    bestResult,
    bestScore,
    modeLabel,
    planMethod,
    fixedCost,
    fixedAlloc,
    objectiveLabel,
  };
}
