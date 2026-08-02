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
  description = "Name of the MCP cloud function."
  default     = "fincontext-mcp"
}

variable "runtime" {
  type        = string
  description = "Cloud Functions runtime for the Node.js handler."
  default     = "nodejs18"
}
