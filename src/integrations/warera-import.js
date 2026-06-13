import { MATERIAL_MAP, MATERIALS } from "../config/constants.js?v=20260330-09";

const WARERA_API_REMOTE_BASE_URL = "https://api2.warera.io/trpc";
const DIRECT_USER_ID_PATTERN = /^[a-f0-9]{24}$/i;
const COMPANY_PAGE_SIZE = 100;
const MAX_COMPANY_PAGES = 50;
const MAX_SEARCH_CANDIDATES_TO_VERIFY = 10;
const DEFAULT_WORKER_ENERGY_PER_10H = 100;
const DEFAULT_WORKER_PRODUCTION_PER_ACTION = 31;
const DEFAULT_COMPANY_WAGE = 0.135;
const WARERA_API_TIMEOUT_MS = 15000;
const PARTY_BATCH_SIZE = 100;
const WAGE_TRANSACTION_PAGE_SIZE = 25;
const MAX_WAGE_TRANSACTION_PAGES = 4;
const AMMO_OR_CONSTRUCTION_SPECIALIZATION_IDS = new Set([
  "limestone",
  "iron",
  "concrete",
  "steel",
  "wood",
  "paper",
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

  if (industrialism >= 2 && AMMO_OR_CONSTRUCTION_SPECIALIZATION_IDS.has(specialization)) {
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

function getErrorMessage(err, fallback = "Unknown error") {
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  return message || fallback;
}

function isAuthError(err) {
  const message = getErrorMessage(err, "");
  return Number(err?.status) === 401 || /\b(api token required|unauthorized|invalid token)\b/i.test(message);
}

function normalizeWareraApiToken(value) {
  return String(value || "").trim();
}

function normalizeEntityId(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  return normalizeEntityId(value._id ?? value.id ?? value.userId);
}

function normalizeWage(value, digits = 6) {
  const parsed = Number(value);
  const normalizedDigits = clamp(Math.floor(Number(digits) || 0), 0, 6);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(normalizedDigits)) : null;
}

function createWareraFetchWithApiToken(fetchImpl, apiToken) {
  const normalizedToken = normalizeWareraApiToken(apiToken);
  if (!normalizedToken) {
    return fetchImpl;
  }

  return (url, init = {}) => {
    const headers = new Headers(init?.headers || {});
    headers.set("X-API-Key", normalizedToken);
    return fetchImpl(url, {
      ...init,
      headers,
    });
  };
}

function normalizeProductionBonusOptions(options = {}) {
  return {
    ignoreDepositBonuses: options?.ignoreDepositBonuses === true || options?.ignoreDeposits === true,
  };
}

function normalizeImportOptions(options = {}) {
  const rawOptions = options?.importOptions && typeof options.importOptions === "object"
    ? options.importOptions
    : (options?.include && typeof options.include === "object" ? options.include : {});
  const companies = rawOptions.companies !== false;

  return {
    skills: rawOptions.skills !== false,
    companies,
    workers: companies && rawOptions.workers !== false,
    wages: rawOptions.wages !== false,
  };
}

function normalizeFetchImplAndBonusOptions(fetchImplOrOptions, maybeOptions) {
  if (typeof fetchImplOrOptions === "function") {
    const apiToken = normalizeWareraApiToken(maybeOptions?.apiToken ?? maybeOptions?.wareraApiToken);
    return {
      fetchImpl: fetchImplOrOptions,
      productionBonusOptions: normalizeProductionBonusOptions(maybeOptions),
      importOptions: normalizeImportOptions(maybeOptions),
      apiToken,
    };
  }

  const options = fetchImplOrOptions && typeof fetchImplOrOptions === "object" ? fetchImplOrOptions : {};
  const apiToken = normalizeWareraApiToken(options?.apiToken ?? options?.wareraApiToken);
  return {
    fetchImpl: typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch,
    productionBonusOptions: normalizeProductionBonusOptions(options),
    importOptions: normalizeImportOptions(options),
    apiToken,
  };
}

export class WareraApiError extends Error {
  constructor(message, { status = null, method = "", cause = null } = {}) {
    super(message);
    this.name = "WareraApiError";
    this.status = status;
    this.method = method;
    if (cause) {
      this.cause = cause;
    }
  }
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
    throw new WareraApiError(
      normalizeApiErrorMessage(payload, `WarEra API request failed for ${method}${response?.status ? ` (HTTP ${response.status})` : ""}.`),
      { status: response?.status || null, method },
    );
  }

  if (payload?.result?.data === undefined) {
    throw new Error(`Unexpected WarEra API response for ${method}.`);
  }

  return payload.result.data;
}

function chunkArray(values, size) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalizedSize = Math.max(1, Math.floor(Number(size) || 1));
  const chunks = [];
  for (let index = 0; index < values.length; index += normalizedSize) {
    chunks.push(values.slice(index, index + normalizedSize));
  }
  return chunks;
}

export async function callWareraApiBatch(method, inputs, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is not available in this environment.");
  }

  const normalizedInputs = Array.isArray(inputs) ? inputs : [];
  if (normalizedInputs.length === 0) {
    return [];
  }

  const url = new URL(`${getWareraApiBaseUrl()}/${normalizedInputs.map(() => method).join(",")}`);
  url.searchParams.set("batch", "1");
  url.searchParams.set(
    "input",
    JSON.stringify(
      Object.fromEntries(normalizedInputs.map((input, index) => [String(index), input])),
    ),
  );

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
      throw new Error(`WarEra API request timed out after ${Math.floor(WARERA_API_TIMEOUT_MS / 1000)}s for ${method} batch.`);
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

  if (!response.ok || !Array.isArray(payload)) {
    throw new WareraApiError(
      normalizeApiErrorMessage(payload, `WarEra API batch request failed for ${method}${response?.status ? ` (HTTP ${response.status})` : ""}.`),
      { status: response?.status || null, method },
    );
  }

  return payload.map((entry, index) => {
    if (entry?.error) {
      throw new WareraApiError(
        normalizeApiErrorMessage(entry, `WarEra API batch entry failed for ${method} at index ${index}.`),
        { status: entry?.error?.data?.httpStatus || response?.status || null, method },
      );
    }

    if (entry?.result?.data === undefined) {
      throw new Error(`Unexpected WarEra API batch response for ${method}.`);
    }

    return entry.result.data;
  });
}

async function fetchPartiesByIds(partyIds, fetchImpl) {
  const normalizedPartyIds = [...new Set((Array.isArray(partyIds) ? partyIds : []).filter(Boolean))];
  if (normalizedPartyIds.length === 0) {
    return {
      partiesById: new Map(),
      failedCount: 0,
    };
  }

  const chunks = chunkArray(normalizedPartyIds, PARTY_BATCH_SIZE);
  const chunkResults = await Promise.allSettled(
    chunks.map((chunk) => callWareraApiBatch(
      "party.getById",
      chunk.map((partyId) => ({ partyId })),
      fetchImpl,
    )),
  );

  const partiesById = new Map();
  let failedCount = 0;

  chunkResults.forEach((result, chunkIndex) => {
    const chunk = chunks[chunkIndex];
    if (result.status !== "fulfilled") {
      failedCount += chunk.length;
      return;
    }

    result.value.forEach((partyLite, partyIndex) => {
      const partyId = chunk[partyIndex];
      if (partyId && partyLite) {
        partiesById.set(partyId, partyLite);
      } else {
        failedCount += 1;
      }
    });
  });

  return {
    partiesById,
    failedCount,
  };
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

export function getRegionDepositProductionBonusPct(
  regionLite,
  specialization,
  now = new Date(),
  partyLite = null,
  options = {},
) {
  const { ignoreDepositBonuses } = normalizeProductionBonusOptions(options);
  if (ignoreDepositBonuses) {
    return 0;
  }

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
  options = {},
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
    + getRegionDepositProductionBonusPct(region, specialization, now, party, options)
  ).toFixed(6));
}

export function buildImportedWorkerConfig(workerRecord, workerLite = null) {
  const wage = Number(workerRecord?.wage) || 0;
  return {
    energyPer10h: workerLite ? getWorkerEnergyPer10h(workerLite) : DEFAULT_WORKER_ENERGY_PER_10H,
    productionPerAction: workerLite ? getWorkerProductionPerAction(workerLite) : DEFAULT_WORKER_PRODUCTION_PER_ACTION,
    fidelityPct: clamp(Number(workerRecord?.fidelity) || 0, 0, 10),
    wagePerPP: wage > 0 ? wage : 0.135,
  };
}

function getCompanyWorkerCount(companyLite) {
  return Math.max(0, Math.floor(Number(companyLite?.workerCount) || 0));
}

function buildDefaultWorkerRecordsFromCompany(companyLite) {
  return Array.from({ length: getCompanyWorkerCount(companyLite) }, () => ({
    wage: DEFAULT_COMPANY_WAGE,
    fidelity: 0,
  }));
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
      referenceData.productionBonusOptions,
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

  const { partiesById, failedCount } = await fetchPartiesByIds(partyIds, fetchImpl);

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
    } catch (err) {
      if (Number(err?.status) === 404) {
        throw new Error(`No WarEra user found for "${rawSearch}".`);
      }

      throw err;
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

function getPaginatedItems(pageData) {
  if (Array.isArray(pageData?.items)) {
    return pageData.items;
  }

  if (Array.isArray(pageData?.transactions)) {
    return pageData.transactions;
  }

  return Array.isArray(pageData) ? pageData : [];
}

async function fetchRecentWageTransactions(userId, fetchImpl) {
  const transactions = [];
  let cursor = null;

  for (let page = 0; page < MAX_WAGE_TRANSACTION_PAGES; page += 1) {
    const input = {
      userId,
      transactionType: "wage",
      limit: WAGE_TRANSACTION_PAGE_SIZE,
    };
    if (cursor) {
      input.cursor = cursor;
    }

    const pageData = await callWareraApi("transaction.getPaginatedTransactions", input, fetchImpl);
    const items = getPaginatedItems(pageData);
    transactions.push(...items);

    if (!pageData?.nextCursor || items.length === 0) {
      break;
    }

    cursor = pageData.nextCursor;
  }

  return transactions.sort((a, b) => {
    const aMs = new Date(a?.createdAt || 0).getTime();
    const bMs = new Date(b?.createdAt || 0).getTime();
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
}

function getWageTransactionCounterpartIds(transaction, userId) {
  const normalizedUserId = normalizeEntityId(userId).toLowerCase();
  const sellerId = normalizeEntityId(transaction?.sellerId);
  const buyerId = normalizeEntityId(transaction?.buyerId);
  if (sellerId && buyerId) {
    if (sellerId.toLowerCase() === normalizedUserId && buyerId.toLowerCase() !== normalizedUserId) {
      return [buyerId];
    }

    if (buyerId.toLowerCase() === normalizedUserId) {
      return [];
    }
  }

  const fields = [
    "sellerId",
    "buyerId",
    "seller",
    "buyer",
    "fromUser",
    "toUser",
    "from",
    "to",
    "sender",
    "recipient",
    "payer",
    "payee",
    "employer",
    "user",
  ];
  const containers = [
    transaction,
    transaction?.data,
    transaction?.metadata,
    transaction?.payload,
  ].filter((candidate) => candidate && typeof candidate === "object");

  const ids = [];
  for (const container of containers) {
    for (const field of fields) {
      const id = normalizeEntityId(container[field]);
      if (id && id.toLowerCase() !== normalizedUserId && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
}

function normalizeWorkerGroups(workerPayload) {
  if (Array.isArray(workerPayload?.workersPerCompany)) {
    return workerPayload.workersPerCompany
      .map((group) => ({
        company: group?.company || null,
        workers: Array.isArray(group?.workers) ? group.workers : [],
      }))
      .filter((group) => group.workers.length > 0);
  }

  if (Array.isArray(workerPayload?.workers)) {
    return [{
      company: workerPayload?.company || null,
      workers: workerPayload.workers,
    }];
  }

  if (Array.isArray(workerPayload)) {
    return [{
      company: null,
      workers: workerPayload,
    }];
  }

  if (workerPayload && typeof workerPayload === "object" && normalizeEntityId(workerPayload.user)) {
    return [{
      company: null,
      workers: [workerPayload],
    }];
  }

  return [];
}

async function getCompanyInfoForWorker(workerRecord, groupCompany, fetchImpl) {
  const companyId = normalizeEntityId(workerRecord?.company) || normalizeEntityId(groupCompany);
  if (!companyId) {
    return groupCompany || null;
  }

  try {
    return await callWareraApi("company.getById", { companyId }, fetchImpl);
  } catch {
    return groupCompany || { _id: companyId };
  }
}

function normalizeTaxPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 100) : 0;
}

function applyIncomeTaxToWage(wagePerPP, incomeTaxPct) {
  const grossWage = normalizeWage(wagePerPP);
  if (grossWage === null) {
    return null;
  }

  return normalizeWage(grossWage * (1 - normalizeTaxPercent(incomeTaxPct) / 100), 3);
}

async function getCompanyIncomeTaxPct(companyLite, fetchImpl) {
  const regionId = normalizeEntityId(companyLite?.region);
  if (!regionId) {
    return 0;
  }

  const region = await callWareraApi("region.getById", { regionId }, fetchImpl);
  const countryId = normalizeEntityId(region?.country);
  if (!countryId) {
    return 0;
  }

  const country = await callWareraApi("country.getCountryById", { countryId }, fetchImpl);
  return normalizeTaxPercent(country?.taxes?.income);
}

async function findCurrentWorkerRecordForEmployer(employeeId, employerId, fetchImpl) {
  if (!employeeId || !employerId || employeeId === employerId) {
    return null;
  }

  const workerPayload = await callWareraApi("worker.getWorkers", { userId: employerId }, fetchImpl);
  const groups = normalizeWorkerGroups(workerPayload);

  for (const group of groups) {
    for (const workerRecord of group.workers) {
      if (normalizeEntityId(workerRecord?.user) !== employeeId) {
        continue;
      }

      const workerEmployerId = normalizeEntityId(workerRecord?.employer);
      if (workerEmployerId && workerEmployerId !== employerId) {
        continue;
      }

      const grossWagePerPP = normalizeWage(workerRecord?.wage);
      if (grossWagePerPP === null) {
        continue;
      }

      const companyLite = await getCompanyInfoForWorker(workerRecord, group.company, fetchImpl);
      const companyOwnerId = normalizeEntityId(companyLite?.user);
      if (companyOwnerId && companyOwnerId === employeeId) {
        continue;
      }
      if (companyOwnerId && companyOwnerId !== employerId) {
        continue;
      }
      const incomeTaxPct = await getCompanyIncomeTaxPct(companyLite, fetchImpl);
      const wagePerPP = applyIncomeTaxToWage(grossWagePerPP, incomeTaxPct);
      if (wagePerPP === null) {
        continue;
      }

      return {
        wagePerPP,
        grossWagePerPP,
        incomeTaxPct,
        employerId,
        company: {
          id: normalizeEntityId(companyLite) || normalizeEntityId(workerRecord?.company),
          name: String(companyLite?.name || "").trim(),
          ownerId: companyOwnerId || employerId,
        },
      };
    }
  }

  return null;
}

async function fetchImportedOwnWage(userLite, fetchImpl, options = {}) {
  const userId = normalizeEntityId(userLite?._id);
  if (!userId || options?.apiTokenProvided !== true) {
    return {
      wagePerPP: null,
      source: null,
      wageTransactionsScanned: 0,
      warnings: [],
    };
  }

  let transactions = [];
  try {
    transactions = await fetchRecentWageTransactions(userId, fetchImpl);
  } catch (err) {
    const reasonText = getErrorMessage(err, "");
    const warnings = [
      isAuthError(err)
        ? "Own wage was not imported because WarEra rejected the saved API token or it lacks transaction access. Check your token in section 1, WarEra API Token, then import again."
        : `Own wage was not imported because recent wage transactions could not be loaded.${reasonText ? ` WarEra said: ${reasonText}.` : ""}`,
    ];

    return {
      wagePerPP: null,
      source: null,
      wageTransactionsScanned: 0,
      warnings,
    };
  }

  const employerResultCache = new Map();
  let wageTransactionsScanned = 0;

  for (const transaction of transactions) {
    wageTransactionsScanned += 1;
    const employerIds = getWageTransactionCounterpartIds(transaction, userId);
    for (const employerId of employerIds) {
      if (!employerResultCache.has(employerId)) {
        try {
          employerResultCache.set(
            employerId,
            await findCurrentWorkerRecordForEmployer(userId, employerId, fetchImpl),
          );
        } catch {
          employerResultCache.set(employerId, null);
        }
      }

      const wageMatch = employerResultCache.get(employerId);
      if (!wageMatch) {
        continue;
      }

      return {
        wagePerPP: wageMatch.wagePerPP,
        source: {
          ...wageMatch,
          transactionId: normalizeEntityId(transaction),
          transactionCreatedAt: typeof transaction?.createdAt === "string" ? transaction.createdAt : "",
        },
        wageTransactionsScanned,
        warnings: [],
      };
    }
  }

  return {
    wagePerPP: null,
    source: null,
    wageTransactionsScanned,
    warnings: [],
  };
}

async function fetchImportedCompanies(userLite, fetchImpl, options = {}) {
  const companyIds = await fetchAllCompanyIds(userLite._id, fetchImpl);
  const referenceData = await fetchImportReferenceData(fetchImpl);
  referenceData.productionBonusOptions = normalizeProductionBonusOptions(options);
  const includeWorkers = options?.includeWorkers !== false;
  const warnings = [...referenceData.warnings];
  const companyConfigs = [];
  let workersImported = 0;
  let workerProfilesMissing = 0;
  let workerListsUnavailable = 0;
  let defaultWorkersAdded = 0;
  let companiesSkipped = 0;
  const workerListErrorMessages = new Set();
  let workerListAuthFailures = 0;

  const companyResults = await Promise.allSettled(companyIds.map(async (companyId) => {
    const companyLite = await callWareraApi("company.getById", { companyId }, fetchImpl);

    if (!resolveMaterialIdFromItemCode(companyLite?.itemCode)) {
      return {
        companyLite,
        workers: [],
        workersUnavailable: false,
        defaultWorkerCount: 0,
      };
    }

    if (!includeWorkers) {
      return {
        companyLite,
        workers: [],
        workersUnavailable: false,
        defaultWorkerCount: 0,
      };
    }

    try {
      const workerPayload = await callWareraApi("worker.getWorkers", { companyId, userId: userLite._id }, fetchImpl);
      return {
        companyLite,
        workers: Array.isArray(workerPayload?.workers) ? workerPayload.workers : [],
        workersUnavailable: false,
        defaultWorkerCount: 0,
      };
    } catch (err) {
      const defaultWorkers = buildDefaultWorkerRecordsFromCompany(companyLite);

      return {
        companyLite,
        workers: defaultWorkers,
        workersUnavailable: true,
        defaultWorkerCount: defaultWorkers.length,
        workerError: err,
      };
    }
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

    const {
      companyLite,
      workers,
      workersUnavailable,
      defaultWorkerCount,
      workerError,
    } = result.value;
    const { workerProfilesById, missingProfiles } = await fetchWorkerProfiles(workers, fetchImpl);
    const companyConfig = buildImportedCompanyConfig(companyLite, workers, workerProfilesById, referenceData);

    if (!companyConfig) {
      companiesSkipped += 1;
      warnings.push(`Skipped unsupported company output "${companyLite?.itemCode || "unknown"}" on ${companyLite?.name || companyId}.`);
      continue;
    }

    companyConfigs.push(companyConfig);
    if (workersUnavailable) {
      workerListsUnavailable += 1;
      defaultWorkersAdded += defaultWorkerCount;
      workerListErrorMessages.add(getErrorMessage(workerError));
      if (isAuthError(workerError)) {
        workerListAuthFailures += 1;
      }
    } else {
      workersImported += workers.length;
    }
    workerProfilesMissing += missingProfiles;
  }

  if (workerListsUnavailable > 0) {
    const firstErrorMessage = [...workerListErrorMessages].find(Boolean);
    const hasApiToken = options?.apiTokenProvided === true;
    const reasonText = firstErrorMessage ? ` WarEra said: ${firstErrorMessage}.` : "";
    const defaultWorkerText = defaultWorkersAdded > 0
      ? ` Added ${defaultWorkersAdded} default ${defaultWorkersAdded === 1 ? "worker" : "workers"} from public worker counts; edit worker stats manually if needed.`
      : " Imported those companies without workers.";

    if (workerListAuthFailures > 0 && !hasApiToken) {
      warnings.push(`Worker data was not imported for ${workerListsUnavailable} ${workerListsUnavailable === 1 ? "company" : "companies"} because WarEra requires an API token for worker lists. Set your API token in section 1, WarEra API Token, then import again. Create the token in WarEra under Profile -> Settings.${defaultWorkerText}`);
    } else if (workerListAuthFailures > 0) {
      warnings.push(`Worker data was not imported for ${workerListsUnavailable} ${workerListsUnavailable === 1 ? "company" : "companies"}. WarEra rejected the saved API token or it lacks worker access.${reasonText} Check your token in section 1, WarEra API Token, then import again.${defaultWorkerText}`);
    } else {
      warnings.push(`Could not load private worker lists for ${workerListsUnavailable} ${workerListsUnavailable === 1 ? "company" : "companies"}.${reasonText}${defaultWorkerText}`);
    }
  }

  return {
    companyIds,
    companyConfigs,
    workersImported,
    workerProfilesMissing,
    workerListsUnavailable,
    defaultWorkersAdded,
    companiesSkipped,
    warnings,
  };
}

export async function fetchMaxMaterialProductionBonuses(fetchImplOrOptions = globalThis.fetch, maybeOptions = {}) {
  const { fetchImpl, productionBonusOptions, apiToken } = normalizeFetchImplAndBonusOptions(fetchImplOrOptions, maybeOptions);
  const wareraFetchImpl = createWareraFetchWithApiToken(fetchImpl, apiToken);

  try {
    const [countries, regionsData] = await Promise.all([
      callWareraApi("country.getAllCountries", undefined, wareraFetchImpl),
      productionBonusOptions.ignoreDepositBonuses
        ? Promise.resolve({})
        : callWareraApi("region.getRegionsObject", undefined, wareraFetchImpl),
    ]);

    const countriesById = new Map(
      (Array.isArray(countries) ? countries : [])
        .filter((country) => country?._id)
        .map((country) => [country._id, country]),
    );

    const regionsById = regionsData && typeof regionsData === "object" ? regionsData : {};

    // Collect unique party IDs that we need to fetch
    const partyIds = [...new Set(
      Array.from(countriesById.values())
        .map((country) => country?.rulingParty)
        .filter(Boolean),
    )];

    // Fetch all relevant parties
    let partiesById = new Map();
    if (partyIds.length > 0) {
      ({ partiesById } = await fetchPartiesByIds(partyIds, wareraFetchImpl));
    }

    const maxBonusByMaterial = {};
    const now = new Date();

    // For each material, find the maximum bonus available from current WarEra bonus sources.
    MATERIALS.forEach((material) => {
      let maxBonus = 0;

      if (productionBonusOptions.ignoreDepositBonuses) {
        countriesById.forEach((country) => {
          const party = country?.rulingParty ? partiesById.get(country.rulingParty) : null;
          const totalBonus = getCountryProductionBonusPct(country, material.id, party);

          if (totalBonus > maxBonus) {
            maxBonus = totalBonus;
          }
        });
      } else {
        Object.values(regionsById).forEach((region) => {
          if (!region) return;

          const country = region?.country ? countriesById.get(region.country) : null;
          const party = country?.rulingParty ? partiesById.get(country.rulingParty) : null;

          // Calculate country bonus for this specialization
          const countryBonus = getCountryProductionBonusPct(country, material.id, party);

          // Calculate deposit bonus for this specialization
          const depositBonus = getRegionDepositProductionBonusPct(region, material.id, now, party, productionBonusOptions);

          const totalBonus = countryBonus + depositBonus;

          if (totalBonus > maxBonus) {
            maxBonus = totalBonus;
          }
        });
      }

      if (maxBonus > 0) {
        maxBonusByMaterial[material.id] = maxBonus;
      }
    });

    return maxBonusByMaterial;
  } catch (error) {
    throw new WareraApiError(`Failed to fetch production bonuses: ${error.message}`, {
      status: error?.status || null,
      method: error?.method || "",
      cause: error,
    });
  }
}

export async function importWareraUserData(searchText, fetchImplOrOptions = globalThis.fetch, maybeOptions = {}) {
  const {
    fetchImpl,
    productionBonusOptions,
    importOptions,
    apiToken,
  } = normalizeFetchImplAndBonusOptions(fetchImplOrOptions, maybeOptions);
  const wareraFetchImpl = createWareraFetchWithApiToken(fetchImpl, apiToken);
  const { userLite, matchedBy, exactUsernameMatch, searchCandidateCount } = await resolveUserFromSearch(searchText, wareraFetchImpl);
  const importedCompanies = importOptions.companies
    ? await fetchImportedCompanies(userLite, wareraFetchImpl, {
      ...productionBonusOptions,
      apiTokenProvided: Boolean(apiToken),
      includeWorkers: importOptions.workers,
    })
    : {
      companyIds: [],
      companyConfigs: [],
      workersImported: 0,
      workerProfilesMissing: 0,
      workerListsUnavailable: 0,
      defaultWorkersAdded: 0,
      companiesSkipped: 0,
      warnings: [],
    };
  const importedOwnWage = importOptions.wages
    ? await fetchImportedOwnWage(userLite, wareraFetchImpl, {
      apiTokenProvided: Boolean(apiToken),
    })
    : {
      wagePerPP: null,
      source: null,
      wageTransactionsScanned: 0,
      warnings: [],
    };

  return {
    importOptions,
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
    ownWagePerPP: importedOwnWage.wagePerPP,
    ownWageSource: importedOwnWage.source,
    summary: {
      matchedBy,
      exactUsernameMatch,
      searchCandidateCount,
      companiesFound: importedCompanies.companyIds.length,
      companiesImported: importedCompanies.companyConfigs.length,
      companiesSkipped: importedCompanies.companiesSkipped,
      workersImported: importedCompanies.workersImported,
      workerProfilesMissing: importedCompanies.workerProfilesMissing,
      workerListsUnavailable: importedCompanies.workerListsUnavailable,
      defaultWorkersAdded: importedCompanies.defaultWorkersAdded,
      ownWageImported: importedOwnWage.wagePerPP !== null,
      wageTransactionsScanned: importedOwnWage.wageTransactionsScanned,
    },
    warnings: [
      ...importedCompanies.warnings,
      ...importedOwnWage.warnings,
    ],
  };
}
