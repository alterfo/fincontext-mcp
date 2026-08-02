# FinContext MCP — Landing, Interactive Demo, SETUP, CI

## Overview

Add a public face and release plumbing to the existing FinContext MCP server (M1–M5 already built and merged). Three deliverables:

1. A **landing page served by the same MCP function** (`functions/mcp`) on `GET /`, describing FinContext MCP (neutral, self-hosted, open-core) with an **interactive in-browser demo**. The demo calls the four tools (`get_cash_position`, `check_payment`, `reconcile`, `cashgap_forecast`) against the **frozen demo fixture** (`src/demo.js` → `createDemoStore`, no real tokens) and renders results inline. The scenario is a clothing store whose cash goes negative on the salary date before a wholesale receipt.
2. **`docs/SETUP.md`** — one consolidated token & deploy guide covering every env/token, a demo quickstart, and the production Terraform path.
3. **CI** — a workflow that runs tests, lint, and the function packaging build on every push/PR.

## Context

- The MCP HTTP handler is `functions/mcp/index.js` (streamable-HTTP JSON-RPC: POST returns JSON-RPC, currently 405 on GET, 202 for notifications). The landing and demo must be served by **this same function**, routed through the API Gateway (`infra/openapi.yaml.tftpl`, wired in `infra/main.tf`).
- The frozen demo data + loader already exist: `src/demo.js` exports `createDemoStore()`, `demoMeta()`, `DEMO_DATA`; data is `src/demo-data.json` (8 bank + 12 ledger txns, 4 scheduled flows, starting position 450 000₽). `src/handlers.js` exports `createOpenHandlers(store)` and `createPremiumHandlers(store)` returning the four tool handlers.
- Demo results on the fixture (already verified): cash position 450 000₽; reconcile 6 matched + 3 exceptions (partial_payment, missing_in_bank, missing_in_ledger); cashgap_forecast gap on 2026-08-12, deficit 250 000₽.
- Packaging is `npm run build` (`scripts/package-functions.js`) → `infra/build/{mcp,sync}.zip`; functions have **no runtime deps**; `src/` (including `demo-data.json`) is bundled into the zip.
- Project rules: CommonJS, Node ≥18, Jest + ESLint (`eslint:recommended`), tests in `test/**/*.test.js`. **No comments in any code** — none, in any file.
- The page must be **self-contained**: inline CSS/JS, no external assets/CDN/fonts (works behind a strict CSP and offline).
- Adopted from: user request (landing + interactive demo + token guide + CI), building on `docs/plans/completed/20260802-fincontext-mcp-engineering-build.md`.

## Development Approach

- Testing approach: regular.
- Keep the demo store construction server-side (`src/demo.js`); the browser only calls demo endpoints and renders JSON.
- Do not write comments in any code file.
- Complete each task fully before moving to the next.

## Testing Strategy

- Unit/integration tests (Jest) for every code-changing task: assert `GET /` returns HTML, and the demo endpoint returns correct tool results over the fixture.
- Run `npm test`, `npm run lint`, and `npm run build` after each task; all must pass.

## Technical Details

- **Routing (same function):** extend `functions/mcp/index.js` so `GET /` returns the landing HTML (200, `text/html`), and a demo route (e.g. `POST /demo` with `{ tool, args }`, or `GET /demo/<tool>`) builds/uses a cached `createDemoStore()` and invokes the matching handler from `createOpenHandlers`/`createPremiumHandlers`. The existing `POST /` JSON-RPC behavior and 405/OPTIONS/202 handling must be preserved. The demo route serves premium tools (`reconcile`, `cashgap_forecast`) without a Pro-key because it runs only on demo data.
- **API Gateway:** add routes in `infra/openapi.yaml.tftpl` so `/`, `/demo` (and any demo sub-paths) reach the mcp function alongside the existing `/mcp` route.
- **Landing content:** short pitch + the security model one-liner (tokens stay in the client's cloud) + buttons that call each tool on the fixture and render the returned JSON/table (cash position total, reconcile summary + exception list, forecast gap + daily balances showing the dip). Use `demoMeta()` for the suggested reconcile period and forecast scheduled flows. For `check_payment`, use a strong query (by `doc_number` or exact amount) so the demo shows a confident `found`.
- **SETUP.md:** every env/token — `LOCKBOX_TOCHKA_TOKEN` (sandbox `sandbox.jwt.token` / prod read-only), `LOCKBOX_MOYSKLAD_TOKEN`, `TOCHKA_BASE_URL`/`MOYSKLAD_BASE_URL` overrides, prod Lockbox `{secret_id, key}` wiring, `FINCONTEXT_PRO_KEY`, YC service-account roles; a demo quickstart (only the two tokens, `npm run inspect`); the prod path (`npm run build` → `terraform apply` → `yc lockbox payload add-version`). Cross-check every name against the code. Link `docs/DEPLOY.md` and `docs/CONNECTORS.md`.
- **CI:** `.github/workflows/ci.yml` on push + pull_request: Node 18, `npm ci`, `npm test`, `npm run lint`, `npm run build`. Optionally a Terraform `fmt -check`/`validate` job using `hashicorp/setup-terraform` against `infra/`.

## Implementation Steps

### Task 1: Landing page and interactive demo on the mcp function

- [ ] Extend `functions/mcp/index.js` to serve the landing HTML on `GET /` while preserving the existing `POST` JSON-RPC, OPTIONS/CORS, 405, and 202 behavior
- [ ] Add a demo endpoint on the same function that runs the four tools against a cached `createDemoStore()` (premium tools allowed on demo data only) and returns their JSON results
- [ ] Build the self-contained landing HTML (inline CSS/JS, no external assets) with buttons that call each tool and render results inline (cash position, reconcile summary + exceptions, forecast gap + daily dip); use a strong `check_payment` query so it returns a confident match
- [ ] Add API Gateway routes for `/` and the demo path in `infra/openapi.yaml.tftpl`
- [ ] write tests: `GET /` returns HTML; the demo endpoint returns the expected results over the fixture (cash 450 000₽, reconcile 6 matched + 3 exception types, forecast gap on 2026-08-12)
- [ ] run project tests, lint, and `npm run build` - all must pass before next task

### Task 2: Consolidated SETUP.md token & deploy guide

- [ ] Write `docs/SETUP.md` covering every env/token (Lockbox envs, sandbox vs prod, base-url overrides, prod Lockbox secret wiring, `FINCONTEXT_PRO_KEY`, YC service-account roles), cross-checked against the actual code
- [ ] Include a demo quickstart (only Tochka sandbox + MoySklad test token, `npm run inspect`) and the production path (`npm run build` → `terraform apply` → Lockbox payload add), linking `docs/DEPLOY.md` and `docs/CONNECTORS.md`
- [ ] run project tests, lint, and `npm run build` - all must pass before next task

### Task 3: CI workflow (test + lint + package)

- [ ] Add `.github/workflows/ci.yml` running on push and pull_request: Node 18, `npm ci`, `npm test`, `npm run lint`, `npm run build`
- [ ] Optionally add a Terraform `fmt -check` + `validate` job for `infra/` via `hashicorp/setup-terraform`
- [ ] write a test or check asserting the workflow file exists and references the required steps (test, lint, build)
- [ ] run project tests, lint, and `npm run build` - all must pass before next task

### Task 4: Verify acceptance criteria

- [ ] Verify all requirements from Overview: landing on `GET /` of the mcp function, interactive demo on the fixture across all four tools, `docs/SETUP.md`, and CI workflow
- [ ] Confirm the demo endpoint returns cash 450 000₽, reconcile 6 matched + 3 exceptions, and the forecast gap on 2026-08-12 over the frozen fixture
- [ ] run full project test suite
- [ ] run project linter - all issues must be fixed
- [ ] run `npm run build` - packaging must succeed

## Post-Completion

*Items requiring manual intervention - no checkboxes, informational only*

- Deploying the demo instance requires a Yandex Cloud account with `terraform`/`yc` installed (and, in RU, the Yandex Terraform mirror configured) — see `docs/DEPLOY.md`.
- The MoySklad test account expires ~2 weeks after signup; the public demo runs on the frozen `src/demo-data.json`, so it survives expiry. Regenerate with `node scripts/build-demo-fixture.js` while the token is valid if the scenario changes.
