import { MATERIAL_MAP, MATERIALS } from "../config/constants.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function bindEvents({
  getCompanyConfigsMutable,
  createDefaultWorkerConfig,
  createDefaultCompanyConfig,
  getEntrePlanSlotsState,
  setEntrePlanSlotsState,
  renderCompanyEditor,
  rerenderFromCurrentState,
  optimizeAllocation,
  syncPricesFromApi,
  switchCompareScenario,
}) {
  const inputIds = [
    "level",
    "alloc-energy",
    "alloc-entrepreneurship",
    "alloc-production",
    "alloc-companies",
    "alloc-management",
    "objective",
    "work-usage",
    "entre-usage",
    "company-utilization",
    "own-wage",
    "optimize-skill-toggle",
    "optimize-entre-plan-toggle",
    ...MATERIALS.map((material) => `price-${material.id}`),
  ];

  for (const id of inputIds) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }

    el.addEventListener("input", () => {
      rerenderFromCurrentState();
    });

    el.addEventListener("change", () => {
      rerenderFromCurrentState();
    });
  }

  const companiesEditorEl = document.getElementById("companies-editor");
  companiesEditorEl.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;
    const companyId = Number(target.dataset.companyId);
    const companyConfigsState = getCompanyConfigsMutable();
    const idx = companyConfigsState.findIndex((company) => company.id === companyId);

    if (action === "remove-company") {
      if (idx >= 0) {
        companyConfigsState.splice(idx, 1);
        renderCompanyEditor();
        rerenderFromCurrentState();
      }
      return;
    }

    if (idx < 0) {
      return;
    }

    const company = companyConfigsState[idx];

    if (action === "add-worker") {
      if (!Array.isArray(company.workers)) {
        company.workers = [];
      }
      company.workers.push(createDefaultWorkerConfig());
      renderCompanyEditor();
      rerenderFromCurrentState();
      return;
    }

    if (action === "remove-worker") {
      const workerIndex = Math.max(0, Math.floor(Number(target.dataset.workerIndex) || 0));
      if (!Array.isArray(company.workers)) {
        company.workers = [];
      }
      if (workerIndex < company.workers.length) {
        company.workers.splice(workerIndex, 1);
      }
      renderCompanyEditor();
      rerenderFromCurrentState();
    }
  });

  companiesEditorEl.addEventListener("change", (event) => {
    const changed = event.target.closest("[data-action='set-wage'], [data-action='set-ae'], [data-action='set-specialization'], [data-action='set-company-bonus'], [data-action='set-worker-fidelity'], [data-action='set-worker-energy'], [data-action='set-worker-production']");
    if (!changed) {
      return;
    }

    const companyId = Number(changed.dataset.companyId);
    const companyConfigsState = getCompanyConfigsMutable();
    const idx = companyConfigsState.findIndex((company) => company.id === companyId);
    if (idx < 0) {
      return;
    }

    const company = companyConfigsState[idx];
    const workerIndex = Math.max(0, Math.floor(Number(changed.dataset.workerIndex) || 0));
    const workerActions = ["set-worker-fidelity", "set-worker-energy", "set-worker-production"];

    if (changed.dataset.action === "set-wage") {
      company.wagePerPP = Math.max(0, Number(changed.value) || 0);
    } else if (changed.dataset.action === "set-ae") {
      company.aeLevel = clamp(Math.floor(Number(changed.value) || 1), 1, 7);
    } else if (changed.dataset.action === "set-specialization") {
      company.specialization = MATERIAL_MAP.has(changed.value) ? changed.value : company.specialization;
    } else if (changed.dataset.action === "set-company-bonus") {
      company.productionBonusPct = Math.max(0, Number(changed.value) || 0);
    } else if (changed.dataset.action === "set-worker-fidelity") {
      if (!Array.isArray(company.workers) || !company.workers[workerIndex]) {
        return;
      }
      company.workers[workerIndex].fidelityPct = clamp(Number(changed.value) || 0, 0, 10);
    } else if (changed.dataset.action === "set-worker-energy") {
      if (!Array.isArray(company.workers) || !company.workers[workerIndex]) {
        return;
      }
      company.workers[workerIndex].energyPer10h = Math.max(0, Number(changed.value) || 0);
    } else if (changed.dataset.action === "set-worker-production") {
      if (!Array.isArray(company.workers) || !company.workers[workerIndex]) {
        return;
      }
      company.workers[workerIndex].productionPerAction = Math.max(0, Number(changed.value) || 0);
    }

    if (
      changed.dataset.action === "set-specialization"
      || changed.dataset.action === "set-company-bonus"
      || workerActions.includes(changed.dataset.action)
    ) {
      renderCompanyEditor();
    }

    rerenderFromCurrentState();
  });

  const planEditorEl = document.getElementById("entre-plan-editor");
  const updatePlanSlot = (changed) => {
    const slotIndex = Math.max(0, Math.floor(Number(changed.dataset.slotIndex) || 0));
    const slots = getEntrePlanSlotsState();
    const companyId = Math.floor(Number(changed.value));
    slots[slotIndex] = Number.isInteger(companyId) && companyId > 0 ? companyId : null;
    setEntrePlanSlotsState(slots);
    rerenderFromCurrentState();
  };

  planEditorEl.addEventListener("input", (event) => {
    const changed = event.target.closest("[data-action='set-plan-slot']");
    if (!changed) {
      return;
    }
    updatePlanSlot(changed);
  });

  planEditorEl.addEventListener("change", (event) => {
    const changed = event.target.closest("[data-action='set-plan-slot']");
    if (!changed) {
      return;
    }
    updatePlanSlot(changed);
  });

  document.getElementById("company-add-btn").addEventListener("click", () => {
    const companyConfigsState = getCompanyConfigsMutable();
    companyConfigsState.push(createDefaultCompanyConfig());
    renderCompanyEditor();
    rerenderFromCurrentState();
  });

  document.getElementById("company-remove-btn").addEventListener("click", () => {
    const companyConfigsState = getCompanyConfigsMutable();
    if (companyConfigsState.length === 0) {
      return;
    }
    companyConfigsState.pop();
    renderCompanyEditor();
    rerenderFromCurrentState();
  });

  document.getElementById("optimize-btn").addEventListener("click", optimizeAllocation);
  document.getElementById("sync-prices-btn").addEventListener("click", () => {
    syncPricesFromApi();
  });
  document.getElementById("compare-switch-btn").addEventListener("click", switchCompareScenario);
}
