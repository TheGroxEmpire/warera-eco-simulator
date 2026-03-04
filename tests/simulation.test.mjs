import test from "node:test";
import assert from "node:assert/strict";

import { MATERIALS } from "../src/config/constants.js";
import { optimizeAllocationAndPlan } from "../src/core/optimizer.js";
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
