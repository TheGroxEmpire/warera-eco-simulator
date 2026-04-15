import { AE_RATES, MATERIAL_MAP, MATERIALS } from "../config/constants.js?v=20260330-09";
import { getActiveCompaniesForAlloc, getItemImagePath, getStatsForAlloc } from "../core/simulation.js?v=20260330-09";

export function createEditorUI({
  getConfigFromInputs,
  getAllocationsFromInputs,
  getCompanyConfigsMutable,
  getEntrePlanSlotsState,
  setEntrePlanSlotsState,
}) {
  function buildMaterialInputs() {
    const priceGrid = document.getElementById("price-grid");
    priceGrid.innerHTML = MATERIALS.map((material) => `
      <label class="price-row">
        <img class="item-icon" src="${getItemImagePath(material.id)}" alt="${material.name} icon" loading="lazy">
        <span>${material.name} Price</span>
        <div class="price-input-wrap">
          <input id="price-${material.id}" type="number" min="0" step="0.01" value="1">
        </div>
      </label>
    `).join("");
  }

  function buildMaterialBonusInputs() {
    const bonusGrid = document.getElementById("bonus-grid");
    if (!bonusGrid) return;
    bonusGrid.innerHTML = MATERIALS.map((material) => {
      const currentValue = document.getElementById(`material-bonus-${material.id}`)?.value || "0";
      return `
      <label class="price-row">
        <img class="item-icon" src="${getItemImagePath(material.id)}" alt="${material.name} icon" loading="lazy">
        <span>${material.name} Bonus %</span>
        <div class="price-input-wrap">
          <input id="material-bonus-${material.id}" type="number" min="0" step="0.1" value="${currentValue}">
        </div>
      </label>
    `;
    }).join("");
  }

  function syncEntrePlanSlotsForCurrentContext(config, alloc) {
    const stats = getStatsForAlloc(alloc);
    const capPer10h = Math.max(0, Math.floor(stats.entrepreneurship / 10));
    const activeCompanies = getActiveCompaniesForAlloc(alloc, config);
    const activeIds = new Set(activeCompanies.map((company) => company.id));
    const currentSlots = getEntrePlanSlotsState();
    const nextSlots = [];

    for (let i = 0; i < capPer10h; i += 1) {
      const currentId = currentSlots[i];
      nextSlots.push(currentId && activeIds.has(currentId) ? currentId : null);
    }

    setEntrePlanSlotsState(nextSlots);
    return { capPer10h, activeCompanies, slots: nextSlots };
  }

  function renderEntrepreneurshipPlanEditor() {
    const editorEl = document.getElementById("entre-plan-editor");
    if (!editorEl) {
      return;
    }

    const config = getConfigFromInputs();
    const alloc = getAllocationsFromInputs();
    const { capPer10h, activeCompanies, slots } = syncEntrePlanSlotsForCurrentContext(config, alloc);

    if (capPer10h <= 0) {
      editorEl.innerHTML = `<p class="hint worker-empty">No entrepreneurship actions available per 10h at current skill level.</p>`;
      return;
    }

    if (activeCompanies.length === 0) {
      editorEl.innerHTML = `<p class="hint worker-empty">No active company available. Increase Companies Limit skill or reduce configured companies.</p>`;
      return;
    }

    const companyConfigsState = getCompanyConfigsMutable();

    editorEl.innerHTML = slots.map((companyId, index) => `
      <div class="entre-plan-row">
        <span class="entre-plan-company mono">Action ${index + 1}</span>
        <select data-action="set-plan-slot" data-slot-index="${index}">
          <option value="">Skip</option>
          ${activeCompanies.map((company, activeIndex) => {
    const material = MATERIAL_MAP.get(company.specialization) || MATERIALS[0];
    const selected = company.id === companyId ? "selected" : "";
    const displayIndex = companyConfigsState.findIndex((candidate) => candidate.id === company.id) + 1;
    const labelIndex = displayIndex > 0 ? displayIndex : (activeIndex + 1);
    return `<option value="${company.id}" ${selected}>Company ${labelIndex} (${material.name})</option>`;
  }).join("")}
        </select>
      </div>
    `).join("");
  }

  function renderCompanyEditor() {
    const editorEl = document.getElementById("companies-editor");
    if (!editorEl) {
      return;
    }

    const config = getConfigFromInputs();
    const alloc = getAllocationsFromInputs();
    const activeCompanyIds = new Set(getActiveCompaniesForAlloc(alloc, config).map((company) => company.id));
    const companyConfigsState = getCompanyConfigsMutable();

    if (companyConfigsState.length === 0) {
      editorEl.innerHTML = `<p class="hint worker-empty">No companies configured yet.</p>`;
      renderEntrepreneurshipPlanEditor();
      return;
    }

    editorEl.innerHTML = companyConfigsState.map((company, index) => {
      const material = MATERIAL_MAP.get(company.specialization) || MATERIALS[0];
      const workers = Array.isArray(company.workers) ? company.workers : [];
      const isActive = activeCompanyIds.has(company.id);

      const workersMarkup = workers.length === 0
        ? `<p class="hint worker-empty">No workers added yet.</p>`
        : `
          <div class="worker-grid-head">
            <span class="mono">#</span>
            <span>P / Act</span>
            <span>E / 10h</span>
            <span>Wage</span>
            <span>Fidelity</span>
            <span></span>
          </div>
          ${workers.map((worker, workerIndex) => `
            <div class="worker-grid-row">
              <span class="worker-no mono">${workerIndex + 1}</span>
              <input type="number" min="0" step="0.1" value="${worker.productionPerAction}" data-action="set-worker-production" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Production per Action">
              <input type="number" min="0" step="1" value="${worker.energyPer10h}" data-action="set-worker-energy" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Energy per 10h">
              <input type="number" min="0" step="0.01" value="${worker.wagePerPP}" data-action="set-worker-wage" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Wage per PP">
              <input type="number" min="0" max="10" step="0.1" value="${worker.fidelityPct}" data-action="set-worker-fidelity" data-company-id="${company.id}" data-worker-index="${workerIndex}" aria-label="Worker ${workerIndex + 1} Fidelity Percent">
              <button type="button" class="inline-btn worker-remove-btn" data-action="remove-worker" data-company-id="${company.id}" data-worker-index="${workerIndex}">Remove</button>
            </div>
          `).join("")}
        `;

      return `
        <article class="company-card" data-company-id="${company.id}">
          <div class="company-head">
            <div class="company-head-title">
              <h3>Company ${index + 1}</h3>
              <p class="company-status ${isActive ? "company-status-active" : "company-status-inactive"}">${isActive ? "Active" : "Inactive (over company limit)"}</p>
            </div>
            <button type="button" class="inline-btn" data-action="remove-company" data-company-id="${company.id}">Remove</button>
          </div>
          <label>
            Specialization
            <select class="spec-select" style="background-image: url('${getItemImagePath(material.id)}');" data-action="set-specialization" data-company-id="${company.id}">
              ${MATERIALS.map((entry) => `<option value="${entry.id}" ${entry.id === company.specialization ? "selected" : ""}>${entry.name}</option>`).join("")}
            </select>
          </label>
          <label>
            Company AE Level
            <select data-action="set-ae" data-company-id="${company.id}">
              ${Object.entries(AE_RATES).map(([level, rate]) => `<option value="${level}" ${Number(level) === company.aeLevel ? "selected" : ""}>AE ${level} (${rate}/day)</option>`).join("")}
            </select>
          </label>
          <div class="worker-row">
            <span>Workers: <span class="mono">${workers.length}</span></span>
            <button type="button" class="inline-btn" data-action="add-worker" data-company-id="${company.id}">+ Add Worker</button>
          </div>
          <div class="worker-list">${workersMarkup}</div>
        </article>
      `;
    }).join("");

    renderEntrepreneurshipPlanEditor();
  }

  return {
    buildMaterialInputs,
    buildMaterialBonusInputs,
    renderEntrepreneurshipPlanEditor,
    renderCompanyEditor,
  };
}
