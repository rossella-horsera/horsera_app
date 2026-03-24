locals {
  common_labels = {
    app         = var.name_prefix
    managed_by  = "terraform"
    environment = "prod"
  }

  required_services = toset([
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "firestore.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services
  project  = var.project_id
  service  = each.value
}

resource "google_artifact_registry_repository" "pose_api" {
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

resource "google_project_iam_member" "api_run_jobs" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_storage" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
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
        name  = "CLOUD_RUN_GPU_JOB"
        value = var.enable_gpu_job ? google_cloud_run_v2_job.pose_worker_gpu[0].name : ""
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
    google_project_iam_member.api_sa_user,
  ]
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
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.worker_storage,
    google_project_iam_member.worker_firestore,
    google_project_iam_member.worker_logs,
  ]
}

resource "google_cloud_run_v2_job" "pose_worker_gpu" {
  provider = google-beta
  count    = var.enable_gpu_job ? 1 : 0

  name                = "${var.name_prefix}-worker-gpu"
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
        resources {
          limits = {
            cpu            = "4"
            memory         = "16Gi"
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
    google_project_iam_member.worker_storage,
    google_project_iam_member.worker_firestore,
    google_project_iam_member.worker_logs,
  ]
}
