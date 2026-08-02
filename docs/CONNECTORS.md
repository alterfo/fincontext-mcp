# Connectors — adding a new financial source

FinContext MCP is **neutral** by design: the whole moat is breadth of sources — banks, accounting systems, and marketplaces — all normalized into one model so `reconcile`, `get_cash_position`, and `cashgap_forecast` work source-independently.

The sync/store/domain core is source-agnostic (`src/sync.js` just loops over connectors). Adding a source is **one file** plus registration — the core never changes.

## The contract

A connector is a factory returning an object with a `source` string and an async `pull(period)`:

```js
createXConnector({ token, http, baseUrl }) => {
  source: 'x',
  async pull(period) => ({ accounts, statements, transactions }),
}
```

- `period` is `{ from, to }` (ISO dates) plus optional `as_of`, `currency`.
- `pull` returns three arrays, each normalized via `makeTransaction` / `makeStatement` from `src/model.js`:
  - `transactions` — the normalized operations (**required**).
  - `accounts` — account/wallet registry (banks only; `[]` for ledger/marketplace).
  - `statements` — bank statements with `opening/closing_balance` for the completeness check (`[]` when not applicable).

### Normalization rules (non-negotiable)

- **Money is integer kopecks**, always non-negative; sign is carried by `direction` (`in`|`out`). Never a float, never a negative amount.
- `kind` is one of `bank | ledger | marketplace`.
- Set a stable `native_id` so `id`/`dedup_key` stay stable across re-syncs (idempotent sync depends on it).
- Populate a reference the matcher can group on when you can: `uin` > `doc_number` > `counterparty.inn`. `reconcile` links by these **before** amount, so a shared `doc_number` between bank and ledger is what makes cross-source matching work.

`src/connectors/_template.js` is a copy-me skeleton implementing exactly this shape (injectable `http`, `normalizeRow`, `pull`). Start there.

## Steps to add a connector

1. Copy `src/connectors/_template.js` to `src/connectors/<source>.js` and implement the real API calls + `normalizeRow`.
2. Add the source id to `SOURCES` in `src/model.js` (and use `kind: 'marketplace'` for marketplaces — already allowed).
3. Register it in `src/connectors/index.js`:
   - open-core source → add to `OPEN`.
   - premium source → add to `PREMIUM` with a `connectors:<source>` license module (gated offline by `src/license.js`).
4. Add the runtime token wiring: the function reads `LOCKBOX_<SOURCE>_TOKEN` from Lockbox (see `src/lockbox.js`), and Terraform creates the secret shell (`infra/`).
5. Write tests against a faked `http` (see `test/connectors-template.test.js`) — normalization + `pull` shape + token/error paths.

## Banks (`kind: bank`)

Direct analog of the Tochka connector: pull accounts + balances + statement lines, normalize to `Transaction(kind='bank')`. Candidates and notes:

- **Т-Банк (Бизнес)** — Business API, token from the cabinet, read-only statements. Strong SMB/ИП fit.
- **Альфа-Банк** — business API exists; heavier onboarding (agreements, sometimes mTLS/certificates).
- Sber is intentionally out of scope (it ships its own single-vendor MCP — the competitor we are neutral against).

Verify exact endpoints/scopes/access terms against each provider's current docs before implementing — bank API access terms vary.

## Marketplaces (`kind: marketplace`) — Ozon / Wildberries

Marketplaces are **not** banks: they represent a seller's settlements — sales, commissions, holds, and **payouts**. This is high value for the cash-gap product, because sellers face a large timing gap between a sale and the marketplace payout while paying suppliers now.

- **Ozon Seller API** — auth via `Client-Id` + `Api-Key` (self-serve). Finance/transaction endpoints give sales, commissions, and settlement/payout data.
- **Wildberries API** — token per scope (Статистика / Финансы). Sales report and financial (реализация) / payout data.

Mapping:

- Net payouts → inflows (`direction: 'in'`), commissions/fees/refunds → outflows (`direction: 'out'`); `kind: 'marketplace'`.
- **Expected/upcoming payouts** are the key signal: feed them into `cashgap_forecast` as `scheduled` inflows (with the expected payout date). This is exactly the timing gap that drives cash-gap for marketplace sellers.

Note: this is financial aggregation of marketplace settlements — distinct from the crowded "AI review-reply for sellers" niche. It reinforces the neutral, cross-source moat rather than competing with the platforms' own tools.

Both Ozon and WB are declared as future **premium** connectors (`connectors:ozon`, `connectors:wb`). API keys are self-serve, so they are cheaper to onboard than gated bank APIs — a good early premium track once M0 validation confirms demand.
