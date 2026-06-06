import test from "node:test";
import assert from "node:assert/strict";

import {
  buildConfigSharePayload,
  buildConfigShareUrl,
  buildPlannerExportPayload,
  buildPlannerExportUrl,
  createScenarioExport,
  decodePlannerExportPayload,
  getConfigShareParamName,
  getPlannerExportParamName,
} from "../src/state/planner-export.js";

test("config share URL carries compressed simulator snapshots instead of result exports", async () => {
  const slotA = {
    savedAt: "2026-06-06T10:00:00.000Z",
    config: { level: 31, objective: "netProfitDay" },
    alloc: { energy: 1 },
    prices: { iron: 3 },
    materialProductionBonuses: { iron: 10 },
    companyConfigs: [{ id: 1, specialization: "iron" }],
    importMeta: { user: { id: "user-1", username: "Grox" } },
  };
  const slotB = {
    savedAt: "2026-06-06T11:00:00.000Z",
    config: { level: 31, objective: "companyPPDay" },
    alloc: { companies: 4, management: 5 },
    prices: { steel: 8 },
    companyConfigs: [{ id: 2, specialization: "steel" }],
  };

  const payload = buildConfigSharePayload({ active: "B", slotA, slotB });
  const url = await buildConfigShareUrl({
    origin: "https://warera.xorgress.com",
    pathname: "/eco-simulator/",
    payload,
  });

  const parsedUrl = new URL(url);
  const encoded = parsedUrl.searchParams.get(getConfigShareParamName());
  const decoded = await decodePlannerExportPayload(encoded);

  assert.equal(parsedUrl.pathname, "/eco-simulator/");
  assert.ok(encoded.startsWith("gz."));
  assert.equal(decoded.source, "warera-eco-simulator-config");
  assert.equal(decoded.active, "B");
  assert.deepEqual(decoded.slots.A.alloc, { energy: 1 });
  assert.equal(decoded.slots.A.prices.iron, 3);
  assert.deepEqual(decoded.slots.B.alloc, { companies: 4, management: 5 });
  assert.equal(decoded.slots.A.profitDay, undefined);
});

test("config share can omit prices and player summary", () => {
  const slotA = {
    config: { level: 31 },
    prices: { iron: 3 },
    materialProductionBonuses: { iron: 10 },
    importMeta: { user: { id: "user-1", username: "Grox" } },
  };

  const payload = buildConfigSharePayload({
    slotA,
    include: { prices: false, player: false },
  });

  assert.equal(payload.slots.A.prices, undefined);
  assert.equal(payload.slots.A.materialProductionBonuses, undefined);
  assert.equal(payload.slots.A.importMeta, undefined);
});

test("planner export URL carries compressed scenario A eco and scenario B war data", async () => {
  const snapshot = {
    savedAt: "2026-06-06T10:00:00.000Z",
    config: { level: 31, objective: "netProfitDay" },
    importMeta: {
      user: { id: "user-1", username: "Grox" },
    },
  };
  const result = {
    netProfitDay: 123.45,
    netProfitHour: 5.14,
    companiesActive: 6,
    configuredCompanies: 8,
    employeesActive: 12,
    totalSpentPoints: 21,
    totalPPDay: 300,
    companyPPDay: 240,
    workIncomeDay: 10,
    skillLevels: {
      energy: 1,
      entrepreneurship: 2,
      production: 3,
      companies: 4,
      management: 5,
    },
  };

  const payload = buildPlannerExportPayload({
    ecoScenario: createScenarioExport({ role: "eco", slot: "A", snapshot, result }),
    warScenario: createScenarioExport({ role: "war", slot: "B", snapshot, result }),
  });
  const url = await buildPlannerExportUrl({
    origin: "https://warera.xorgress.com",
    pathname: "/eco-simulator/",
    payload,
  });

  const parsedUrl = new URL(url);
  const encoded = parsedUrl.searchParams.get(getPlannerExportParamName());
  const decoded = await decodePlannerExportPayload(encoded);

  assert.equal(parsedUrl.pathname, "/eco-simulator/");
  assert.ok(encoded.startsWith("gz."));
  assert.equal(decoded.source, "warera-eco-simulator");
  assert.equal(decoded.scenarios.eco.slot, "A");
  assert.equal(decoded.scenarios.eco.profitDay, 123.45);
  assert.equal(decoded.scenarios.war.slot, "B");
  assert.equal(decoded.scenarios.war.reservedSkillPoints, 21);
  assert.equal(decoded.scenarios.war.skillLevels.companies, 4);
  assert.equal(decoded.scenarios.war.skillLevels.management, 5);
});

test("planner export can omit player and skill details", () => {
  const scenario = {
    role: "war",
    slot: "B",
    user: { id: "user-1", username: "Grox" },
    skillLevels: { companies: 4, management: 5 },
    reservedSkillPoints: 21,
  };

  const payload = buildPlannerExportPayload({
    ecoScenario: scenario,
    warScenario: scenario,
    include: { player: false, skills: false },
  });

  assert.equal(payload.scenarios.eco.user, undefined);
  assert.equal(payload.scenarios.eco.skillLevels, undefined);
  assert.equal(payload.scenarios.eco.reservedSkillPoints, undefined);
  assert.equal(payload.scenarios.war.user, undefined);
});
