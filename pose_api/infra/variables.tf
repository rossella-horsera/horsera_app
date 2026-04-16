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

variable "manage_artifact_registry_repository" {
  type        = bool
  description = "Create/manage the Artifact Registry repository via Terraform. Set false if it already exists and is managed outside Terraform."
  default     = true
}

variable "api_image" {
  type        = string
  description = "Container image for the public Pose API Cloud Run service."
}

variable "worker_image" {
  type        = string
  description = "Container image for CPU worker Cloud Run Job."
}

variable "worker_gpu_image" {
  type        = string
  description = "Optional container image for GPU worker Cloud Run Job. Defaults to worker_image when empty."
  default     = ""
}

variable "cors_origins" {
  type        = string
  description = "Comma-separated CORS origins for Pose API."
  default     = "https://horsera.app,https://app.horsera.ai,http://localhost:5173,http://localhost:8080"
}

variable "allow_unauthenticated_api" {
  type        = bool
  description = "Allow unauthenticated public access to the API Cloud Run service."
  default     = false
}

variable "api_invoker_members" {
  type        = list(string)
  description = "Additional members to grant Cloud Run invoker on the API service (for authenticated caller identities such as a Vercel proxy service account)."
  default     = []
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
  description = "Whether Terraform should attempt to provision the GPU worker Cloud Run Job directly. Keep false unless the Cloud Run v2 GPU annotation bug is resolved; rollout.sh manages the GPU job via gcloud."
  default     = false
}

variable "gpu_zonal_redundancy_disabled" {
  type        = bool
  description = "Disable GPU zonal redundancy for Cloud Run Jobs when required by regional capacity constraints."
  default     = true
}

variable "gpu_infer_batch_size" {
  type        = number
  description = "Frame batch size for GPU worker ONNX inference."
  default     = 4
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

variable "manage_iam_bindings" {
  type        = bool
  description = "Manage IAM bindings (project/service account/bucket/secret) via Terraform. Set false when lacking IAM policy update permissions."
  default     = true
}
