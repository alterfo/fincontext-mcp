# FinContext MCP — Engineering Build (M1–M5)

## Overview

FinContext MCP is a neutral, self-hosted, open-core MCP server that gives an AI agent a consolidated financial picture of a Russian SMB across all of its banks and its accounting system. It exposes four tools — `get_cash_position` (real cash across all accounts), `check_payment` (did a payment clear or is it pending), `cashgap_forecast` (cash-gap projection), and `reconcile` (statement-vs-ledger reconciliation). Trust is architectural: the client deploys the server into their own Yandex Cloud, and bank/accounting tokens (read-only scope) live in the client's Lockbox and never reach the developer.

This plan covers the engineering milestones **M1–M5**: the MCP skeleton, the synthetic-data domain core (the main moat), the Tochka and MoySklad connectors, YDB persistence with idempotent sync, the forecast engine, offline Pro-key license gating, and the deliverable Terraform module. Non-code milestones — M0 (idea validation via community posts and builder interviews) and M6 (paid pilot, sole-proprietor/YooKassa setup, dogfooding) — are tracked in Post-Completion as informational context, not executable tasks.

The stack is Yandex Cloud Functions + API Gateway + YDB + Lockbox, in JavaScript. The MCP transport is streamable-HTTP (JSON-RPC).

## Context

- **Open-core split.** Open core: MCP protocol, `functions/mcp`, Tochka/MoySklad connectors, `src/license.js`, infra glue — under Apache-2.0. Premium (Pro-key gated): `src/reconcile.js`, forecast, alerts, `kontur`/`1c` connectors — proprietary/BSL, not in the open tree.
- **Impacted components:** `functions/mcp/index.js` (HTTP function behind API Gateway), `functions/sync/index.js` (timer trigger), `src/mcp.js` (tool registration + JSON-RPC routing), `src/reconcile.js` (domain core), `src/connectors/{tochka,moysklad,kontur,1c}.js`, `src/ydb.js`, `src/lockbox.js`, `src/license.js`, `infra/` (Terraform, `yandex` provider).
- **Constraints:** solo developer, part-time; RF resident without Stripe/PayPal → payments via YooKassa; there is no local Yandex Cloud emulator, so domain logic must be pure functions separated from FaaS handlers and tested with Jest; bank access is read-only scope only.
- **Zero-access development is intended:** the domain core (M2) is built and tested entirely on synthetic data; Tochka has a ready sandbox (`https://enter.tochka.com/sandbox/v2`, `Authorization: Bearer sandbox.jwt.token`); MoySklad uses a free test account; MCP Inspector (`npx @modelcontextprotocol/inspector`) drives the server locally with no deploy.
- **Adopted from:** `docs/PLAN.md` (strategic plan), engineering milestones M1–M5.

## Development Approach

- Testing approach: regular, with a strong unit-first emphasis on the domain core — synthetic fixtures carry known, pre-computed discrepancies and expected outputs.
- Keep domain logic (`src/reconcile.js`, forecast) as pure functions decoupled from FaaS handlers, since there is no Yandex Cloud emulator.
- Complete each task fully before moving to the next.
- Update this plan when scope changes during implementation.

## Testing Strategy

- Unit tests (Jest) required for every code-changing Task; the domain core is validated against synthetic statements/ledgers with known discrepancies.
- Connectors are tested against the Tochka sandbox and a free MoySklad test account, with normalization asserted against the unified model.
- E2E: drive the server with MCP Inspector (CLI mode in CI) — `tools/list`, `get_cash_position`, `reconcile` — without deploying.
- Run project tests after each Task before proceeding.

## Technical Details

### Normalized `Transaction` (shared by bank and ledger)

`id` (= hash(source, account_id, native_id)), `source` (`tochka|moysklad|kontur|1c`), `kind` (`bank|ledger`), `account_id`, `direction` (`in|out`), `amount` (int64, **kopecks**, always positive — sign carried by `direction`, never float), `currency` (ISO-4217, `RUB` at start), `booked_at`, `value_date?`, `status` (`posted|pending|hold`), `counterparty?` (`{name, inn, kpp?, account?, bic?}`), `purpose?`, `doc_number?`, `uin?`, `vat_amount?` (kopecks), `category?`, `dedup_key`, `raw` (source object, for audit).

- `Statement`: `{account_id, source, period_from, period_to, opening_balance, closing_balance, fetched_at, line_ids[]}`; completeness invariant `opening + Σin − Σout == closing`.
- `CashPosition`: `{as_of, by_account:[{account_id, source, balance, currency, updated_at}], totals:{currency: balance}}`.
- YDB tables: `accounts`, `transactions` (PK `id`, secondary index `account_id + booked_at`), `statements`, `reconcile_runs`, `sync_state` (per-source cursors), `positions`.
- Dedup/idempotency: `dedup_key = hash(source, account_id, native_id)`, or `hash(source, account_id, booked_at, amount, direction, doc_number|purpose)` when no stable native id; `PUT` by `id`; advance `sync_state` cursor only after a batch is persisted.

### MCP tool contracts

- `get_cash_position` (open) — in: `{as_of?, accounts?, currency?="RUB"}`; out: `{as_of, total:{amount,currency}, by_account:[{account_id, bank, amount, currency, updated_at, staleness_sec}], warnings:[]}`.
- `check_payment` (open) — in: `{amount?, counterparty_inn?, purpose_contains?, doc_number?, uin?, date_from?, date_to?}`; out: `{status:"found"|"pending"|"not_found", matches:[{transaction, account_id, confidence}], explanation}`.
- `cashgap_forecast` (premium) — in: `{horizon_days=30, scenario?="base"|"conservative", include_recurring?=true}`; out: `{horizon_days, current_position, daily:[{date, projected_balance, inflows, outflows}], gap:{will_occur, first_gap_date?, min_balance, deficit_amount?}, assumptions:[]}`.
- `reconcile` (premium) — in: `{period:{from,to}, bank_source, ledger_source, tolerance?:{amount_minor=0, days=0}}`; out: `{summary:{matched, matched_amount, unmatched_bank, unmatched_ledger, partial}, matched:[{bank_txn_id, ledger_entry_id, amount, match_type:"exact"|"tolerance"}], exceptions:[{type, bank_txn?, ledger_entry?, delta?, suggestion}]}`. Exception `type`: `missing_in_ledger`, `missing_in_bank`, `amount_mismatch`, `partial_payment`, `duplicate`, `purpose_ambiguous`.
- Premium tools are hidden in `tools/list` without a valid Pro-key; a premium call without the module returns a JSON-RPC error `{code, message, data:{upgrade_url}}`.

### License (offline, no telemetry)

Ed25519. Private key held only by the developer (offline generator). Public key embedded in `src/license.js` (open, so it is auditable). Key format: `base64url(payload) + "." + base64url(signature)`. Payload: `{sub, plan:"pro", modules:["reconcile","forecast","alerts","connectors:kontur","connectors:1c"], iat, exp?, seats?}`. Verification decodes payload, verifies the signature, checks `exp`, and returns the unlocked module set — with no network calls. `tools/list` filters premium tools by `modules`; premium connectors load only when the matching `connectors:*` module is present.

## Implementation Steps

### Task 1: Repo scaffold and MCP skeleton (M1)

- [x] Initialize the JS project (package manifest, Jest, lint config) and the `src/` + `functions/` + `infra/` layout from Context
- [x] Implement `functions/mcp/index.js` as the streamable-HTTP JSON-RPC handler and `src/mcp.js` for tool registration and routing
- [x] Answer `initialize` and `tools/list` (return the four tool definitions with JSON Schema `inputSchema`; premium tools present but flagged)
- [x] Add a minimal `infra/` Terraform skeleton (`yandex` provider, function + API Gateway with OpenAPI) — parse/plan-level only, no live deploy required
- [x] Verify locally with MCP Inspector that `initialize` and `tools/list` respond correctly (verified via the stdio transport in `scripts/stdio-server.js`, which is what MCP Inspector drives)
- [x] write tests for JSON-RPC routing and `tools/list` output
- [x] run project tests - must pass before next task

### Task 2: Normalized data model and synthetic generator (M2 foundation)

- [x] Implement the normalized `Transaction`, `Statement`, and `CashPosition` types/builders from Technical Details (kopecks int64, sign via `direction`, no floats)
- [x] Build a synthetic generator that emits paired bank statements and ledger entries with pre-computed, known discrepancies (missing entries, amount mismatches, partial payments, duplicates, ambiguous purposes)
- [x] Emit expected-output fixtures alongside each synthetic case for assertion
- [x] write tests validating generator invariants (statement completeness `opening + Σin − Σout == closing`, dedup_key stability)
- [x] run project tests - must pass before next task

### Task 3: Reconcile domain core on synthetics (M2)

- [x] Implement `src/reconcile.js` cash-position aggregation across accounts as a pure function
- [x] Implement `reconcile` as a pure function producing `summary`, `matched`, and `exceptions` with all six exception `type`s, honoring `tolerance`
- [x] Implement `check_payment` matching logic (`found`/`pending`/`not_found` with confidence and explanation) over the normalized model
- [x] write tests driving `reconcile`/cash-position/`check_payment` against the synthetic fixtures and asserting the known expected outputs
- [x] run project tests - must pass before next task

### Task 4: Cash-gap forecast engine (M2/M5 domain)

- [x] Implement `cashgap_forecast` as a pure function: daily projected balances over `horizon_days`, `base`/`conservative` scenarios, optional recurring inflows/outflows
- [x] Populate `gap` (will_occur, first_gap_date, min_balance, deficit_amount) and an explicit `assumptions` list
- [x] write tests for forecast math and gap detection on synthetic cash-flow series
- [x] run project tests - must pass before next task

### Task 5: YDB persistence and idempotent sync store

- [x] Implement `src/ydb.js` with the `accounts`, `transactions`, `statements`, `reconcile_runs`, `sync_state`, and `positions` tables and access helpers
- [x] Implement dedup/idempotency (`dedup_key`, `PUT` by `id`) and materialization of `positions` (cash position + forecast inputs)
- [x] Implement `src/lockbox.js` to read bank/accounting tokens from the client's Lockbox
- [x] write tests for dedup (re-run must not double-count) and position materialization
- [x] run project tests - must pass before next task

### Task 6: Tochka connector and open tools live (M3)

- [x] Implement `src/connectors/tochka.js` against the sandbox (`/sandbox/v2`, sandbox bearer token) with normalization into the unified `Transaction` model
- [x] Wire `get_cash_position` and `check_payment` to real connector data cached in YDB, including `staleness_sec`/`warnings` honesty fields
- [x] Verify end-to-end via MCP Inspector (verified via the stdio transport `scripts/stdio-server.js`, which seeds the store from the Tochka sandbox when a token is present and serves the wired open tools; live sandbox network call skipped - not automatable in CI)
- [x] write tests for Tochka normalization and the wired open tools
- [x] run project tests - must pass before next task

### Task 7: MoySklad connector and reconcile tool live (M4)

- [x] Implement `src/connectors/moysklad.js` against a free test account with normalization into the unified model
- [x] Wire the `reconcile` tool to run over a real bank(Tochka)↔ledger(MoySklad) source pair
- [x] write tests for MoySklad normalization and the wired `reconcile` tool
- [x] run project tests - must pass before next task

### Task 8: Timer sync and alerts (M5)

- [x] Implement `functions/sync/index.js` as a timer-triggered incremental pull that refreshes statements/payments into YDB and recomputes cash position/forecast, advancing `sync_state` cursors only after successful persistence
- [x] Implement alerts (premium) driven off recomputed positions/forecast
- [x] write tests for incremental sync (cursor advance, no duplication) and alert triggering
- [x] run project tests - must pass before next task

### Task 9: Offline Pro-key license gating (M5)

- [ ] Implement `src/license.js`: Ed25519 offline verification of `base64url(payload).base64url(signature)`, `exp` check, embedded public key, no network calls; return the unlocked module set
- [ ] Gate `tools/list` and premium tool calls by `modules`; load `kontur`/`1c` connectors only when the matching `connectors:*` module is present; return the JSON-RPC upgrade error otherwise
- [ ] Provide an offline key-generator utility (private key stays with the developer) for issuing signed keys
- [ ] write tests for valid/invalid/expired keys and premium gating (hidden in `tools/list`, error on call)
- [ ] run project tests - must pass before next task

### Task 10: Deliverable Terraform module (client deploy)

- [ ] Flesh out `infra/` into the full deployable module: Functions, API Gateway (OpenAPI), timer trigger, YDB, Lockbox, and a service account with minimal rights
- [ ] Document the security model (what is stored, what never leaves the client) and MCP-client connection instructions in `README`/`docs/`
- [ ] write validation for the Terraform module (`validate`/`plan` against a clean catalog config)
- [ ] run project tests - must pass before next task

### Task 11: Verify acceptance criteria

- [ ] Verify all requirements from Overview are implemented: four MCP tools working, open/premium split enforced, self-hosted token model intact
- [ ] Confirm via MCP Inspector that `get_cash_position` and `reconcile` return correct results on demo data matching a manual calculation
- [ ] Confirm license gating: premium tools unavailable without a Pro-key, unlocked with a valid key, fully offline
- [ ] run full project test suite
- [ ] run project linter - all issues must be fixed

## Post-Completion

*Items requiring manual intervention - no checkboxes, informational only*

- **M0 (validation, do before serious code investment):** publish the open-core financial-MCP idea (Habr, vc.ru, MCP/FinTech Telegram chats, awesome-mcp, r/mcp) and run 5–10 interviews with builders of financial agents (Mom Test script in `docs/PLAN.md`); go/pivot gate is ≥3 of ~10 with active pain + budget/decision-maker + willingness to self-host, plus a prioritized premium-connector list.
- **M6 (paid pilot & business):** register self-employment/sole-proprietor for YooKassa; sell the Pro-key via YooKassa (software-license sale, not a data-custody service); run a 3–5 builder/business pilot; dogfood as the first client (own sole-proprietor + Tochka + MoySklad); collect case studies for distribution.
- **Licensing/legal:** finalize Apache-2.0 for the core, proprietary/BSL for premium modules; DCO (no CLA) for core contributions; trademark the name/logo.
- **Real-data e2e:** deploy the Terraform module into a clean Yandex Cloud catalog and confirm the MCP server boots and reads tokens from that catalog's Lockbox; verify logs via `yc logging read`.
