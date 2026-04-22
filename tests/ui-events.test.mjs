import test from "node:test";
import assert from "node:assert/strict";

import { bindEvents } from "../src/ui/events.js";

class FakeControl {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.dataset = {};
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ target: this, ...event });
    }
  }
}

class FakeDocument {
  constructor(elements) {
    this.elements = elements;
    this.listeners = new Map();
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  dispatch(type, target) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ target });
    }
  }
}

function createRequiredElements() {
  const ids = [
    "companies-editor",
    "entre-plan-editor",
    "company-add-btn",
    "company-remove-btn",
    "optimize-btn",
    "sync-prices-btn",
    "sync-bonuses-btn",
    "compare-copy-btn",
    "compare-switch-btn",
  ];

  return new Map(ids.map((id) => [id, new FakeControl(id)]));
}

test("bindEvents rerenders for dynamically recreated material bonus inputs", () => {
  const elements = createRequiredElements();
  const fakeDocument = new FakeDocument(elements);
  const previousDocument = globalThis.document;
  globalThis.document = fakeDocument;

  let rerenderCount = 0;

  try {
    bindEvents({
      getCompanyConfigsMutable: () => [],
      createDefaultWorkerConfig: () => ({}),
      createDefaultCompanyConfig: () => ({ id: 1, workers: [] }),
      getEntrePlanSlotsState: () => [],
      setEntrePlanSlotsState: () => {},
      renderCompanyEditor: () => {},
      rerenderFromCurrentState: () => {
        rerenderCount += 1;
      },
      optimizeAllocation: () => {},
      syncPricesFromApi: () => {},
      syncProductionBonusesFromApi: () => {},
      importUserFromApi: () => {},
      copyCurrentScenarioToOtherSlot: () => {},
      switchCompareScenario: () => {},
    });

    const recreatedBonusInput = new FakeControl("material-bonus-iron");
    fakeDocument.dispatch("input", recreatedBonusInput);

    assert.equal(rerenderCount, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});
