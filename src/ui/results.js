import { getItemImagePath, getSkillCosts, getTotalSpentPoints } from "../core/simulation.js";
import { deltaSuffix, fmt } from "../core/math.js";

export function createResultsRenderer({
  getConfigFromInputs,
  getAllocationsFromInputs,
  renderEntrepreneurshipPlanEditor,
  getReferenceResult,
}) {
  function updatePointsSummary(config, alloc) {
    const summaryEl = document.getElementById("points-summary");
    const warningEl = document.getElementById("allocation-warning");
    const used = getTotalSpentPoints(alloc);
    const costs = getSkillCosts(alloc);
    const remaining = config.totalSkillPoints - used;

    summaryEl.textContent = `Total points: ${config.totalSkillPoints} | Spent: ${used} | Remaining: ${remaining} | Costs -> E:${costs.energy}, Ent:${costs.entrepreneurship}, P:${costs.production}, C:${costs.companies}, M:${costs.management}`;

    if (remaining < 0) {
      warningEl.classList.remove("hidden");
      warningEl.textContent = `Spent points exceed total by ${Math.abs(remaining)}. Lower one or more skill levels.`;
    } else {
      warningEl.classList.add("hidden");
      warningEl.textContent = "";
    }
  }

  function render(result) {
    renderEntrepreneurshipPlanEditor();
    const config = getConfigFromInputs();
    const alloc = getAllocationsFromInputs();
    updatePointsSummary(config, alloc);

    const capsWarningEl = document.getElementById("caps-warning");
    const companySummaryEl = document.getElementById("company-summary");
    const companyWarningEl = document.getElementById("company-warning");
    const planSummaryEl = document.getElementById("entre-plan-summary");
    const planWarningEl = document.getElementById("entre-plan-warning");
    const capWarnings = [];
    const companyWarnings = [];
    const planWarnings = [];

    if (result.configuredCompanies > result.stats.companies) {
      capWarnings.push(`Configured companies (${result.configuredCompanies}) exceed your companies limit (${result.stats.companies}). Only first ${result.companiesActive} companies are active.`);
    }
    if (result.requestedWorkersActive > result.stats.management) {
      capWarnings.push(`Assigned workers on active companies (${fmt(result.requestedWorkersActive, 2)}) exceed management limit (${result.stats.management}). Extra workers on later companies are inactive.`);
    }
    if (result.entreActionsRequestedInactiveCompaniesPer10h > 0) {
      capWarnings.push(`Entrepreneurship plan includes ${fmt(result.entreActionsRequestedInactiveCompaniesPer10h, 2)} actions/10h on inactive companies. These actions are ignored.`);
      planWarnings.push(`Inactive-company requested actions: ${fmt(result.entreActionsRequestedInactiveCompaniesPer10h, 2)} /10h ignored.`);
    }
    if (result.entreActionsOverCapPer10h > 0) {
      capWarnings.push(`Entrepreneurship plan exceeds cap by ${fmt(result.entreActionsOverCapPer10h, 2)} actions/10h. Extra actions on later companies are ignored.`);
      planWarnings.push(`Over cap by ${fmt(result.entreActionsOverCapPer10h, 2)} actions/10h; trimmed from later companies.`);
    }
    if (result.companiesActive <= 0 && result.entreActionsCapPer10h > 0) {
      capWarnings.push("No active company available for entrepreneurship actions. Entrepreneurship PP from self-work is currently 0.");
    }
    if (!result.isAllocationValid) {
      capWarnings.push("Skill allocation is invalid because spent points are above your available total.");
    }
    if (result.configuredCompanies === 0) {
      companyWarnings.push("No company is configured. Add companies in the setup section.");
    }
    if (result.inactiveCompanies > 0) {
      companyWarnings.push(`${result.inactiveCompanies} last-added companies are inactive due to company limit.`);
    }
    if (result.inactiveWorkersDueToManagement > 0) {
      companyWarnings.push(`${fmt(result.inactiveWorkersDueToManagement, 2)} workers are inactive due to management limit (applied from last-added workers on active companies).`);
    }
    if (result.workersInInactiveCompanies > 0) {
      companyWarnings.push(`${fmt(result.workersInInactiveCompanies, 2)} workers are inactive because their companies are inactive.`);
    }

    companySummaryEl.textContent = `Configured companies: ${result.configuredCompanies} | Active companies: ${result.companiesActive} | Workers(active requested/effective): ${fmt(result.requestedWorkersActive, 2)} / ${fmt(result.effectiveWorkersActive, 2)} | Inactive workers: ${fmt(result.totalInactiveWorkers, 2)} | Entre actions/10h (cap/requested/effective): ${fmt(result.entreActionsCapPer10h, 2)} / ${fmt(result.entreActionsRequestedPer10h, 2)} / ${fmt(result.entreActionsEffectivePer10h, 2)}`;

    if (planSummaryEl) {
      planSummaryEl.textContent = `Entre actions / 10h | Cap: ${fmt(result.entreActionsCapPer10h, 2)} | Requested: ${fmt(result.entreActionsRequestedPer10h, 2)} (Active ${fmt(result.entreActionsRequestedActivePer10h, 2)} + Inactive ${fmt(result.entreActionsRequestedInactiveCompaniesPer10h, 2)}) | Effective: ${fmt(result.entreActionsEffectivePer10h, 2)} | Unassigned: ${fmt(result.entreActionsUnassignedPer10h, 2)}`;
    }

    if (planWarningEl) {
      if (planWarnings.length > 0) {
        planWarningEl.classList.remove("hidden");
        planWarningEl.textContent = planWarnings.join(" ");
      } else {
        planWarningEl.classList.add("hidden");
        planWarningEl.textContent = "";
      }
    }

    if (companyWarnings.length > 0) {
      companyWarningEl.classList.remove("hidden");
      companyWarningEl.textContent = companyWarnings.join(" ");
    } else {
      companyWarningEl.classList.add("hidden");
      companyWarningEl.textContent = "";
    }

    if (capWarnings.length > 0) {
      capsWarningEl.classList.remove("hidden");
      capsWarningEl.textContent = capWarnings.join(" ");
    } else {
      capsWarningEl.classList.add("hidden");
      capsWarningEl.textContent = "";
    }

    const referenceResult = getReferenceResult();

    const resultGrid = document.getElementById("result-grid");
    const costs = getSkillCosts(result.skillLevels);
    const referenceCosts = referenceResult ? getSkillCosts(referenceResult.skillLevels) : null;

    const productionRows = result.productionBreakdown
      .filter((item) => item.companiesConfigured > 0 || item.producedDay > 0 || item.soldDay > 0 || item.boughtForProductionDay > 0)
      .map((item) => `
        <tr>
          <td><img class="item-icon" src="${getItemImagePath(item.id)}" alt="${item.name} icon"></td>
          <td>${item.name}</td>
          <td class="mono">${item.companiesActive}/${item.companiesConfigured}</td>
          <td class="mono">${fmt(item.producedDay, 2)}</td>
          <td class="mono">${fmt(item.consumedInternalDay, 2)}</td>
          <td class="mono">${fmt(item.boughtForProductionDay, 2)}</td>
          <td class="mono">${fmt(item.soldDay, 2)}</td>
          <td class="mono">${fmt(item.revenueDay, 2)}</td>
        </tr>
      `)
      .join("");

    resultGrid.innerHTML = `
      <article class="card">
        <h3>Skill Levels</h3>
        <p>Energy Level: <span class="mono">${result.skillLevels.energy}</span>${deltaSuffix(result.skillLevels.energy, referenceResult?.skillLevels.energy, 0)} (Cost <span class="mono">${costs.energy}</span>${deltaSuffix(costs.energy, referenceCosts?.energy, 0)})</p>
        <p>Entrepreneurship Level: <span class="mono">${result.skillLevels.entrepreneurship}</span>${deltaSuffix(result.skillLevels.entrepreneurship, referenceResult?.skillLevels.entrepreneurship, 0)} (Cost <span class="mono">${costs.entrepreneurship}</span>${deltaSuffix(costs.entrepreneurship, referenceCosts?.entrepreneurship, 0)})</p>
        <p>Production Level: <span class="mono">${result.skillLevels.production}</span>${deltaSuffix(result.skillLevels.production, referenceResult?.skillLevels.production, 0)} (Cost <span class="mono">${costs.production}</span>${deltaSuffix(costs.production, referenceCosts?.production, 0)})</p>
        <p>Companies Level: <span class="mono">${result.skillLevels.companies}</span>${deltaSuffix(result.skillLevels.companies, referenceResult?.skillLevels.companies, 0)} (Cost <span class="mono">${costs.companies}</span>${deltaSuffix(costs.companies, referenceCosts?.companies, 0)})</p>
        <p>Management Level: <span class="mono">${result.skillLevels.management}</span>${deltaSuffix(result.skillLevels.management, referenceResult?.skillLevels.management, 0)} (Cost <span class="mono">${costs.management}</span>${deltaSuffix(costs.management, referenceCosts?.management, 0)})</p>
        <p>Spent Points: <span class="mono">${result.totalSpentPoints}</span>${deltaSuffix(result.totalSpentPoints, referenceResult?.totalSpentPoints, 0)}</p>
      </article>
      <article class="card">
        <h3>Derived Stats</h3>
        <p>Energy Bar: <span class="mono">${result.stats.energy}</span>${deltaSuffix(result.stats.energy, referenceResult?.stats.energy, 0)}</p>
        <p>Entrepreneurship Bar: <span class="mono">${result.stats.entrepreneurship}</span>${deltaSuffix(result.stats.entrepreneurship, referenceResult?.stats.entrepreneurship, 0)}</p>
        <p>Production / Action: <span class="mono">${result.stats.production}</span>${deltaSuffix(result.stats.production, referenceResult?.stats.production, 0)}</p>
        <p>Companies Limit: <span class="mono">${result.stats.companies}</span>${deltaSuffix(result.stats.companies, referenceResult?.stats.companies, 0)}</p>
        <p>Management Limit: <span class="mono">${result.stats.management}</span>${deltaSuffix(result.stats.management, referenceResult?.stats.management, 0)}</p>
      </article>
      <article class="card">
        <h3>PP Flow</h3>
        <p>Work PP / Day: <span class="mono">${fmt(result.workPPDay)}</span>${deltaSuffix(result.workPPDay, referenceResult?.workPPDay)}</p>
        <p>Entre Actions / 10h (Cap | Requested | Effective): <span class="mono">${fmt(result.entreActionsCapPer10h, 2)} | ${fmt(result.entreActionsRequestedPer10h, 2)} | ${fmt(result.entreActionsEffectivePer10h, 2)}</span></p>
        <p>Manual Company PP / Day (base -> boosted): <span class="mono">${fmt(result.manualCompanyBasePPDay)} -> ${fmt(result.manualCompanyPPDay)}</span>${deltaSuffix(result.manualCompanyPPDay, referenceResult?.manualCompanyPPDay)}</p>
        <p>AE Company PP / Day: <span class="mono">${fmt(result.autoCompanyPPDay)}</span>${deltaSuffix(result.autoCompanyPPDay, referenceResult?.autoCompanyPPDay)}</p>
        <p>Employee PP / Day (raw -> boosted): <span class="mono">${fmt(result.employeeRawPPDay)} -> ${fmt(result.employeePPDay)}</span>${deltaSuffix(result.employeePPDay, referenceResult?.employeePPDay)}</p>
        <p>Company PP / Day: <span class="mono">${fmt(result.companyPPDay)}</span>${deltaSuffix(result.companyPPDay, referenceResult?.companyPPDay)}</p>
        <p>Used Company PP / Day: <span class="mono">${fmt(result.usedCompanyPPDay)}</span>${deltaSuffix(result.usedCompanyPPDay, referenceResult?.usedCompanyPPDay)}</p>
        <p>Wasted Company PP / Day: <span class="mono">${fmt(result.wastedCompanyPPDay)}</span>${deltaSuffix(result.wastedCompanyPPDay, referenceResult?.wastedCompanyPPDay)}</p>
        <p>Idle Company PP / Day: <span class="mono">${fmt(result.unusedCompanyPPDay)}</span>${deltaSuffix(result.unusedCompanyPPDay, referenceResult?.unusedCompanyPPDay)}</p>
        <p>Total PP / Day: <span class="mono">${fmt(result.totalPPDay)}</span>${deltaSuffix(result.totalPPDay, referenceResult?.totalPPDay)}</p>
        <p>Total PP / Hour: <span class="mono">${fmt(result.totalPPHour)}</span>${deltaSuffix(result.totalPPHour, referenceResult?.totalPPHour)}</p>
      </article>
      <article class="card">
        <h3>Production</h3>
        <p>Total Sellable Units / Day: <span class="mono">${fmt(result.unitsDay)}</span>${deltaSuffix(result.unitsDay, referenceResult?.unitsDay)}</p>
        <p>Total Sellable Units / Hour: <span class="mono">${fmt(result.unitsHour)}</span>${deltaSuffix(result.unitsHour, referenceResult?.unitsHour)}</p>
        <div class="table-wrap">
          <table class="prod-table">
            <thead>
              <tr>
                <th>Icon</th>
                <th>Item</th>
                <th>Factories A/C</th>
                <th>Produced/Day</th>
                <th>Used Internally</th>
                <th>Bought for Production</th>
                <th>Sold/Day</th>
                <th>Revenue/Day</th>
              </tr>
            </thead>
            <tbody>
              ${productionRows || `<tr><td colspan="8">No production configured.</td></tr>`}
            </tbody>
          </table>
        </div>
      </article>
      <article class="card">
        <h3>Profit</h3>
        <p>Work Wage Income / Day (raw PP): <span class="mono">${fmt(result.workIncomeDay)}</span>${deltaSuffix(result.workIncomeDay, referenceResult?.workIncomeDay)}</p>
        <p>Sales Revenue / Day: <span class="mono">${fmt(result.revenueDay)}</span>${deltaSuffix(result.revenueDay, referenceResult?.revenueDay)}</p>
        <p>Market Ingredient Cost / Day: <span class="mono">${fmt(result.ingredientCostDay)}</span>${deltaSuffix(result.ingredientCostDay, referenceResult?.ingredientCostDay)}</p>
        <p>Employee Payroll / Day (raw PP): <span class="mono">${fmt(result.payrollCostDay)}</span>${deltaSuffix(result.payrollCostDay, referenceResult?.payrollCostDay)}</p>
        <p>Net Profit / Day: <span class="mono">${fmt(result.netProfitDay)}</span>${deltaSuffix(result.netProfitDay, referenceResult?.netProfitDay)}</p>
        <p>Net Profit / Hour: <span class="mono">${fmt(result.netProfitHour)}</span>${deltaSuffix(result.netProfitHour, referenceResult?.netProfitHour)}</p>
      </article>
    `;
  }

  return { render };
}
