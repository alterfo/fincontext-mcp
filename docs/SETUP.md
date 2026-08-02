# FinContext MCP — setup, tokens & deploy

One place for every environment variable, token, and deploy step. Two paths:

- **Demo / local quickstart** — no cloud, no deploy. Drive the server over stdio
  with MCP Inspector, either against the frozen fixture or two test tokens.
- **Production** — self-hosted into your own Yandex Cloud folder with the
  Terraform module in [`infra/`](../infra), tokens held in your own Lockbox.

Security model, least-privilege roles, and the resource inventory live in
[`docs/DEPLOY.md`](DEPLOY.md). Adding a new financial source is
[`docs/CONNECTORS.md`](CONNECTORS.md).

## Environment variables & tokens

Every name below is used by the code. Column *Where* points at the file that
reads it.

### Source tokens

| Variable | Purpose | Where |
| --- | --- | --- |
| `LOCKBOX_TOCHKA_TOKEN` | Tochka API token. Sandbox accepts the fixed value `sandbox.jwt.token`; production is a **read-only** business token. | `src/lockbox.js` (env fallback `LOCKBOX_<SOURCE>_TOKEN`) |
| `LOCKBOX_MOYSKLAD_TOKEN` | MoySklad API token (read-only). | `src/lockbox.js`; also `scripts/seed-moysklad-demo.js`, `scripts/build-demo-fixture.js` |

`src/lockbox.js` derives the variable name from the source id:
`LOCKBOX_<SOURCE>_TOKEN` (upper-cased, non-alphanumerics → `_`). Adding a
connector `x` means it reads `LOCKBOX_X_TOKEN` with no core change.

The env variable is the **fallback** path used for local runs. In production
these tokens live in Lockbox and are addressed by secret id + entry key instead
(see below); the env variable is never set on the deployed function.

### Base-URL overrides

| Variable | Default | Where |
| --- | --- | --- |
| `TOCHKA_BASE_URL` | `https://enter.tochka.com/sandbox/v2` (sandbox) | `functions/sync/index.js`, `scripts/stdio-server.js`; connector default in `src/connectors/tochka.js` |
| `MOYSKLAD_BASE_URL` | `https://api.moysklad.ru/api/remap/1.2` | `functions/sync/index.js`, `scripts/stdio-server.js`; connector default in `src/connectors/moysklad.js` |

Leave `TOCHKA_BASE_URL` unset (or point it at the sandbox) for testing; set the
production Tochka URL for a live deploy. `MOYSKLAD_BASE_URL` empty uses the
connector default.

### License & reporting

| Variable | Purpose | Where |
| --- | --- | --- |
| `FINCONTEXT_PRO_KEY` | Offline Pro-key `base64url(payload).base64url(sig)`. Unlocks premium tools (`reconcile`, `cashgap_forecast`). Empty ⇒ open-core only. Verified offline against an embedded Ed25519 key — no telemetry, no license server. | `functions/mcp/index.js`, `functions/sync/index.js`, `scripts/stdio-server.js`; verified in `src/license.js` |
| `REPORT_CURRENCY` | Reporting currency for cash position and forecast. Defaults to `RUB`. | `functions/sync/index.js` |

For the MCP endpoint the Pro-key may also arrive per-request as the
`X-FinContext-Pro-Key` header, which takes precedence over the env var
(`proKeyFromEvent` in `functions/mcp/index.js`).

### Production Lockbox wiring (set by Terraform, not by you)

On the deployed functions the tokens are read from Lockbox by secret id, not
from `LOCKBOX_*_TOKEN`. The Terraform module injects:

| Variable | Purpose | Source |
| --- | --- | --- |
| `LOCKBOX_TOCHKA_ID` | Lockbox secret id holding the Tochka token. | `yandex_lockbox_secret.tochka.id` |
| `LOCKBOX_MOYSKLAD_ID` | Lockbox secret id holding the MoySklad token. | `yandex_lockbox_secret.moysklad.id` |
| `LOCKBOX_TOKEN_KEY` | Entry name inside each secret payload that holds the token. Defaults to `token`. | `var.lockbox_token_key` |
| `YDB_DATABASE_PATH`, `YDB_ENDPOINT` | Persistence coordinates. | `yandex_ydb_database_serverless.fincontext` |

`src/lockbox.js` resolves a source in this order: if a `{ secret_id, key }` entry
is configured for it (with a Lockbox resolver), it reads `entries[key]` from that
secret; otherwise it falls back to `LOCKBOX_<SOURCE>_TOKEN`. So the same code
serves both the local env path and the production Lockbox path.

## Demo / local quickstart

No cloud account, no deploy.

### Frozen fixture (zero tokens)

The public demo runs entirely on `src/demo-data.json` (8 bank + 12 ledger txns,
4 scheduled flows, starting position 450 000₽). It needs no tokens: it is served
by the mcp function on `GET /` (landing + interactive demo) and by
`createDemoStore()`. To exercise it locally with no cloud, run the test suite —
`test/` drives every tool against the fixture and asserts cash 450 000₽,
reconcile 6 matched + 3 exception types, and a forecast gap on 2026-08-12.

### Two test tokens (live sandbox pull)

To drive the real connectors over stdio with MCP Inspector, export only the two
source tokens and run:

```bash
export LOCKBOX_TOCHKA_TOKEN="sandbox.jwt.token"
export LOCKBOX_MOYSKLAD_TOKEN="<your-moysklad-test-token>"
npm run inspect
```

- `LOCKBOX_TOCHKA_TOKEN=sandbox.jwt.token` hits the Tochka sandbox
  (`TOCHKA_BASE_URL` default) — all-access test data, production untouched.
- `LOCKBOX_MOYSKLAD_TOKEN` is a token from a free MoySklad test account. That
  account expires ~2 weeks after signup; the frozen fixture does not, so the
  public demo survives expiry. Regenerate the fixture while the token is valid
  with `node scripts/build-demo-fixture.js` if the scenario changes.
- Add `FINCONTEXT_PRO_KEY` to the environment to surface the premium tools over
  stdio; without it only `get_cash_position` and `check_payment` are exposed.

`npm run inspect` runs `scripts/stdio-server.js` under
`@modelcontextprotocol/inspector` — it seeds from whichever sandbox tokens are
present and then serves JSON-RPC over stdio.

## Production deploy

Self-hosted into your own Yandex Cloud folder. Full security model and the
least-privilege role breakdown are in [`docs/DEPLOY.md`](DEPLOY.md); the short
path:

1. Build the function packages (no runtime deps; `src/` incl. `demo-data.json`
   is bundled into `infra/build/mcp.zip` and `infra/build/sync.zip`):

   ```bash
   npm run build
   ```

2. Configure and apply the module:

   ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars
   terraform init
   terraform fmt -check
   terraform validate
   terraform plan
   terraform apply
   ```

   Key `terraform.tfvars` inputs (see `infra/variables.tf`):

   | Variable | Purpose |
   | --- | --- |
   | `cloud_id`, `folder_id` | Where FinContext is deployed. |
   | `pro_key` | Optional Pro-key → `FINCONTEXT_PRO_KEY` on both functions. Empty leaves the deploy open-core. |
   | `tochka_base_url` | Tochka API base. Default is the sandbox; set the production URL for a live pull. |
   | `moysklad_base_url` | MoySklad API base. Empty uses the connector default. |
   | `report_currency` | Reporting currency (default `RUB`). |
   | `lockbox_token_key` | Entry name inside each Lockbox secret (default `token`). |
   | `sync_cron` | Cron for the incremental sync timer (default hourly). |

3. Populate the Lockbox secrets with your **read-only** tokens (Terraform creates
   only the secret shells, so no token passes through state):

   ```bash
   yc lockbox payload add-version \
     --id "$(terraform output -json lockbox_secret_ids | jq -r .tochka)" \
     --payload '[{"key":"token","text_value":"<TOCHKA_READONLY_TOKEN>"}]'

   yc lockbox payload add-version \
     --id "$(terraform output -json lockbox_secret_ids | jq -r .moysklad)" \
     --payload '[{"key":"token","text_value":"<MOYSKLAD_READONLY_TOKEN>"}]'
   ```

   The `key` here must match `lockbox_token_key` (default `token`).

4. Point your MCP client at the endpoint:

   ```bash
   terraform output -raw mcp_endpoint
   # => https://<gateway>.apigw.yandexcloud.net/mcp
   ```

### Service-account roles

The module grants its runtime identity exactly (see `infra/main.tf`):

- `ydb.editor` — on the FinContext database only, not folder-wide.
- `functions.functionInvoker` — per function (mcp and sync), so the timer
  trigger and the API Gateway invoke only these two functions.
- `lockbox.payloadViewer` — per secret (tochka and moysklad), read-only.

No folder-wide grants, no admin, no write access to Lockbox. Details and the full
resource inventory: [`docs/DEPLOY.md`](DEPLOY.md).

## See also

- [`docs/DEPLOY.md`](DEPLOY.md) — security model, resources, MCP client config.
- [`docs/CONNECTORS.md`](CONNECTORS.md) — adding a bank / accounting / marketplace source.
