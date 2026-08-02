# FinContext MCP — infrastructure skeleton (Task 1).
#
# This is the minimal parse/plan-level skeleton: the MCP cloud function plus an
# API Gateway fronting it via an OpenAPI spec. The full deployable module
# (timer trigger, YDB, Lockbox, least-privilege service account) is fleshed out
# in Task 10. No live deploy is required at this stage.

resource "yandex_function" "mcp" {
  name       = var.function_name
  runtime    = var.runtime
  entrypoint = "index.handler"
  memory     = 256

  user_hash = "skeleton-placeholder"

  content {
    zip_filename = "${path.module}/build/mcp.zip"
  }
}

resource "yandex_api_gateway" "mcp" {
  name = "${var.function_name}-gw"

  spec = templatefile("${path.module}/openapi.yaml.tftpl", {
    function_id = yandex_function.mcp.id
  })
}
