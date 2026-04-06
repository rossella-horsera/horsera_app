locals {
  common_labels = {
    app         = var.name_prefix
    managed_by  = "terraform"
    environment = "prod"
  }

  cors_origins_list = [
    for origin in split(",", var.cors_origins) : trimspace(origin)
    if trimspace(origin) != ""
  ]

  supabase_secret_env = var.inject_supabase_secrets ? [
    {
      name      = "SUPABASE_URL"
      secret_id = var.supabase_url_secret_id
    },
    {
      name      = "SUPABASE_KEY"
      secret_id = var.supabase_key_secret_id
    },
  ] : []

  supabase_url_secret_name   = "projects/${var.project_id}/secrets/${var.supabase_url_secret_id}"
  supabase_key_secret_name   = "projects/${var.project_id}/secrets/${var.supabase_key_secret_id}"
  worker_gpu_image_effective = trimspace(var.worker_gpu_image) != "" ? var.worker_gpu_image : var.worker_image

  required_services = toset([
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "secretmanager.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services
  project  = var.project_id
  service  = each.value
}

resource "google_artifact_registry_repository" "pose_api" {
  count = var.manage_artifact_registry_repository ? 1 : 0

  location      = var.region
  repository_id = "${var.name_prefix}-repo"
  description   = "Container repository for Horsera Pose API and workers"
  format        = "DOCKER"

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "uploads" {
  name                        = var.upload_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  labels                      = local.common_labels

  lifecycle_rule {
    condition {
      age = var.upload_retention_days
    }
    action {
      type = "Delete"
    }
  }

  cors {
    origin          = local.cors_origins_list
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type", "x-goog-resumable", "x-goog-meta-*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.required]
}

resource "google_firestore_database" "default" {
  count = var.create_firestore_database ? 1 : 0

  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "api" {
  account_id   = "${replace(var.name_prefix, "-", "")}api"
  display_name = "Horsera Pose API Service Account"
}

resource "google_service_account" "worker" {
  account_id   = "${replace(var.name_prefix, "-", "")}worker"
  display_name = "Horsera Pose Worker Service Account"
}

resource "google_secret_manager_secret" "supabase_url" {
  count     = var.manage_supabase_secrets ? 1 : 0
  secret_id = var.supabase_url_secret_id
  labels    = local.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "supabase_key" {
  count     = var.manage_supabase_secrets ? 1 : 0
  secret_id = var.supabase_key_secret_id
  labels    = local.common_labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "api_run_jobs" {
  count = var.manage_iam_bindings ? 1 : 0

  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_firestore" {
  count = var.manage_iam_bindings ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "api_act_as_worker" {
  count = var.manage_iam_bindings ? 1 : 0

  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "api_sign_blob" {
  count = var.manage_iam_bindings ? 1 : 0

  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "api_upload_creator" {
  count = var.manage_iam_bindings ? 1 : 0

  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "worker_upload_viewer" {
  count = var.manage_iam_bindings ? 1 : 0

  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_firestore" {
  count = var.manage_iam_bindings ? 1 : 0

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_logs" {
  count = var.manage_iam_bindings ? 1 : 0

  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "api_supabase_url_accessor" {
  count = var.manage_iam_bindings && var.inject_supabase_secrets ? 1 : 0

  secret_id = local.supabase_url_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_supabase_key_accessor" {
  count = var.manage_iam_bindings && var.inject_supabase_secrets ? 1 : 0

  secret_id = local.supabase_key_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_supabase_url_accessor" {
  count = var.manage_iam_bindings && var.inject_supabase_secrets ? 1 : 0

  secret_id = local.supabase_url_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_supabase_key_accessor" {
  count = var.manage_iam_bindings && var.inject_supabase_secrets ? 1 : 0

  secret_id = local.supabase_key_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_run_v2_service" "pose_api" {
  name                = "${var.name_prefix}-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false
  labels              = local.common_labels

  template {
    service_account = google_service_account.api.email
    timeout         = "3600s"

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.api_image

      ports {
        container_port = 8080
      }

      env {
        name  = "CORS_ORIGINS"
        value = var.cors_origins
      }
      env {
        name  = "GCS_UPLOAD_BUCKET"
        value = google_storage_bucket.uploads.name
      }
      env {
        name  = "GCS_UPLOAD_PREFIX"
        value = "uploads"
      }
      env {
        name  = "GCS_SIGNING_SERVICE_ACCOUNT_EMAIL"
        value = google_service_account.api.email
      }
      env {
        name  = "SIGNED_URL_TTL_SECONDS"
        value = "900"
      }
      env {
        name  = "JOB_STORE_BACKEND"
        value = "firestore"
      }
      env {
        name  = "FIRESTORE_COLLECTION"
        value = var.firestore_collection
      }
      env {
        name  = "EXECUTION_BACKEND"
        value = "cloud_run_job"
      }
      env {
        name  = "PRELOAD_MODELS"
        value = "0"
      }
      env {
        name  = "GPU_THRESHOLD_MB"
        value = tostring(var.gpu_threshold_mb)
      }
      env {
        name  = "CLOUD_RUN_PROJECT"
        value = var.project_id
      }
      env {
        name  = "CLOUD_RUN_REGION"
        value = var.region
      }
      env {
        name  = "CLOUD_RUN_CPU_JOB"
        value = google_cloud_run_v2_job.pose_worker_cpu.name
      }
      env {
        name = "CLOUD_RUN_GPU_JOB"
        # GPU job created via gcloud (terraform can't manage it due to v2 API annotation bug).
        # Hardcoded to the gcloud-created job name.
        value = "horsera-pose-worker-gpu"
      }

      dynamic "env" {
        for_each = local.supabase_secret_env
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.api_run_jobs,
    google_project_iam_member.api_firestore,
    google_service_account_iam_member.api_act_as_worker,
    google_service_account_iam_member.api_sign_blob,
    google_storage_bucket_iam_member.api_upload_creator,
    google_secret_manager_secret_iam_member.api_supabase_url_accessor,
    google_secret_manager_secret_iam_member.api_supabase_key_accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  count = var.allow_unauthenticated_api && var.manage_iam_bindings ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.pose_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "api_invoker_members" {
  for_each = var.manage_iam_bindings ? toset(var.api_invoker_members) : toset([])

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.pose_api.name
  role     = "roles/run.invoker"
  member   = each.value
}

resource "google_cloud_run_v2_job" "pose_worker_cpu" {
  name                = "${var.name_prefix}-worker-cpu"
  location            = var.region
  deletion_protection = false
  labels              = local.common_labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.worker.email
      timeout         = "3600s"
      max_retries     = 0

      containers {
        image   = var.worker_image
        command = ["python", "worker.py"]
        env {
          name  = "JOB_STORE_BACKEND"
          value = "firestore"
        }
        env {
          name  = "FIRESTORE_COLLECTION"
          value = var.firestore_collection
        }
        dynamic "env" {
          for_each = local.supabase_secret_env
          content {
            name = env.value.name
            value_source {
              secret_key_ref {
                secret  = env.value.secret_id
                version = "latest"
              }
            }
          }
        }
        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_storage_bucket_iam_member.worker_upload_viewer,
    google_project_iam_member.worker_firestore,
    google_project_iam_member.worker_logs,
    google_secret_manager_secret_iam_member.worker_supabase_url_accessor,
    google_secret_manager_secret_iam_member.worker_supabase_key_accessor,
  ]
}

resource "google_cloud_run_v2_job" "pose_worker_gpu" {
  provider = google-beta
  count    = var.enable_gpu_job ? 1 : 0

  name                = "${var.name_prefix}-worker-gpu"
  location            = var.region
  deletion_protection = false
  labels              = local.common_labels
  launch_stage        = "BETA"

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.worker.email
      timeout         = "3600s"
      max_retries     = 0

      containers {
        image   = local.worker_gpu_image_effective
        command = ["python", "worker.py"]
        env {
          name  = "JOB_STORE_BACKEND"
          value = "firestore"
        }
        env {
          name  = "FIRESTORE_COLLECTION"
          value = var.firestore_collection
        }
        env {
          name  = "INFER_BATCH_SIZE"
          value = tostring(var.gpu_infer_batch_size)
        }
        env {
          name  = "REQUIRE_CUDA"
          value = "1"
        }
        dynamic "env" {
          for_each = local.supabase_secret_env
          content {
            name = env.value.name
            value_source {
              secret_key_ref {
                secret  = env.value.secret_id
                version = "latest"
              }
            }
          }
        }
        resources {
          limits = {
            cpu              = "4"
            memory           = "16Gi"
            "nvidia.com/gpu" = "1"
          }
        }
      }

      node_selector {
        accelerator = "nvidia-l4"
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_storage_bucket_iam_member.worker_upload_viewer,
    google_project_iam_member.worker_firestore,
    google_project_iam_member.worker_logs,
    google_secret_manager_secret_iam_member.worker_supabase_url_accessor,
    google_secret_manager_secret_iam_member.worker_supabase_key_accessor,
  ]
}
