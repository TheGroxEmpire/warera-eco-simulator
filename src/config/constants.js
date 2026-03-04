export const BASE_STATS = {
  entrepreneurship: 30,
  energy: 30,
  production: 10,
  companies: 2,
  management: 4,
};

export const LEVEL_GAINS = {
  entrepreneurship: 5,
  energy: 10,
  production: 3,
  companies: 1,
  management: 2,
};

export const SKILL_KEYS = ["energy", "entrepreneurship", "production", "companies", "management"];
export const OPTIMIZED_SKILL_KEYS = ["energy", "entrepreneurship", "production"];
export const MAX_SKILL_LEVEL = 10;

export const AE_RATES = {
  1: 24,
  2: 48,
  3: 72,
  4: 96,
  5: 120,
  6: 144,
  7: 168,
};

export const CYCLES_PER_DAY = 24 / 10;

export const STORAGE_KEY = "warera-eco-simulator-v2";
export const COMPARE_STORAGE_KEY = "warera-eco-simulator-compare-v1";
export const LEGACY_REFERENCE_STORAGE_KEY = "warera-eco-simulator-reference-v1";
export const PRICE_API_URL = "https://api2.warera.io/trpc/itemTrading.getPrices";

export const MATERIALS = [
  { id: "limestone", name: "Limestone", pp: 1, ingredients: {} },
  { id: "iron", name: "Iron", pp: 1, ingredients: {} },
  { id: "petroleum", name: "Petroleum", pp: 1, ingredients: {} },
  { id: "concrete", name: "Concrete", pp: 10, ingredients: { limestone: 10 } },
  { id: "steel", name: "Steel", pp: 10, ingredients: { iron: 10 } },
  { id: "oil", name: "Oil", pp: 1, ingredients: { petroleum: 1 } },
  { id: "grain", name: "Grain", pp: 1, ingredients: {} },
  { id: "livestock", name: "Livestock", pp: 20, ingredients: {} },
  { id: "fish", name: "Fish", pp: 40, ingredients: {} },
  { id: "bread", name: "Bread", pp: 10, ingredients: { grain: 10 } },
  { id: "steak", name: "Steak", pp: 20, ingredients: { livestock: 1 } },
  { id: "cooked_fish", name: "Cooked Fish", pp: 40, ingredients: { fish: 1 } },
  { id: "lead", name: "Lead", pp: 1, ingredients: {} },
  { id: "light_ammo", name: "Light Ammo", pp: 1, ingredients: { lead: 1 } },
  { id: "ammo", name: "Ammo", pp: 4, ingredients: { lead: 4 } },
  { id: "heavy_ammo", name: "Heavy Ammo", pp: 16, ingredients: { lead: 16 } },
  { id: "mysterious_plant", name: "Mysterious Plant", pp: 1, ingredients: {} },
  { id: "pill", name: "Pill", pp: 200, ingredients: { mysterious_plant: 200 } },
];

export const MATERIAL_MAP = new Map(MATERIALS.map((material) => [material.id, material]));

export const DEFAULT_OBJECTIVE_KEY = "netProfitDay";

export const OBJECTIVES = {
  netProfitDay: { label: "Net Profit / Day", score: (result) => result.netProfitDay },
  totalPPDay: { label: "Total PP / Day", score: (result) => result.totalPPDay },
  companyPPDay: { label: "Company PP / Day", score: (result) => result.companyPPDay },
  unitsDay: { label: "Produced Units / Day", score: (result) => result.unitsDay },
  workIncomeDay: { label: "Work Wage Income / Day", score: (result) => result.workIncomeDay },
};
