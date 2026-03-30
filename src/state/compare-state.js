export function getOtherCompareSlot(slot) {
  return slot === "B" ? "A" : "B";
}

export function copySnapshotToOtherCompareSlot(compareState, snapshot, activeSlot = compareState?.active) {
  const normalizedActiveSlot = activeSlot === "B" ? "B" : "A";
  const targetSlot = getOtherCompareSlot(normalizedActiveSlot);

  return {
    active: normalizedActiveSlot,
    slots: {
      ...(compareState?.slots || {}),
      [normalizedActiveSlot]: snapshot,
      [targetSlot]: structuredClone(snapshot),
    },
  };
}

export function mergePricesIntoSnapshot(snapshot, prices, savedAt = new Date().toISOString()) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    ...snapshot,
    savedAt,
    prices: {
      ...(snapshot.prices || {}),
      ...(prices || {}),
    },
  };
}

export function updateCompareSlotsWithPrices(compareState, prices, savedAt = new Date().toISOString()) {
  return {
    active: compareState?.active === "B" ? "B" : "A",
    slots: {
      A: mergePricesIntoSnapshot(compareState?.slots?.A, prices, savedAt),
      B: mergePricesIntoSnapshot(compareState?.slots?.B, prices, savedAt),
    },
  };
}

export function getPriceSyncSummary(updated, missing = [], timestampText = new Date().toLocaleString()) {
  return `Synced ${updated} prices at ${timestampText} for Scenario A and Scenario B.${missing.length ? ` Missing in API: ${missing.join(", ")}.` : ""}`;
}
