output "api_gateway_domain" {
  description = "Public domain of the API Gateway hosting the MCP endpoint."
  value       = yandex_api_gateway.mcp.domain
}

output "mcp_endpoint" {
  description = "Full MCP endpoint URL for the client's MCP configuration."
  value       = "https://${yandex_api_gateway.mcp.domain}/mcp"
}

output "service_account_id" {
  description = "Least-privilege service account the functions run as."
  value       = yandex_iam_service_account.fincontext.id
}

output "ydb_database_path" {
  description = "Serverless YDB database path used for FinContext persistence."
  value       = yandex_ydb_database_serverless.fincontext.database_path
}

output "ydb_endpoint" {
  description = "Full YDB endpoint (host + database) for the persistence layer."
  value       = yandex_ydb_database_serverless.fincontext.ydb_full_endpoint
}

output "lockbox_secret_ids" {
  description = "Lockbox secret ids the client populates with read-only bank/accounting tokens."
  value = {
    tochka   = yandex_lockbox_secret.tochka.id
    moysklad = yandex_lockbox_secret.moysklad.id
  }
}

output "sync_function_id" {
  description = "Id of the timer-triggered incremental sync function."
  value       = yandex_function.sync.id
}
