variable "project_id" {
  type        = string
  description = "GCP project ID for Horsera pose infrastructure."
}

variable "region" {
  type        = string
  description = "Primary region for Cloud Run and storage resources."
  default     = "us-east4"
}

variable "name_prefix" {
  type        = string
  description = "Prefix used to name resources."
  default     = "horsera-pose"
}

variable "api_image" {
  type        = string
  description = "Container image for the public Pose API Cloud Run service."
}

variable "worker_image" {
  type        = string
  description = "Container image for CPU/GPU worker Cloud Run Jobs."
}

variable "cors_origins" {
  type        = string
  description = "Comma-separated CORS origins for Pose API."
  default     = "https://horsera.app,https://app.horsera.ai,http://localhost:5173,http://localhost:8080"
}

variable "upload_bucket_name" {
  type        = string
  description = "Bucket name for direct-uploaded videos."
}

variable "upload_retention_days" {
  type        = number
  description = "Days to keep uploaded raw videos before lifecycle delete."
  default     = 7
}

variable "gpu_threshold_mb" {
  type        = number
  description = "Size threshold in MB above which the API dispatches GPU worker jobs."
  default     = 120
}

variable "enable_gpu_job" {
  type        = bool
  description = "Whether to provision a GPU worker Cloud Run Job."
  default     = true
}

variable "create_firestore_database" {
  type        = bool
  description = "Create the default Firestore database. Set false if one already exists."
  default     = false
}

variable "firestore_collection" {
  type        = string
  description = "Firestore collection for job state."
  default     = "pose_jobs"
}
