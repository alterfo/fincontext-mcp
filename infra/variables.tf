variable "cloud_id" {
  type        = string
  description = "Yandex Cloud id the client deploys into."
}

variable "folder_id" {
  type        = string
  description = "Folder id for all FinContext resources."
}

variable "zone" {
  type        = string
  description = "Default availability zone."
  default     = "ru-central1-a"
}

variable "function_name" {
  type        = string
  description = "Base name for the MCP and sync cloud functions and their peers."
  default     = "fincontext-mcp"
}

variable "runtime" {
  type        = string
  description = "Cloud Functions runtime for the Node.js handler."
  default     = "nodejs18"
}

variable "function_memory" {
  type        = number
  description = "Memory (MB) allocated to each cloud function."
  default     = 256
}

variable "function_timeout" {
  type        = number
  description = "Execution timeout (seconds) for each cloud function."
  default     = 30
}

variable "mcp_zip_path" {
  type        = string
  description = "Path to the packaged MCP function zip (built by the release step)."
  default     = "build/mcp.zip"
}

variable "sync_zip_path" {
  type        = string
  description = "Path to the packaged sync function zip (built by the release step)."
  default     = "build/sync.zip"
}

variable "sync_cron" {
  type        = string
  description = "Cron expression (Yandex format) for the incremental sync timer trigger."
  default     = "0 */1 * * ? *"
}

variable "report_currency" {
  type        = string
  description = "Reporting currency for cash position and forecast."
  default     = "RUB"
}

variable "pro_key" {
  type        = string
  description = "Optional offline Pro-key (base64url(payload).base64url(sig)) that unlocks premium tools. Empty leaves the deployment open-core only."
  default     = ""
  sensitive   = true
}

variable "tochka_base_url" {
  type        = string
  description = "Tochka API base URL. Defaults to the sandbox; set the production URL for a live deploy."
  default     = "https://enter.tochka.com/sandbox/v2"
}

variable "moysklad_base_url" {
  type        = string
  description = "MoySklad API base URL. Empty uses the connector default."
  default     = ""
}

variable "lockbox_token_key" {
  type        = string
  description = "Entry name inside each Lockbox secret payload that holds the token."
  default     = "token"
}
