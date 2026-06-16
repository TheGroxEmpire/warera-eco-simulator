import test from "node:test";
import assert from "node:assert/strict";

import { MATERIALS } from "../src/config/constants.js";
import { heuristicOptimizeCompanySpecializations, optimizeAllocationAndPlan } from "../src/core/optimizer.js";
import { buildEntrePlanSlotsFromPlan, getStatsForAlloc, simulate } from "../src/core/simulation.js";

function createPriceMap(value = 1) {
  const prices = {};
  for (const material of MATERIALS) {
    prices[material.id] = value;
  }
  return prices;
}

function createCompany(id, specialization) {
  return {
    id,
    specialization,
    aeLevel: 1,
    productionBonusPct: 0,
    manualActionsPer10h: 0,
    workers: [],
    wagePerPP: 0.135,
  };
}

function assertApprox(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

function createBaseConfig() {
  const companyConfigs = [createCompany(1, "iron"), createCompany(2, "steel")];
  return {
    level: 20,
    totalSkillPoints: 80,
    objective: "netProfitDay",
    workUsagePct: 1,
    entreUsagePct: 1,
    companyUtilizationPct: 1,
    ownWagePerPP: 0.13,
    entrePlanSlots: [],
    configuredCompanies: companyConfigs.length,
    totalWorkersConfigured: 0,
    companyConfigs,
    prices: createPriceMap(1),
  };
}

test("simulate returns stable numeric outputs for a baseline config", () => {
  const config = createBaseConfig();
  const alloc = {
    energy: 0,
    entrepreneurship: 0,
    production: 0,
    companies: 0,
    management: 0,
  };

  const result = simulate(alloc, config);

  assert.equal(result.isAllocationValid, true);
  assert.equal(result.companiesActive, 2);
  assert.equal(result.totalSpentPoints, 0);
  assert.ok(Number.isFinite(result.totalPPDay));
  assert.ok(Number.isFinite(result.netProfitDay));
  assert.ok(Array.isArray(result.productionBreakdown));
  assert.equal(result.productionBreakdown.length, MATERIALS.length);
});

test("buildEntrePlanSlotsFromPlan obeys entrepreneurship cap", () => {
  const config = createBaseConfig();
  const alloc = {
    energy: 0,
    entrepreneurship: 4,
    production: 0,
    companies: 0,
    management: 0,
  };

  const cap = Math.floor(getStatsForAlloc(alloc).entrepreneurship / 10);
  const slots = buildEntrePlanSlotsFromPlan({ 1: 99, 2: 99 }, alloc, config);

  assert.equal(slots.length, cap);
  assert.equal(slots.filter(Boolean).length, cap);
});

test("simulate reports skipped entrepreneurship plan slots", () => {
  const config = createBaseConfig();
  const alloc = {
    energy: 0,
    entrepreneurship: 4,
    production: 0,
    companies: 0,
    management: 0,
  };
  const cap = Math.floor(getStatsForAlloc(alloc).entrepreneurship / 10);
  config.entrePlanSlots = [1, null];

  const result = simulate(alloc, config);

  assert.equal(cap, 5);
  assert.equal(result.entreActionsSkippedPer10h, 4);
  assert.equal(result.entreActionsUnassignedPer10h, 4);
});

test("entrepreneurship five-point bar gains increase fractional regen profit", () => {
  const config = createBaseConfig();
  config.entrePlanSlots = [1, 1, 1, 1, 1];
  const level4Alloc = {
    energy: 0,
    entrepreneurship: 4,
    production: 0,
    companies: 0,
    management: 0,
  };
  const level5Alloc = {
    ...level4Alloc,
    entrepreneurship: 5,
  };

  const level4Result = simulate(level4Alloc, config);
  const level5Result = simulate(level5Alloc, config);

  assert.equal(level4Result.stats.entrepreneurship, 50);
  assert.equal(level5Result.stats.entrepreneurship, 55);
  assertApprox(level4Result.entreActionsCapPer10h, 5);
  assertApprox(level5Result.entreActionsCapPer10h, 5.5);
  assertApprox(level5Result.entreActionsEffectivePer10h, 5.5);
  assert.ok(level5Result.netProfitDay > level4Result.netProfitDay);
});

test("optimizeAllocationAndPlan keeps companies and management fixed during skill optimization", () => {
  const config = createBaseConfig();
  const currentAlloc = {
    energy: 0,
    entrepreneurship: 0,
    production: 0,
    companies: 1,
    management: 1,
  };

  const optimization = optimizeAllocationAndPlan({
    config,
    currentAlloc,
    optimizeSkill: true,
    optimizeEntrePlan: false,
  });

  assert.equal(optimization.error, null);
  assert.ok(optimization.bestAlloc);
  assert.equal(optimization.bestAlloc.companies, currentAlloc.companies);
  assert.equal(optimization.bestAlloc.management, currentAlloc.management);
  assert.ok(Number.isFinite(optimization.bestScore));
});

test("heuristic company optimizer returns specializations that match its best score", () => {
  const prices = createPriceMap(0);
  prices.limestone = 10;
  prices.iron = 1;

  const companyConfigs = [createCompany(1, "iron"), createCompany(2, "limestone")];
  const config = {
    ...createBaseConfig(),
    companyConfigs,
    configuredCompanies: companyConfigs.length,
    prices,
  };
  const alloc = {
    energy: 0,
    entrepreneurship: 0,
    production: 0,
    companies: 0,
    management: 0,
  };

  const optimization = heuristicOptimizeCompanySpecializations(alloc, config, companyConfigs);
  const resultForReturnedSpecializations = simulate(alloc, {
    ...config,
    companyConfigs: companyConfigs.map((company) => ({
      ...company,
      specialization: optimization.bestSpecializations[company.id] || company.specialization,
    })),
  });

  assert.equal(optimization.bestSpecializations[1], "limestone");
  assert.equal(optimization.bestSpecializations[2], "limestone");
  assert.equal(resultForReturnedSpecializations.netProfitDay, optimization.bestScore);
});
