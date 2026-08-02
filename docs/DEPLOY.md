# FinContext MCP — deploy & security model

FinContext MCP is **self-hosted**: you (the client) deploy the server into your
own Yandex Cloud folder with the Terraform module in [`infra/`](../infra). The
developer never runs the server, never holds your credentials, and never sees a
bank or accounting token.

## What the module creates

| Resource | Purpose |
| --- | --- |
| `yandex_iam_service_account` | Least-privilege runtime identity for both functions |
| `yandex_ydb_database_serverless` | Persistence for accounts, transactions, statements, positions |
| `yandex_lockbox_secret` (×2) | Holds the read-only Tochka / MoySklad tokens |
| `yandex_function` `mcp` | The MCP streamable-HTTP JSON-RPC endpoint |
| `yandex_function` `sync` | Timer-triggered incremental pull |
| `yandex_function_trigger` `sync_timer` | Cron schedule for the sync function |
| `yandex_api_gateway` | Public HTTPS front for the MCP endpoint |

### Least-privilege service account

The service account is granted exactly:

- `ydb.editor` **on the FinContext database only** (not folder-wide) — read/write that one database.
- `functions.functionInvoker` **per function** (not folder-wide) — so the timer trigger and the API Gateway can invoke the two FinContext functions and nothing else.
- `lockbox.payloadViewer` **per secret** (not folder-wide) — read the two token secrets and nothing else.

No `admin`, no `editor` on the folder, no folder-wide grants of any kind, no
write access to Lockbox. The identity can read the tokens it needs and touch its
own database — nothing more.

## Security model — what is stored, what never leaves your cloud

- **Bank / accounting tokens** live only in **your** Lockbox, in **your** folder.
  They are read at runtime by the function's service account and are never
  logged, written, or forwarded. Scope is **read-only** on the bank/accounting
  side.
- **Financial data** (statements, transactions, positions, reconcile runs) is
  materialized into **your** YDB database. It never leaves your cloud.
- **The developer receives nothing.** The license (Pro-key) is verified
  **offline** with an embedded Ed25519 public key — there is no telemetry, no
  license server, no call-home. See [`src/license.js`](../src/license.js).
- The only inbound surface is the API Gateway `/mcp` endpoint you expose to your
  own MCP client.

## Deploy steps

1. Build the function packages (produces `infra/build/mcp.zip` and
   `infra/build/sync.zip`). The functions have no runtime dependencies, so the
   packages contain only `index.js` plus the `src/` tree — no `node_modules`:

   ```bash
   npm run build
   ```

2. Configure and apply:

   ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars
   # edit terraform.tfvars: cloud_id, folder_id, (optional) pro_key
   terraform init
   terraform fmt -check
   terraform validate
   terraform plan
   terraform apply
   ```

3. Populate the Lockbox secrets with your read-only tokens (the module creates
   the secret shells; you add the values so no token ever passes through
   Terraform state as plaintext you didn't set yourself):

   ```bash
   yc lockbox payload add-version \
     --id "$(terraform output -raw -json lockbox_secret_ids | jq -r .tochka)" \
     --payload '[{"key":"token","text_value":"<TOCHKA_READONLY_TOKEN>"}]'
   ```

   Repeat for `moysklad`.

## Connect an MCP client

The `mcp_endpoint` output is the URL your MCP client points at:

```bash
terraform output -raw mcp_endpoint
# => https://<gateway>.apigw.yandexcloud.net/mcp
```

Example MCP client configuration (streamable-HTTP transport):

```json
{
  "mcpServers": {
    "fincontext": {
      "type": "http",
      "url": "https://<gateway>.apigw.yandexcloud.net/mcp",
      "headers": {
        "X-FinContext-Pro-Key": "<optional-pro-key>"
      }
    }
  }
}
```

Without a Pro-key the server exposes the open tools (`get_cash_position`,
`check_payment`). With a valid Pro-key the premium tools (`reconcile`,
`cashgap_forecast`) appear in `tools/list` and become callable — verified
entirely offline.

For a no-deploy local smoke test, drive the same server over stdio with MCP
Inspector: `npm run inspect`.
