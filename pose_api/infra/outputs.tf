output "artifact_registry_repo" {
  description = "Artifact Registry Docker repository ID."
  value       = google_artifact_registry_repository.pose_api.id
}

output "upload_bucket" {
  description = "GCS upload bucket name."
  value       = google_storage_bucket.uploads.name
}

output "api_service_name" {
  description = "Cloud Run API service name."
  value       = google_cloud_run_v2_service.pose_api.name
}

output "api_service_uri" {
  description = "Cloud Run API service URL."
  value       = google_cloud_run_v2_service.pose_api.uri
}

output "cpu_worker_job_name" {
  description = "CPU worker Cloud Run Job name."
  value       = google_cloud_run_v2_job.pose_worker_cpu.name
}

output "gpu_worker_job_name" {
  description = "GPU worker Cloud Run Job name when enabled."
  value       = var.enable_gpu_job ? google_cloud_run_v2_job.pose_worker_gpu[0].name : null
}
