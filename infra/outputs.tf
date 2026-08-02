output "api_gateway_domain" {
  description = "Public domain of the API Gateway hosting the MCP endpoint."
  value       = yandex_api_gateway.mcp.domain
}

output "mcp_endpoint" {
  description = "Full MCP endpoint URL for the client's MCP configuration."
  value       = "https://${yandex_api_gateway.mcp.domain}/mcp"
}
