# infra — FinContext MCP Terraform module

Deployable Yandex Cloud module the client applies into their own folder. It
provisions the least-privilege service account, serverless YDB, Lockbox token
secrets, the MCP function behind an API Gateway, and the timer-triggered sync
function.

- Full deploy walkthrough and security model: [`../docs/DEPLOY.md`](../docs/DEPLOY.md).
- Variables: see [`variables.tf`](variables.tf); copy
  [`terraform.tfvars.example`](terraform.tfvars.example) to `terraform.tfvars`.

## Layout

| File | Contents |
| --- | --- |
| `versions.tf` | Terraform + `yandex` provider requirements and provider config |
| `variables.tf` | Input variables (cloud/folder ids, function tuning, tokens, cron) |
| `main.tf` | Service account, IAM, YDB, Lockbox, functions, trigger, API Gateway |
| `outputs.tf` | MCP endpoint, service account id, YDB path, Lockbox secret ids |
| `openapi.yaml.tftpl` | API Gateway OpenAPI spec templated with the function id |

## Quick check

```bash
cd infra
terraform init
terraform fmt -check
terraform validate
terraform plan -var 'cloud_id=...' -var 'folder_id=...'
```

Package the functions into `build/mcp.zip` and `build/sync.zip` before `apply`
(see the deploy doc). The zips are git-ignored build artifacts.
