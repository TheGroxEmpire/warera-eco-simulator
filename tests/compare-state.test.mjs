import test from "node:test";
import assert from "node:assert/strict";

import {
  copySnapshotToOtherCompareSlot,
  getOtherCompareSlot,
  getPriceSyncSummary,
  mergePricesIntoSnapshot,
  updateCompareSlotsWithPrices,
} from "../src/state/compare-state.js";

test("getOtherCompareSlot flips between A and B", () => {
  assert.equal(getOtherCompareSlot("A"), "B");
  assert.equal(getOtherCompareSlot("B"), "A");
  assert.equal(getOtherCompareSlot("anything-else"), "B");
});

test("copySnapshotToOtherCompareSlot copies active scenario into the other slot", () => {
  const snapshot = {
    savedAt: "2026-03-30T10:00:00.000Z",
    prices: { iron: 1.2 },
    config: { level: 21 },
  };
  const compareState = {
    active: "A",
    slots: {
      A: { savedAt: "old-a", prices: { iron: 0.9 } },
      B: { savedAt: "old-b", prices: { iron: 1.1 } },
    },
  };

  const updated = copySnapshotToOtherCompareSlot(compareState, snapshot);

  assert.equal(updated.active, "A");
  assert.deepEqual(updated.slots.A, snapshot);
  assert.deepEqual(updated.slots.B, snapshot);
  assert.notEqual(updated.slots.B, snapshot);
});

test("mergePricesIntoSnapshot preserves snapshot fields and replaces prices", () => {
  const merged = mergePricesIntoSnapshot(
    {
      savedAt: "old",
      config: { level: 20 },
      prices: { iron: 1, steel: 2 },
    },
    { steel: 2.5, oil: 0.4 },
    "new",
  );

  assert.deepEqual(merged, {
    savedAt: "new",
    config: { level: 20 },
    prices: { iron: 1, steel: 2.5, oil: 0.4 },
  });
});

test("updateCompareSlotsWithPrices refreshes both scenario snapshots", () => {
  const compareState = {
    active: "B",
    slots: {
      A: { savedAt: "a", prices: { iron: 1 } },
      B: { savedAt: "b", prices: { iron: 2, steel: 3 } },
    },
  };

  const updated = updateCompareSlotsWithPrices(compareState, { iron: 4, oil: 5 }, "2026-03-30T11:00:00.000Z");

  assert.equal(updated.active, "B");
  assert.deepEqual(updated.slots.A, {
    savedAt: "2026-03-30T11:00:00.000Z",
    prices: { iron: 4, oil: 5 },
  });
  assert.deepEqual(updated.slots.B, {
    savedAt: "2026-03-30T11:00:00.000Z",
    prices: { iron: 4, steel: 3, oil: 5 },
  });
});

test("getPriceSyncSummary mentions both scenarios and missing materials when present", () => {
  assert.equal(
    getPriceSyncSummary(5, ["Iron", "Steel"], "3/30/2026, 10:00:00 AM"),
    "Synced 5 prices at 3/30/2026, 10:00:00 AM for Scenario A and Scenario B. Missing in API: Iron, Steel.",
  );
});
