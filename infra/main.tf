locals {
  common_labels = {
    app     = "fincontext-mcp"
    managed = "terraform"
  }

  base_environment = {
    YDB_DATABASE_PATH   = yandex_ydb_database_serverless.fincontext.database_path
    YDB_ENDPOINT        = yandex_ydb_database_serverless.fincontext.ydb_full_endpoint
    REPORT_CURRENCY     = var.report_currency
    LOCKBOX_TOCHKA_ID   = yandex_lockbox_secret.tochka.id
    LOCKBOX_MOYSKLAD_ID = yandex_lockbox_secret.moysklad.id
    LOCKBOX_TOKEN_KEY   = var.lockbox_token_key
  }
}

resource "yandex_iam_service_account" "fincontext" {
  folder_id   = var.folder_id
  name        = "${var.function_name}-sa"
  description = "Runtime identity for FinContext functions: YDB access and Lockbox read only."
}

resource "yandex_ydb_database_serverless" "fincontext" {
  folder_id = var.folder_id
  name      = "${var.function_name}-ydb"
  labels    = local.common_labels
}

resource "yandex_ydb_database_iam_binding" "ydb_editor" {
  database_id = yandex_ydb_database_serverless.fincontext.id
  role        = "ydb.editor"
  members     = ["serviceAccount:${yandex_iam_service_account.fincontext.id}"]
}

resource "yandex_function_iam_binding" "mcp_invoker" {
  function_id = yandex_function.mcp.id
  role        = "functions.functionInvoker"
  members     = ["serviceAccount:${yandex_iam_service_account.fincontext.id}"]
}

resource "yandex_function_iam_binding" "sync_invoker" {
  function_id = yandex_function.sync.id
  role        = "functions.functionInvoker"
  members     = ["serviceAccount:${yandex_iam_service_account.fincontext.id}"]
}

resource "yandex_lockbox_secret" "tochka" {
  folder_id   = var.folder_id
  name        = "${var.function_name}-tochka-token"
  description = "Read-only Tochka API token. Populated by the client; never leaves this cloud."
  labels      = local.common_labels
}

resource "yandex_lockbox_secret" "moysklad" {
  folder_id   = var.folder_id
  name        = "${var.function_name}-moysklad-token"
  description = "Read-only MoySklad API token. Populated by the client; never leaves this cloud."
  labels      = local.common_labels
}

resource "yandex_lockbox_secret_iam_member" "tochka_viewer" {
  secret_id = yandex_lockbox_secret.tochka.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.fincontext.id}"
}

resource "yandex_lockbox_secret_iam_member" "moysklad_viewer" {
  secret_id = yandex_lockbox_secret.moysklad.id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.fincontext.id}"
}

resource "yandex_function" "mcp" {
  folder_id          = var.folder_id
  name               = var.function_name
  description        = "FinContext MCP streamable-HTTP JSON-RPC endpoint."
  runtime            = var.runtime
  entrypoint         = "index.handler"
  memory             = var.function_memory
  execution_timeout  = var.function_timeout
  service_account_id = yandex_iam_service_account.fincontext.id
  labels             = local.common_labels

  user_hash = filebase64sha256("${path.module}/${var.mcp_zip_path}")

  environment = merge(
    local.base_environment,
    var.pro_key != "" ? { FINCONTEXT_PRO_KEY = var.pro_key } : {},
  )

  content {
    zip_filename = "${path.module}/${var.mcp_zip_path}"
  }
}

resource "yandex_function" "sync" {
  folder_id          = var.folder_id
  name               = "${var.function_name}-sync"
  description        = "FinContext incremental sync: refresh statements/payments and recompute positions."
  runtime            = var.runtime
  entrypoint         = "index.handler"
  memory             = var.function_memory
  execution_timeout  = var.function_timeout
  service_account_id = yandex_iam_service_account.fincontext.id
  labels             = local.common_labels

  user_hash = filebase64sha256("${path.module}/${var.sync_zip_path}")

  environment = merge(
    local.base_environment,
    { TOCHKA_BASE_URL = var.tochka_base_url },
    var.pro_key != "" ? { FINCONTEXT_PRO_KEY = var.pro_key } : {},
    var.moysklad_base_url != "" ? { MOYSKLAD_BASE_URL = var.moysklad_base_url } : {},
  )

  content {
    zip_filename = "${path.module}/${var.sync_zip_path}"
  }
}

resource "yandex_function_trigger" "sync_timer" {
  folder_id   = var.folder_id
  name        = "${var.function_name}-sync-timer"
  description = "Runs the incremental sync on a schedule."
  labels      = local.common_labels

  timer {
    cron_expression = var.sync_cron
  }

  function {
    id                 = yandex_function.sync.id
    service_account_id = yandex_iam_service_account.fincontext.id
  }
}

resource "yandex_api_gateway" "mcp" {
  folder_id = var.folder_id
  name      = "${var.function_name}-gw"
  labels    = local.common_labels

  spec = templatefile("${path.module}/openapi.yaml.tftpl", {
    function_id        = yandex_function.mcp.id
    service_account_id = yandex_iam_service_account.fincontext.id
  })
}
