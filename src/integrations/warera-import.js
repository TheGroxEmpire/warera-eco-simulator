import { MATERIAL_MAP } from "../config/constants.js?v=20260330-09";

const WARERA_API_REMOTE_BASE_URL = "https://api2.warera.io/trpc";
const DIRECT_USER_ID_PATTERN = /^[a-f0-9]{24}$/i;
const COMPANY_PAGE_SIZE = 100;
const MAX_COMPANY_PAGES = 50;
const MAX_SEARCH_CANDIDATES_TO_VERIFY = 10;
const DEFAULT_WORKER_ENERGY_PER_10H = 100;
const DEFAULT_WORKER_PRODUCTION_PER_ACTION = 31;
const DEFAULT_COMPANY_WAGE = 0.135;
const WARERA_API_TIMEOUT_MS = 15000;
const AMMO_OR_CONSTRUCTION_SPECIALIZATION_IDS = new Set([
  "limestone",
  "iron",
  "concrete",
  "steel",
  "lead",
  "light_ammo",
  "ammo",
  "heavy_ammo",
]);
const FOOD_OR_BUFF_DEPOSIT_IDS = new Set([
  "grain",
  "livestock",
  "fish",
  "mysterious_plant",
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return DEFAULT_COMPANY_WAGE;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function normalizeBonusPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(Math.max(0, parsed).toFixed(6));
}

function getPartyIndustrialismValue(partyLite) {
  return clamp(Math.floor(Number(partyLite?.ethics?.industrialism) || 0), -2, 2);
}

function getPartySpecializationBonusPct(partyLite, specialization) {
  const industrialism = getPartyIndustrialismValue(partyLite);
  if (!specialization) {
    return 0;
  }

  if (industrialism >= 2) {
    return 30;
  }

  if (industrialism >= 1 && AMMO_OR_CONSTRUCTION_SPECIALIZATION_IDS.has(specialization)) {
    return 10;
  }

  return 0;
}

function shouldApplyCountrySpecializationBonus(partyLite) {
  return getPartyIndustrialismValue(partyLite) > -2;
}

function shouldApplyRegionDepositBonus(partyLite, depositMaterialId) {
  const industrialism = getPartyIndustrialismValue(partyLite);
  if (industrialism >= 2) {
    return false;
  }

  if (industrialism <= -1) {
    return FOOD_OR_BUFF_DEPOSIT_IDS.has(depositMaterialId);
  }

  return true;
}

function getPartyDepositBonusPct(partyLite, depositMaterialId) {
  if (!depositMaterialId) {
    return 0;
  }

  const industrialism = getPartyIndustrialismValue(partyLite);
  if (industrialism <= -2 && FOOD_OR_BUFF_DEPOSIT_IDS.has(depositMaterialId)) {
    return 30;
  }

  if (industrialism <= -1 && FOOD_OR_BUFF_DEPOSIT_IDS.has(depositMaterialId)) {
    return 10;
  }

  return 0;
}

function normalizeApiErrorMessage(payload, fallback) {
  const rawMessage = payload?.error?.message;
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawMessage);
    if (Array.isArray(parsed) && parsed[0]?.message) {
      return parsed[0].message;
    }
  } catch {
    // Ignore JSON parse failures and fall back to the raw message below.
  }

  return rawMessage;
}

export function getWareraApiBaseUrl() {
  const pathname = globalThis?.window?.location?.pathname || "";
  const origin = globalThis?.window?.location?.origin || "";

  if (origin && pathname.startsWith("/eco-simulator")) {
    return `${origin}/eco-simulator/api`;
  }

  return WARERA_API_REMOTE_BASE_URL;
}

export async function callWareraApi(method, input, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is not available in this environment.");
  }

  const url = new URL(`${getWareraApiBaseUrl()}/${method}`);
  if (input && typeof input === "object") {
    url.searchParams.set("input", JSON.stringify(input));
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => {
      controller.abort();
    }, WARERA_API_TIMEOUT_MS)
    : null;

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        accept: "application/json",
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (err?.name === "AbortError") {
      throw new Error(`WarEra API request timed out after ${Math.floor(WARERA_API_TIMEOUT_MS / 1000)}s for ${method}.`);
    }

    if (err instanceof TypeError) {
      throw new Error("Could not reach the WarEra API from the browser. Check your connection or allow api2.warera.io in privacy/ad-block extensions. A blocked Cloudflare beacon script is unrelated.");
    }

    throw err;
  }

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    throw new Error(normalizeApiErrorMessage(payload, `WarEra API request failed for ${method}${response?.status ? ` (HTTP ${response.status})` : ""}.`));
  }

  if (payload?.result?.data === undefined) {
    throw new Error(`Unexpected WarEra API response for ${method}.`);
  }

  return payload.result.data;
}

export function resolveMaterialIdFromItemCode(itemCode) {
  const raw = String(itemCode || "").trim();
  if (!raw) {
    return null;
  }

  if (MATERIAL_MAP.has(raw)) {
    return raw;
  }

  const normalizedSnakeCase = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

  const aliasMap = {
    cookedfish: "cooked_fish",
    cooked_fish: "cooked_fish",
    lightammo: "light_ammo",
    light_ammo: "light_ammo",
    heavyammo: "heavy_ammo",
    heavy_ammo: "heavy_ammo",
    mysteriousplant: "mysterious_plant",
    mysterious_plant: "mysterious_plant",
    coca: "mysterious_plant",
    cocain: "pill",
  };

  const aliased = aliasMap[normalizedSnakeCase] || aliasMap[raw.toLowerCase()] || normalizedSnakeCase;
  return MATERIAL_MAP.has(aliased) ? aliased : null;
}

function getSkillLevel(userLite, skillKey) {
  return clamp(Math.floor(Number(userLite?.skills?.[skillKey]?.level) || 0), 0, 10);
}

function getWorkerEnergyPer10h(userLite) {
  return Math.max(
    0,
    Number(userLite?.skills?.energy?.total ?? userLite?.skills?.energy?.value ?? DEFAULT_WORKER_ENERGY_PER_10H) || 0,
  );
}

function getWorkerProductionPerAction(userLite) {
  return Math.max(
    0,
    Number(userLite?.skills?.production?.total ?? userLite?.skills?.production?.value ?? DEFAULT_WORKER_PRODUCTION_PER_ACTION) || 0,
  );
}

export function getCountryProductionBonusPct(countryLite, specialization, partyLite = null) {
  const specializedItem = resolveMaterialIdFromItemCode(countryLite?.specializedItem);
  if (!specialization || specializedItem !== specialization) {
    return 0;
  }

  if (!shouldApplyCountrySpecializationBonus(partyLite)) {
    return 0;
  }

  return Number((
    normalizeBonusPercent(
    countryLite?.strategicResources?.bonuses?.productionPercent
      ?? countryLite?.rankings?.countryProductionBonus?.value,
    )
    + getPartySpecializationBonusPct(partyLite, specialization)
  ).toFixed(6));
}

export function getRegionDepositProductionBonusPct(regionLite, specialization, now = new Date(), partyLite = null) {
  const deposit = regionLite?.deposit;
  if (!deposit) {
    return 0;
  }

  const depositItem = resolveMaterialIdFromItemCode(deposit?.type);
  if (!specialization || depositItem !== specialization) {
    return 0;
  }

  if (!shouldApplyRegionDepositBonus(partyLite, depositItem)) {
    return 0;
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startsAtMs = deposit?.startsAt ? new Date(deposit.startsAt).getTime() : Number.NEGATIVE_INFINITY;
  const endsAtMs = deposit?.endsAt ? new Date(deposit.endsAt).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isFinite(nowMs) && (nowMs < startsAtMs || nowMs > endsAtMs)) {
    return 0;
  }

  return Number((
    normalizeBonusPercent(deposit?.bonusPercent)
    + getPartyDepositBonusPct(partyLite, depositItem)
  ).toFixed(6));
}

export function getImportedCompanyProductionBonusPct(
  companyLite,
  regionsById = {},
  countriesById = new Map(),
  partiesById = new Map(),
  now = new Date(),
) {
  const specialization = resolveMaterialIdFromItemCode(companyLite?.itemCode);
  if (!specialization) {
    return 0;
  }

  const region = regionsById?.[companyLite?.region];
  const country = region?.country ? countriesById.get(region.country) : null;
  const party = country?.rulingParty ? partiesById.get(country.rulingParty) : null;

  return Number((
    getCountryProductionBonusPct(country, specialization, party)
    + getRegionDepositProductionBonusPct(region, specialization, now, party)
  ).toFixed(6));
}

export function buildImportedWorkerConfig(workerRecord, workerLite = null) {
  return {
    energyPer10h: workerLite ? getWorkerEnergyPer10h(workerLite) : DEFAULT_WORKER_ENERGY_PER_10H,
    productionPerAction: workerLite ? getWorkerProductionPerAction(workerLite) : DEFAULT_WORKER_PRODUCTION_PER_ACTION,
    fidelityPct: clamp(Number(workerRecord?.fidelity) || 0, 0, 10),
  };
}

export function buildImportedCompanyConfig(
  companyLite,
  workers = [],
  workerProfilesById = new Map(),
  referenceData = {},
) {
  const specialization = resolveMaterialIdFromItemCode(companyLite?.itemCode);
  if (!specialization) {
    return null;
  }

  const wageSamples = [];
  const workerConfigs = workers.map((worker) => {
    const wage = Number(worker?.wage);
    if (Number.isFinite(wage) && wage >= 0) {
      wageSamples.push(wage);
    }

    return buildImportedWorkerConfig(worker, workerProfilesById.get(worker?.user) || null);
  });

  return {
    specialization,
    aeLevel: clamp(Math.floor(Number(companyLite?.activeUpgradeLevels?.automatedEngine) || 1), 1, 7),
    productionBonusPct: getImportedCompanyProductionBonusPct(
      companyLite,
      referenceData.regionsById,
      referenceData.countriesById,
      referenceData.partiesById,
      referenceData.now,
    ),
    manualActionsPer10h: 0,
    workers: workerConfigs,
    wagePerPP: average(wageSamples),
  };
}

async function fetchImportReferenceData(fetchImpl) {
  try {
    const [countries, regionsById] = await Promise.all([
      callWareraApi("country.getAllCountries", undefined, fetchImpl),
      callWareraApi("region.getRegionsObject", undefined, fetchImpl),
    ]);

    return {
      countriesById: new Map(
        (Array.isArray(countries) ? countries : [])
          .filter((country) => country?._id)
          .map((country) => [country._id, country]),
      ),
      partiesById: new Map(),
      regionsById: regionsById && typeof regionsById === "object" ? regionsById : {},
      warnings: [],
      now: new Date(),
    };
  } catch {
    return {
      countriesById: new Map(),
      partiesById: new Map(),
      regionsById: {},
      warnings: [
        "Could not load country and region bonus data from WarEra. Imported company production bonuses were set to 0 where they could not be derived.",
      ],
      now: new Date(),
    };
  }
}

async function fetchRelevantRulingParties(companyResults, referenceData, fetchImpl) {
  const partyIds = [...new Set(
    companyResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => {
        const regionId = result.value?.companyLite?.region;
        const region = referenceData.regionsById?.[regionId];
        const country = region?.country ? referenceData.countriesById.get(region.country) : null;
        return country?.rulingParty || null;
      })
      .filter(Boolean),
  )];

  if (partyIds.length === 0) {
    return {
      partiesById: new Map(),
      warnings: [],
    };
  }

  const partyResults = await Promise.allSettled(
    partyIds.map((partyId) => callWareraApi("party.getById", { partyId }, fetchImpl)),
  );

  const partiesById = new Map();
  let failedCount = 0;

  for (let index = 0; index < partyResults.length; index += 1) {
    const result = partyResults[index];
    const partyId = partyIds[index];
    if (result.status === "fulfilled") {
      partiesById.set(partyId, result.value);
    } else {
      failedCount += 1;
    }
  }

  return {
    partiesById,
    warnings: failedCount > 0
      ? [`Could not load ${failedCount} ${failedCount === 1 ? "ruling party" : "ruling parties"} from WarEra. Some production bonuses may be missing party modifiers.`]
      : [],
  };
}

async function resolveUserFromSearch(searchText, fetchImpl) {
  const rawSearch = String(searchText || "").trim();
  if (!rawSearch) {
    throw new Error("Enter a WarEra username or user ID first.");
  }

  if (DIRECT_USER_ID_PATTERN.test(rawSearch)) {
    try {
      const userLite = await callWareraApi("user.getUserLite", { userId: rawSearch }, fetchImpl);
      return {
        userLite,
        matchedBy: "userId",
        exactUsernameMatch: true,
        searchCandidateCount: 1,
      };
    } catch {
      // Fall back to text search in case the pasted value is not a valid live user ID.
    }
  }

  const searchResult = await callWareraApi("search.searchAnything", { searchText: rawSearch }, fetchImpl);
  const userIds = Array.isArray(searchResult?.userIds) ? searchResult.userIds.filter(Boolean) : [];

  if (userIds.length === 0) {
    throw new Error(`No WarEra user found for "${rawSearch}".`);
  }

  const candidateIds = userIds.slice(0, MAX_SEARCH_CANDIDATES_TO_VERIFY);
  const candidateResults = await Promise.allSettled(
    candidateIds.map((userId) => callWareraApi("user.getUserLite", { userId }, fetchImpl)),
  );
  const candidateUsers = candidateResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  const normalizedSearch = rawSearch.toLowerCase();
  const exactMatch = candidateUsers.find((candidate) => String(candidate?.username || "").toLowerCase() === normalizedSearch);
  const selectedUser = exactMatch || candidateUsers[0];

  if (!selectedUser) {
    const userLite = await callWareraApi("user.getUserLite", { userId: userIds[0] }, fetchImpl);
    return {
      userLite,
      matchedBy: "search",
      exactUsernameMatch: false,
      searchCandidateCount: userIds.length,
    };
  }

  return {
    userLite: selectedUser,
    matchedBy: "search",
    exactUsernameMatch: Boolean(exactMatch),
    searchCandidateCount: userIds.length,
  };
}

async function fetchAllCompanyIds(userId, fetchImpl) {
  const ids = [];
  let cursor = null;

  for (let page = 0; page < MAX_COMPANY_PAGES; page += 1) {
    const input = { userId, perPage: COMPANY_PAGE_SIZE };
    if (cursor) {
      input.cursor = cursor;
    }

    const pageData = await callWareraApi("company.getCompanies", input, fetchImpl);
    const pageItems = Array.isArray(pageData?.items) ? pageData.items.filter(Boolean) : [];
    ids.push(...pageItems);

    if (!pageData?.nextCursor || pageItems.length === 0) {
      break;
    }

    cursor = pageData.nextCursor;
  }

  return [...new Set(ids)];
}

async function fetchWorkerProfiles(workers, fetchImpl) {
  const workerUserIds = [...new Set(
    workers
      .map((worker) => worker?.user)
      .filter(Boolean),
  )];

  const profileResults = await Promise.allSettled(
    workerUserIds.map((userId) => callWareraApi("user.getUserLite", { userId }, fetchImpl)),
  );

  const workerProfilesById = new Map();
  let missingProfiles = 0;

  for (let index = 0; index < profileResults.length; index += 1) {
    const result = profileResults[index];
    const workerUserId = workerUserIds[index];
    if (result.status === "fulfilled") {
      workerProfilesById.set(workerUserId, result.value);
    } else {
      missingProfiles += 1;
    }
  }

  return {
    workerProfilesById,
    missingProfiles,
  };
}

async function fetchImportedCompanies(userLite, fetchImpl) {
  const companyIds = await fetchAllCompanyIds(userLite._id, fetchImpl);
  const referenceData = await fetchImportReferenceData(fetchImpl);
  const warnings = [...referenceData.warnings];
  const companyConfigs = [];
  let workersImported = 0;
  let workerProfilesMissing = 0;
  let companiesSkipped = 0;

  const companyResults = await Promise.allSettled(companyIds.map(async (companyId) => {
    const [companyLite, workerPayload] = await Promise.all([
      callWareraApi("company.getById", { companyId }, fetchImpl),
      callWareraApi("worker.getWorkers", { companyId, userId: userLite._id }, fetchImpl),
    ]);

    return {
      companyLite,
      workers: Array.isArray(workerPayload?.workers) ? workerPayload.workers : [],
    };
  }));

  const partyReference = await fetchRelevantRulingParties(companyResults, referenceData, fetchImpl);
  referenceData.partiesById = partyReference.partiesById;
  warnings.push(...partyReference.warnings);

  for (let index = 0; index < companyResults.length; index += 1) {
    const result = companyResults[index];
    const companyId = companyIds[index];

    if (result.status !== "fulfilled") {
      companiesSkipped += 1;
      warnings.push(`Failed to import company ${companyId}.`);
      continue;
    }

    const { companyLite, workers } = result.value;
    const { workerProfilesById, missingProfiles } = await fetchWorkerProfiles(workers, fetchImpl);
    const companyConfig = buildImportedCompanyConfig(companyLite, workers, workerProfilesById, referenceData);

    if (!companyConfig) {
      companiesSkipped += 1;
      warnings.push(`Skipped unsupported company output "${companyLite?.itemCode || "unknown"}" on ${companyLite?.name || companyId}.`);
      continue;
    }

    companyConfigs.push(companyConfig);
    workersImported += workers.length;
    workerProfilesMissing += missingProfiles;
  }

  return {
    companyIds,
    companyConfigs,
    workersImported,
    workerProfilesMissing,
    companiesSkipped,
    warnings,
  };
}

export async function importWareraUserData(searchText, fetchImpl = globalThis.fetch) {
  const { userLite, matchedBy, exactUsernameMatch, searchCandidateCount } = await resolveUserFromSearch(searchText, fetchImpl);
  const importedCompanies = await fetchImportedCompanies(userLite, fetchImpl);

  return {
    level: Math.max(1, Math.floor(Number(userLite?.leveling?.level) || 1)),
    alloc: {
      energy: getSkillLevel(userLite, "energy"),
      entrepreneurship: getSkillLevel(userLite, "entrepreneurship"),
      production: getSkillLevel(userLite, "production"),
      companies: getSkillLevel(userLite, "companies"),
      management: getSkillLevel(userLite, "management"),
    },
    companyConfigs: importedCompanies.companyConfigs,
    user: {
      id: String(userLite?._id || ""),
      username: String(userLite?.username || "Unknown User"),
      avatarUrl: userLite?.avatarUrl || "",
    },
    summary: {
      matchedBy,
      exactUsernameMatch,
      searchCandidateCount,
      companiesFound: importedCompanies.companyIds.length,
      companiesImported: importedCompanies.companyConfigs.length,
      companiesSkipped: importedCompanies.companiesSkipped,
      workersImported: importedCompanies.workersImported,
      workerProfilesMissing: importedCompanies.workerProfilesMissing,
    },
    warnings: importedCompanies.warnings,
  };
}
