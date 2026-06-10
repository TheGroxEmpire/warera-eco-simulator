import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  callWareraApi,
  fetchMaxMaterialProductionBonuses,
  getCountryProductionBonusPct,
  getImportedCompanyProductionBonusPct,
  getRegionDepositProductionBonusPct,
  importWareraUserData,
  resolveMaterialIdFromItemCode,
} from "../src/integrations/warera-import.js";

const TEST_ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.test");
const DEFAULT_LIVE_TEST_USER_ID = "698f5c7311b28721ff537bf6";

function unquoteEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadTestEnvFile(filePath = TEST_ENV_PATH) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1));
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

loadTestEnvFile();

function getTestEnvValue(key) {
  return String(process.env[key] || "").trim();
}

function getLiveTestUserId() {
  return getTestEnvValue("WARERA_TEST_USER_ID") || DEFAULT_LIVE_TEST_USER_ID;
}

function shouldRunLiveWareraTests() {
  return getTestEnvValue("WARERA_RUN_LIVE_TESTS") === "1";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("resolveMaterialIdFromItemCode maps WarEra API item codes to simulator materials", () => {
  assert.equal(resolveMaterialIdFromItemCode("cookedFish"), "cooked_fish");
  assert.equal(resolveMaterialIdFromItemCode("lightAmmo"), "light_ammo");
  assert.equal(resolveMaterialIdFromItemCode("wood"), "wood");
  assert.equal(resolveMaterialIdFromItemCode("paper"), "paper");
  assert.equal(resolveMaterialIdFromItemCode("coca"), "mysterious_plant");
  assert.equal(resolveMaterialIdFromItemCode("scraps"), null);
});

test("country and region bonus helpers derive company production bonus from specialization and active deposit", () => {
  const country = {
    _id: "country-1",
    specializedItem: "cookedFish",
    strategicResources: {
      bonuses: {
        productionPercent: 12.5,
      },
    },
  };
  const region = {
    _id: "region-1",
    country: "country-1",
    deposit: {
      type: "cookedFish",
      bonusPercent: 30,
      startsAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-04-01T00:00:00.000Z",
    },
  };
  const industrialParty = {
    ethics: {
      industrialism: 2,
    },
  };
  const agrarianParty = {
    ethics: {
      industrialism: -2,
    },
  };
  const fishCountry = {
    _id: "country-2",
    specializedItem: "fish",
    strategicResources: {
      bonuses: {
        productionPercent: 8,
      },
    },
  };
  const fishRegion = {
    _id: "region-2",
    country: "country-2",
    deposit: {
      type: "fish",
      bonusPercent: 30,
      startsAt: "2026-03-01T00:00:00.000Z",
      endsAt: "2026-04-01T00:00:00.000Z",
    },
  };
  const fishCompany = {
    itemCode: "fish",
    region: "region-2",
  };
  const ironCountry = {
    _id: "country-3",
    specializedItem: "iron",
    strategicResources: {
      bonuses: {
        productionPercent: 12.5,
      },
    },
  };
  const woodCountry = {
    _id: "country-4",
    specializedItem: "wood",
    strategicResources: {
      bonuses: {
        productionPercent: 7,
      },
    },
  };
  const paperCountry = {
    _id: "country-5",
    specializedItem: "paper",
    strategicResources: {
      bonuses: {
        productionPercent: 7,
      },
    },
  };
  const company = {
    itemCode: "cookedFish",
    region: "region-1",
  };

  assert.equal(getCountryProductionBonusPct(country, "cooked_fish"), 12.5);
  assert.equal(getRegionDepositProductionBonusPct(region, "cooked_fish", "2026-03-30T00:00:00.000Z"), 30);
  assert.equal(
    getImportedCompanyProductionBonusPct(company, { "region-1": region }, new Map([["country-1", country]]), new Map(), "2026-03-30T00:00:00.000Z"),
    42.5,
  );
  assert.equal(getRegionDepositProductionBonusPct(region, "fish", "2026-03-30T00:00:00.000Z"), 0);
  assert.equal(getRegionDepositProductionBonusPct(region, "cooked_fish", "2026-05-01T00:00:00.000Z"), 0);
  assert.equal(getRegionDepositProductionBonusPct(region, "cooked_fish", "2026-03-30T00:00:00.000Z", null, { ignoreDepositBonuses: true }), 0);
  assert.equal(
    getImportedCompanyProductionBonusPct(company, { "region-1": region }, new Map([["country-1", country]]), new Map(), "2026-03-30T00:00:00.000Z", { ignoreDepositBonuses: true }),
    12.5,
  );
  assert.equal(getCountryProductionBonusPct(country, "cooked_fish", industrialParty), 12.5);
  assert.equal(getCountryProductionBonusPct(ironCountry, "iron", industrialParty), 42.5);
  assert.equal(getRegionDepositProductionBonusPct(region, "cooked_fish", "2026-03-30T00:00:00.000Z", industrialParty), 0);
  assert.equal(getCountryProductionBonusPct(woodCountry, "wood", industrialParty), 37);
  assert.equal(getCountryProductionBonusPct(paperCountry, "paper", industrialParty), 37);
  assert.equal(getCountryProductionBonusPct(country, "cooked_fish", agrarianParty), 0);
  assert.equal(getRegionDepositProductionBonusPct(region, "cooked_fish", "2026-03-30T00:00:00.000Z", agrarianParty), 0);
  assert.equal(getCountryProductionBonusPct(fishCountry, "fish", agrarianParty), 0);
  assert.equal(getRegionDepositProductionBonusPct(fishRegion, "fish", "2026-03-30T00:00:00.000Z", agrarianParty), 60);
  assert.equal(
    getImportedCompanyProductionBonusPct(fishCompany, { "region-2": fishRegion }, new Map([["country-2", fishCountry]]), new Map(), "2026-03-30T00:00:00.000Z"),
    38,
  );
});

test("importWareraUserData converts live-style WarEra payloads into simulator state", async () => {
  const responses = new Map([
    ["search.searchAnything?{\"searchText\":\"Grox\"}", jsonResponse({
      result: {
        data: {
          userIds: ["user-other", "user-main"],
          hasData: true,
        },
      },
    })],
    ["user.getUserLite?{\"userId\":\"user-other\"}", jsonResponse({
      result: {
        data: {
          _id: "user-other",
          username: "NotGrox",
          leveling: { level: 5 },
          skills: {
            energy: { level: 0 },
            entrepreneurship: { level: 0 },
            production: { level: 0 },
            companies: { level: 0 },
            management: { level: 0 },
          },
        },
      },
    })],
    ["user.getUserLite?{\"userId\":\"user-main\"}", jsonResponse({
      result: {
        data: {
          _id: "user-main",
          username: "Grox",
          avatarUrl: "https://example.com/avatar.png",
          leveling: { level: 21 },
          skills: {
            energy: { level: 6, total: 90 },
            entrepreneurship: { level: 3, total: 45 },
            production: { level: 8, total: 34 },
            companies: { level: 6, total: 8 },
            management: { level: 1, total: 6 },
          },
        },
      },
    })],
    ["company.getCompanies?{\"userId\":\"user-main\",\"perPage\":100}", jsonResponse({
      result: {
        data: {
          items: ["company-supported", "company-unsupported"],
        },
      },
    })],
    ["company.getById?{\"companyId\":\"company-supported\"}", jsonResponse({
      result: {
        data: {
          _id: "company-supported",
          name: "Fish Co",
          itemCode: "cookedFish",
          region: "region-1",
          production: 0.185,
          activeUpgradeLevels: {
            automatedEngine: 5,
          },
        },
      },
    })],
    ["company.getById?{\"companyId\":\"company-unsupported\"}", jsonResponse({
      result: {
        data: {
          _id: "company-unsupported",
          name: "Scraps Co",
          itemCode: "scraps",
          region: "region-2",
          production: 0.2,
          activeUpgradeLevels: {
            automatedEngine: 2,
          },
        },
      },
    })],
    ["worker.getWorkers?{\"companyId\":\"company-supported\",\"userId\":\"user-main\"}", jsonResponse({
      result: {
        data: {
          workers: [
            { user: "worker-1", wage: 0.13, fidelity: 9 },
            { user: "worker-2", wage: 0.17, fidelity: 10 },
          ],
        },
      },
    })],
    ["worker.getWorkers?{\"companyId\":\"company-unsupported\",\"userId\":\"user-main\"}", jsonResponse({
      result: {
        data: {
          workers: [],
        },
      },
    })],
    ["user.getUserLite?{\"userId\":\"worker-1\"}", jsonResponse({
      result: {
        data: {
          _id: "worker-1",
          username: "Worker One",
          skills: {
            energy: { total: 120 },
            production: { total: 44 },
          },
        },
      },
    })],
    ["user.getUserLite?{\"userId\":\"worker-2\"}", jsonResponse({
      error: {
        message: "Worker profile unavailable",
      },
    }, 500)],
    ["country.getAllCountries?", jsonResponse({
      result: {
        data: [
          {
            _id: "country-1",
            specializedItem: "cookedFish",
            rulingParty: "party-1",
            strategicResources: {
              bonuses: {
                productionPercent: 12.5,
              },
            },
            rankings: {
              countryProductionBonus: {
                value: 12.5,
              },
            },
          },
          {
            _id: "country-2",
            specializedItem: "steel",
            rulingParty: "party-2",
            rankings: {
              countryProductionBonus: {
                value: 5,
              },
            },
          },
        ],
      },
    })],
    ["region.getRegionsObject?", jsonResponse({
      result: {
        data: {
          "region-1": {
            _id: "region-1",
            country: "country-1",
            deposit: {
              type: "cookedFish",
              bonusPercent: 30,
              startsAt: "2026-03-01T00:00:00.000Z",
              endsAt: "2026-04-01T00:00:00.000Z",
            },
          },
          "region-2": {
            _id: "region-2",
            country: "country-2",
          },
        },
      },
    })],
    ["party.getById?{\"partyId\":\"party-1\"}", jsonResponse({
      result: {
        data: {
          _id: "party-1",
          ethics: {
            militarism: 0,
            isolationism: 0,
            imperialism: 0,
            industrialism: 2,
          },
        },
      },
    })],
    ["party.getById?{\"partyId\":\"party-2\"}", jsonResponse({
      result: {
        data: {
          _id: "party-2",
          ethics: {
            militarism: 0,
            isolationism: 0,
            imperialism: 0,
            industrialism: 0,
          },
        },
      },
    })],
  ]);

  const fetchStub = async (url) => {
    const parsed = new URL(url);
    const method = parsed.pathname.split("/").pop();
    const input = parsed.searchParams.get("input");
    const batch = parsed.searchParams.get("batch");

    if (batch === "1" && method?.includes(",") && input) {
      const methods = method.split(",");
      const batchedInput = JSON.parse(input);
      const batchedPayload = methods.map((subMethod, index) => {
        const subInput = batchedInput?.[String(index)];
        const subKey = `${subMethod}?${JSON.stringify(subInput || {})}`;
        const subResponse = responses.get(subKey);

        if (!subResponse) {
          throw new Error(`Unexpected batched request entry: ${subKey}`);
        }

        return subResponse.clone().json();
      });

      return jsonResponse(await Promise.all(batchedPayload));
    }

    const key = `${method}?${input || ""}`;
    const response = responses.get(key);

    if (!response) {
      throw new Error(`Unexpected request: ${key}`);
    }

    return response.clone();
  };

  const imported = await importWareraUserData("Grox", fetchStub);

  assert.equal(imported.level, 21);
  assert.deepEqual(imported.alloc, {
    energy: 6,
    entrepreneurship: 3,
    production: 8,
    companies: 6,
    management: 1,
  });
  assert.equal(imported.user.username, "Grox");
  assert.equal(imported.summary.companiesFound, 2);
  assert.equal(imported.summary.companiesImported, 1);
  assert.equal(imported.summary.companiesSkipped, 1);
  assert.equal(imported.summary.workersImported, 2);
  assert.equal(imported.summary.workerProfilesMissing, 1);
  assert.equal(imported.summary.exactUsernameMatch, true);
  assert.equal(imported.warnings.length, 1);
  assert.match(imported.warnings[0], /Skipped unsupported company output/i);

  assert.equal(imported.companyConfigs.length, 1);
  assert.deepEqual(imported.companyConfigs[0], {
    specialization: "cooked_fish",
    aeLevel: 5,
    productionBonusPct: 12.5,
    manualActionsPer10h: 0,
    workers: [
      {
        energyPer10h: 120,
        productionPerAction: 44,
        fidelityPct: 9,
        wagePerPP: 0.13,
      },
      {
        energyPer10h: 100,
        productionPerAction: 31,
        fidelityPct: 10,
        wagePerPP: 0.17,
      },
    ],
    wagePerPP: 0.15,
  });
});

test("importWareraUserData keeps a company when its private worker list requires an API token", async () => {
  const userId = "698f5c7311b28721ff537bf6";
  const companyId = "69dee56f120676e0155a771d";
  const responses = new Map([
    [`user.getUserLite?{"userId":"${userId}"}`, jsonResponse({
      result: {
        data: {
          _id: userId,
          username: "GroxEmpire",
          leveling: { level: 28 },
          skills: {
            energy: { level: 5, total: 80 },
            entrepreneurship: { level: 10 },
            production: { level: 10, total: 48 },
            companies: { level: 10 },
            management: { level: 10 },
          },
        },
      },
    })],
    [`company.getCompanies?{"userId":"${userId}","perPage":100}`, jsonResponse({
      result: {
        data: {
          items: [companyId],
        },
      },
    })],
    [`company.getById?{"companyId":"${companyId}"}`, jsonResponse({
      result: {
        data: {
          _id: companyId,
          user: userId,
          name: "Xorgress 1",
          itemCode: "iron",
          region: "region-1",
          workerCount: 1,
          activeUpgradeLevels: {
            automatedEngine: 6,
          },
        },
      },
    })],
    [`worker.getWorkers?{"companyId":"${companyId}","userId":"${userId}"}`, jsonResponse({
      error: {
        message: "API token required",
        data: {
          code: "UNAUTHORIZED",
          httpStatus: 401,
        },
      },
    }, 401)],
    ["country.getAllCountries?", jsonResponse({
      result: {
        data: [],
      },
    })],
    ["region.getRegionsObject?", jsonResponse({
      result: {
        data: {},
      },
    })],
  ]);

  const fetchStub = async (url) => {
    const parsed = new URL(url);
    const method = parsed.pathname.split("/").pop();
    const input = parsed.searchParams.get("input");
    const key = `${method}?${input || ""}`;
    const response = responses.get(key);

    if (!response) {
      throw new Error(`Unexpected request: ${key}`);
    }

    return response.clone();
  };

  const imported = await importWareraUserData(userId, fetchStub);

  assert.equal(imported.summary.companiesFound, 1);
  assert.equal(imported.summary.companiesImported, 1);
  assert.equal(imported.summary.companiesSkipped, 0);
  assert.equal(imported.summary.workersImported, 0);
  assert.equal(imported.summary.workerListsUnavailable, 1);
  assert.equal(imported.summary.defaultWorkersAdded, 1);
  assert.match(imported.warnings.join(" "), /Set your API token in section 1, WarEra API Token/i);
  assert.match(imported.warnings.join(" "), /Profile -> Settings/i);

  assert.deepEqual(imported.companyConfigs, [
    {
      specialization: "iron",
      aeLevel: 6,
      productionBonusPct: 0,
      manualActionsPer10h: 0,
      workers: [
        {
          energyPer10h: 100,
          productionPerAction: 31,
          fidelityPct: 0,
          wagePerPP: 0.135,
        },
      ],
      wagePerPP: 0.135,
    },
  ]);
});

test("importWareraUserData sends a saved API token as X-API-Key", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const companyId = "company-token";
  const employerId = "employer-token";
  const outsideCompanyId = "outside-company";
  const apiToken = "wae_test_token";
  const privateRequestHeaders = [];
  const responses = new Map([
    [`user.getUserLite?{"userId":"${userId}"}`, jsonResponse({
      result: {
        data: {
          _id: userId,
          username: "TokenUser",
          leveling: { level: 10 },
          skills: {
            energy: { level: 1 },
            entrepreneurship: { level: 1 },
            production: { level: 1 },
            companies: { level: 1 },
            management: { level: 1 },
          },
        },
      },
    })],
    [`transaction.getPaginatedTransactions?{"userId":"${userId}","transactionType":"wage","limit":25}`, jsonResponse({
      result: {
        data: {
          items: [
            {
              _id: "wage-tx",
              sellerId: userId,
              buyerId: employerId,
              transactionType: "wage",
              money: 1.06,
              quantity: 10,
              createdAt: "2026-06-10T18:04:01.989Z",
            },
          ],
        },
      },
    })],
    [`worker.getWorkers?{"userId":"${employerId}"}`, jsonResponse({
      result: {
        data: {
          type: "user",
          workersPerCompany: [
            {
              company: {
                _id: outsideCompanyId,
                name: "Outside Co",
                itemCode: "iron",
              },
              workers: [
                {
                  _id: "outside-worker",
                  user: userId,
                  company: outsideCompanyId,
                  employer: employerId,
                  wage: 0.106,
                  fidelity: 8,
                },
              ],
            },
          ],
        },
      },
    })],
    [`company.getById?{"companyId":"${outsideCompanyId}"}`, jsonResponse({
      result: {
        data: {
          _id: outsideCompanyId,
          user: employerId,
          name: "Outside Co",
          itemCode: "iron",
          region: "region-outside",
        },
      },
    })],
    [`company.getCompanies?{"userId":"${userId}","perPage":100}`, jsonResponse({
      result: {
        data: {
          items: [companyId],
        },
      },
    })],
    [`company.getById?{"companyId":"${companyId}"}`, jsonResponse({
      result: {
        data: {
          _id: companyId,
          user: userId,
          name: "Token Co",
          itemCode: "steel",
          region: "region-token",
          workerCount: 1,
          activeUpgradeLevels: {
            automatedEngine: 1,
          },
        },
      },
    })],
    [`worker.getWorkers?{"companyId":"${companyId}","userId":"${userId}"}`, jsonResponse({
      result: {
        data: {
          workers: [
            { user: "worker-token", wage: 0.2, fidelity: 7 },
          ],
        },
      },
    })],
    [`user.getUserLite?{"userId":"worker-token"}`, jsonResponse({
      result: {
        data: {
          _id: "worker-token",
          username: "Worker Token",
          skills: {
            energy: { total: 110 },
            production: { total: 40 },
          },
        },
      },
    })],
    ["country.getAllCountries?", jsonResponse({
      result: {
        data: [],
      },
    })],
    ["region.getRegionsObject?", jsonResponse({
      result: {
        data: {},
      },
    })],
  ]);

  const fetchStub = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = parsed.pathname.split("/").pop();
    const input = parsed.searchParams.get("input");
    const key = `${method}?${input || ""}`;
    const response = responses.get(key);

    if (method === "worker.getWorkers" || method === "transaction.getPaginatedTransactions") {
      privateRequestHeaders.push(new Headers(init.headers || {}).get("X-API-Key"));
    }

    if (!response) {
      throw new Error(`Unexpected request: ${key}`);
    }

    return response.clone();
  };

  const imported = await importWareraUserData(userId, fetchStub, { apiToken: ` ${apiToken} ` });

  assert.deepEqual(privateRequestHeaders, [apiToken, apiToken, apiToken]);
  assert.equal(imported.summary.workersImported, 1);
  assert.equal(imported.summary.workerListsUnavailable, 0);
  assert.equal(imported.summary.ownWageImported, true);
  assert.equal(imported.summary.wageTransactionsScanned, 1);
  assert.equal(imported.ownWagePerPP, 0.106);
  assert.deepEqual(imported.ownWageSource.company, {
    id: outsideCompanyId,
    name: "Outside Co",
    ownerId: employerId,
  });
  assert.equal(imported.companyConfigs[0].workers[0].productionPerAction, 40);
});

test("importWareraUserData skips unchecked worker and wage imports", async () => {
  const userId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const companyId = "company-no-workers";
  const requestedMethods = [];
  const responses = new Map([
    [`user.getUserLite?{"userId":"${userId}"}`, jsonResponse({
      result: {
        data: {
          _id: userId,
          username: "SelectiveUser",
          leveling: { level: 12 },
          skills: {
            energy: { level: 2 },
            entrepreneurship: { level: 3 },
            production: { level: 4 },
            companies: { level: 5 },
            management: { level: 6 },
          },
        },
      },
    })],
    [`company.getCompanies?{"userId":"${userId}","perPage":100}`, jsonResponse({
      result: {
        data: {
          items: [companyId],
        },
      },
    })],
    [`company.getById?{"companyId":"${companyId}"}`, jsonResponse({
      result: {
        data: {
          _id: companyId,
          user: userId,
          name: "No Worker Co",
          itemCode: "iron",
          region: "region-selective",
          workerCount: 3,
          activeUpgradeLevels: {
            automatedEngine: 4,
          },
        },
      },
    })],
    ["country.getAllCountries?", jsonResponse({
      result: {
        data: [],
      },
    })],
    ["region.getRegionsObject?", jsonResponse({
      result: {
        data: {},
      },
    })],
  ]);

  const fetchStub = async (url) => {
    const parsed = new URL(url);
    const method = parsed.pathname.split("/").pop();
    const input = parsed.searchParams.get("input");
    const key = `${method}?${input || ""}`;
    requestedMethods.push(method);
    const response = responses.get(key);

    if (!response) {
      throw new Error(`Unexpected request: ${key}`);
    }

    return response.clone();
  };

  const imported = await importWareraUserData(userId, fetchStub, {
    apiToken: "wae_test_token",
    importOptions: {
      skills: false,
      companies: true,
      workers: false,
      wages: false,
    },
  });

  assert.deepEqual(imported.importOptions, {
    skills: false,
    companies: true,
    workers: false,
    wages: false,
  });
  assert.equal(imported.summary.companiesImported, 1);
  assert.equal(imported.summary.workersImported, 0);
  assert.equal(imported.summary.workerListsUnavailable, 0);
  assert.equal(imported.summary.ownWageImported, false);
  assert.equal(imported.ownWagePerPP, null);
  assert.deepEqual(imported.companyConfigs[0], {
    specialization: "iron",
    aeLevel: 4,
    productionBonusPct: 0,
    manualActionsPer10h: 0,
    workers: [],
    wagePerPP: 0.135,
  });
  assert.equal(requestedMethods.includes("worker.getWorkers"), false);
  assert.equal(requestedMethods.includes("transaction.getPaginatedTransactions"), false);
});

test("importWareraUserData preserves direct user ID rate limit errors", async () => {
  await assert.rejects(
    () => importWareraUserData("bbbbbbbbbbbbbbbbbbbbbbbb", async (url) => {
      const method = new URL(url).pathname.split("/").pop();
      if (method === "user.getUserLite") {
        return jsonResponse({
          error: {
            message: "Too many requests",
          },
        }, 429);
      }

      throw new Error(`Unexpected request: ${method}`);
    }),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.method, "user.getUserLite");
      assert.match(err.message, /Too many requests/);
      return true;
    },
  );
});

test("live WarEra API token imports worker lists", {
  skip: !shouldRunLiveWareraTests()
    ? "Set WARERA_RUN_LIVE_TESTS=1 and WARERA_API_TOKEN to run this live test."
    : (!getTestEnvValue("WARERA_API_TOKEN")
      ? "Set WARERA_API_TOKEN in .env.test to run this live test."
      : false),
}, async () => {
  const imported = await importWareraUserData(getLiveTestUserId(), globalThis.fetch, {
    apiToken: getTestEnvValue("WARERA_API_TOKEN"),
    ignoreDepositBonuses: true,
  });
  const warnings = imported.warnings.join(" ");

  assert.ok(imported.summary.companiesFound > 0, "The live test user should have at least one company.");
  assert.equal(imported.summary.workerListsUnavailable, 0, warnings);
  assert.doesNotMatch(warnings, /API token required|requires an API token|rejected the saved API token/i);
});

test("callWareraApi returns a clear message when the browser blocks the request", async () => {
  await assert.rejects(
    () => callWareraApi("search.searchAnything", { searchText: "Grox" }, async () => {
      throw new TypeError("Failed to fetch");
    }),
    /Could not reach the WarEra API from the browser/,
  );
});

test("callWareraApi preserves HTTP 429 status for rate limits", async () => {
  await assert.rejects(
    () => callWareraApi("region.getRegionsObject", undefined, async () => jsonResponse({
      error: {
        message: "Too many requests",
      },
    }, 429)),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.method, "region.getRegionsObject");
      assert.match(err.message, /Too many requests/);
      return true;
    },
  );
});

test("fetchMaxMaterialProductionBonuses can ignore active deposit bonuses", async () => {
  let regionRequests = 0;
  const fetchStub = async (url) => {
    const method = new URL(url).pathname.split("/").pop();

    if (method === "country.getAllCountries") {
      return jsonResponse({
        result: {
          data: [
            {
              _id: "country-1",
              specializedItem: "fish",
              strategicResources: {
                bonuses: {
                  productionPercent: 8,
                },
              },
            },
          ],
        },
      });
    }

    if (method === "region.getRegionsObject") {
      regionRequests += 1;
      return jsonResponse({
        result: {
          data: {
            "region-1": {
              _id: "region-1",
              country: "country-1",
              deposit: {
                type: "fish",
                bonusPercent: 30,
                startsAt: "2000-01-01T00:00:00.000Z",
                endsAt: "2100-01-01T00:00:00.000Z",
              },
            },
          },
        },
      });
    }

    throw new Error(`Unexpected request: ${method}`);
  };

  const withDeposits = await fetchMaxMaterialProductionBonuses(fetchStub);
  const withoutDeposits = await fetchMaxMaterialProductionBonuses(fetchStub, { ignoreDepositBonuses: true });

  assert.equal(withDeposits.fish, 38);
  assert.equal(withoutDeposits.fish, 8);
  assert.equal(regionRequests, 1);
});

test("fetchMaxMaterialProductionBonuses sends the API token to every WarEra request", async () => {
  const apiToken = "wae_bonus_token";
  const seenHeadersByMethod = new Map();
  const fetchStub = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = parsed.pathname.split("/").pop();
    seenHeadersByMethod.set(method, new Headers(init.headers || {}).get("X-API-Key"));

    if (method === "country.getAllCountries") {
      return jsonResponse({
        result: {
          data: [
            {
              _id: "country-1",
              specializedItem: "iron",
              rulingParty: "party-1",
              strategicResources: {
                bonuses: {
                  productionPercent: 8,
                },
              },
            },
          ],
        },
      });
    }

    if (method === "region.getRegionsObject") {
      return jsonResponse({
        result: {
          data: {
            "region-1": {
              _id: "region-1",
              country: "country-1",
            },
          },
        },
      });
    }

    if (method === "party.getById") {
      return jsonResponse([
        {
          result: {
            data: {
              _id: "party-1",
              ethics: {
                industrialism: 2,
              },
            },
          },
        },
      ]);
    }

    throw new Error(`Unexpected request: ${method}`);
  };

  const bonuses = await fetchMaxMaterialProductionBonuses(fetchStub, { apiToken });

  assert.equal(bonuses.iron, 38);
  assert.equal(seenHeadersByMethod.get("country.getAllCountries"), apiToken);
  assert.equal(seenHeadersByMethod.get("region.getRegionsObject"), apiToken);
  assert.equal(seenHeadersByMethod.get("party.getById"), apiToken);
});

test("fetchMaxMaterialProductionBonuses preserves rate limit status", async () => {
  await assert.rejects(
    () => fetchMaxMaterialProductionBonuses(async () => jsonResponse({
      error: {
        message: "Too many requests",
      },
    }, 429)),
    (err) => {
      assert.equal(err.status, 429);
      assert.match(err.message, /Failed to fetch production bonuses: Too many requests/);
      return true;
    },
  );
});
