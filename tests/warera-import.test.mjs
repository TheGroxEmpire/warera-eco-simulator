import test from "node:test";
import assert from "node:assert/strict";

import {
  callWareraApi,
  fetchMaxMaterialProductionBonuses,
  getCountryProductionBonusPct,
  getImportedCompanyProductionBonusPct,
  getRegionDepositProductionBonusPct,
  importWareraUserData,
  resolveMaterialIdFromItemCode,
} from "../src/integrations/warera-import.js";

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
  assert.equal(getCountryProductionBonusPct(country, "cooked_fish", industrialParty), 42.5);
  assert.equal(getRegionDepositProductionBonusPct(region, "cooked_fish", "2026-03-30T00:00:00.000Z", industrialParty), 0);
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
    productionBonusPct: 42.5,
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
