# WarEra Economy Skill Simulator

Browser-only simulator for WarEra economy optimization.

## Setup

1. Static web app
2. Served by Nginx
3. Containerized with Docker for portability and stable deployment

Docker is not mandatory, but it is the most reliable way to run the same app config on this server and future servers.

## Run Options

### Docker Locally

```bash
docker compose up -d --build
```

Open: `http://localhost:8080/eco-simulator/`

### Docker Behind Traefik

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Open: `https://warera.xorgress.com/eco-simulator/`

The Traefik override removes the direct host port binding, joins the external proxy network, and routes `WARERA_HOST` plus `APP_BASE_PATH` to the Nginx container.

### No Docker

```bash
python3 -m http.server 8080
```

Open: `http://<server-ip>:8080`

## Deployment

This repository includes the same GitHub Actions deployment pattern used by WarEra Monetary Watch. Pushes to `master` or `main` run CI, then the deploy workflow SSHes into the server, pulls the pushed branch, and runs `scripts/deploy.sh`.

Configure these repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PORT`
- `DEPLOY_PATH` set to `/home/opc/docker/warera-eco-simulator`
- `DEPLOY_ENABLE_TRAEFIK` set to `1`

Configure this repository variable so the deployment appears with the correct link on the GitHub Deployments page:

- `DEPLOY_URL` set to `https://warera.xorgress.com/eco-simulator/`

Manual server deploy:

```bash
ENABLE_TRAEFIK=1 bash scripts/deploy.sh
```

## Development checks

This repository now includes a small, dependency-free Node workflow for quality checks.

```bash
npm run check   # syntax checks for modular source files
npm test        # core simulation/optimizer tests (node:test)
```

Optional live WarEra API-token test:

```bash
cp .env.test.example .env.test
# edit .env.test and set WARERA_API_TOKEN
npm run test:live
```

`.env.test` is ignored by git. `WARERA_TEST_USER_ID` is optional; it overrides the default live-test user if you want to verify a different account with at least one company.

No build step is required. The app runs directly in the browser via ES modules.

## Code structure

The codebase is split by responsibility:

- `src/config/constants.js`
  - Central game constants, material catalog, objective definitions, storage keys, and API URL.
- `src/core/math.js`
  - Shared formatting and numeric helper utilities.
- `src/core/simulation.js`
  - Pure economy logic: skill math, company/worker flow, entrepreneurship plan handling, production graph simulation.
- `src/core/optimizer.js`
  - Pure optimization logic for skill allocation and entrepreneurship plan search.
- `src/integrations/warera-import.js`
  - WarEra API integration for username/user-ID search plus live import of player skills, owned companies, workers, and wages.
- `src/state/company-state.js`
  - Mutable company/session state container (companies, workers, and entrepreneurship slot state) with sanitization and defaults.
- `src/ui/editor.js`
  - Company editor, entrepreneurship plan editor, and material input rendering.
- `src/ui/events.js`
  - DOM event wiring and user-action handlers.
- `src/ui/results.js`
  - Results dashboard rendering and warning/summary presentation.
- `src/main.js`
  - Thin orchestration layer for snapshot persistence, compare scenarios, optimization actions, and module composition.
- `tests/simulation.test.mjs`
  - Baseline regression tests for core simulation/optimizer behavior.

`app.js` is kept as a lightweight compatibility shim and forwards to `src/main.js`.

## Simulator coverage

- Skill allocation across:
  - Energy
  - Entrepreneurship
  - Production
  - Companies Limit
  - Management
- 4 points per level constraint
- Energy and Entrepreneurship 10-hour cycle resets (`2.4 cycles/day`)
- Automated Engine (AE 1 to AE 7), configurable per company
- Per-company worker assignment limited by Management
- Dedicated Entrepreneurship Plan section:
  - Set action slots (`Action 1`, `Action 2`, ...) and choose target company per action
  - Shows cap/requested/effective summary with over-cap warnings
- Per-worker independent capacity inputs: `Energy / 10h`, `Production / Action`, and `Fidelity`
- Wage income from working (Energy usage)
- Employee payroll costs
- Material recipe graph (raw + processed)
- Per-company specialization (each company chooses one item)
- Per-company production bonus (%) and per-worker fidelity (%) controls
- Automatic internal ingredient flow (e.g., Iron -> Steel) before sale
- Price input for each material
- Item icons rendered from `images/items`
- Live player import from WarEra API:
  - Search by username or paste a user ID
  - Choose whether to import skills, companies, workers, and wages
  - Pulls player level plus Energy, Entrepreneurship, Production, Companies, and Management skill levels
  - Imports owned companies, AE levels, worker stats, worker fidelity, and inferred company wage from current workers
  - Imports company `Production Bonus (%)` from current country specialization bonus plus any active matching region deposit and ruling-party industrialism/agrarian modifiers
  - Imports your personal after-tax `Work Wage / PP` from the most recent wage transaction that matches a current job at another user's company
- Automatic price sync on page load plus manual sync button from `https://api2.warera.io/trpc/itemTrading.getPrices`
- Output metrics:
  - PP/day and PP/hour
  - Produced units/day and hour
  - Profit/day and hour
  - Bought ingredient units/day (per item) in Production table
- Scenario compare mode (A/B):
  - One `Switch Scenario` button toggles between Scenario A and Scenario B
  - Active scenario auto-saves on every input change
  - Inline delta appears beside each result metric (`+` in green, `-` in red) versus the other scenario
- Optimizer for selected objective with selectable scope:
  - Optimize Skill Allocation
  - Optimize Entrepreneurship Plan
  - Or both together

## Formula assumptions

These assumptions are implemented:

1. Skill input is by level (not direct points).
2. Progressive cost per skill level:
   - Level `N` costs `1 + 2 + ... + N` total points.
3. Per-level stat gains:
   - Entrepreneurship `+5` each level
   - Energy `+10` each level
   - Production `+3` each level
   - Companies limit `+1` each level
   - Management `+2` each level
4. Max level per skill is `10`.
5. Production gained per work/produce action equals `Production stat`.
6. Company/worker bonus multipliers:
   - Production bonus `%` => multiplier `1 + (bonus / 100)`.
   - Fidelity `%` => multiplier `1 + (fidelity / 100)`, capped at `10%`.
7. Work actions/day:
   - `(EnergyBar / 10) * 2.4 * workUsage%`
8. Entrepreneurship actions/day:
   - `(EntrepreneurshipBar / 10) * 2.4 * entrepreneurshipUsage%`
9. Each worker has independent settings for `Energy / 10h`, `Production / Action`, and `Fidelity`.
10. Employee actions/day each worker:
   - `(EmployeeEnergy10h / 10) * 2.4`
11. Raw employee PP/day each worker:
   - `employeeActionsPerDayEach * employeeProductionPerAction`
12. Work wage and employee payroll are calculated from raw PP (before company bonus/fidelity).
13. Work PP/day for working others uses raw PP directly (no extra work bonus/fidelity input).
14. Company PP/day:
   - `manual company PP + (sum of each company's AE PP) + employee PP`
15. Entrepreneurship cap per 10h:
   - `EntrepreneurshipBar / 10`
16. Entrepreneurship planning:
   - each action slot represents one self-work action in a 10h cycle
   - each slot chooses one active target company (or skip)
   - visible whole target slots follow `floor(EntrepreneurshipBar / 10)`
   - when the Entrepreneurship bar is not divisible by 10, fractional regen is distributed across the selected slots
17. Entrepreneurship plan optimization:
   - when enabled in optimizer, plan actions are optimized for selected objective
   - plan-only optimization uses exact discrete search
   - combined skill+plan optimization uses fast heuristic plan search per skill candidate
18. Per-company manual and employee PP apply that company's production bonus.
19. Per-company employee PP/day:
   - `sum(each active worker raw PP * company production bonus * that worker fidelity)`, with management cap applied from last-added workers.
20. Payroll/day:
   - summed per-company using each company's own `wage / PP`.
21. For processed goods, missing raw ingredients are auto-bought from market prices (using your item price inputs) so PP budget can still be fully used.
22. Processed factories consume internal stock first, then buy any deficit from market.
23. Remaining stock after internal consumption is counted as sellable output.

## Notes

- Skill optimization exhaustively scans `Energy`, `Entrepreneurship`, and `Production` while keeping `Companies` and `Management` fixed to your chosen levels.
- Entrepreneurship plan optimization uses exact discrete search in plan-only mode and a fast heuristic during combined skill+plan optimization.
- State persists in browser local storage.
