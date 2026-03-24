# Horsera Pose GCP Terraform

This directory provisions the first-pass GCP infrastructure for the Pose API migration:

- Artifact Registry Docker repo
- GCS upload bucket (with lifecycle delete)
- Cloud Run API service
- Cloud Run CPU worker Job
- Cloud Run GPU worker Job (optional)
- Service accounts + IAM bindings
- Optional Firestore default database creation

## Quick Start

1. Copy and edit variables:

```bash
cp terraform.tfvars.example terraform.tfvars
```

2. Initialize and preview:

```bash
terraform init
terraform plan
```

3. Apply:

```bash
terraform apply
```

## Notes

- `create_firestore_database` defaults to `false` to avoid conflicts in projects where Firestore already exists.
- API runtime is configured for:
  - `JOB_STORE_BACKEND=firestore`
  - `EXECUTION_BACKEND=cloud_run_job`
  - signed uploads to the provisioned GCS bucket
- Worker jobs run `python worker.py` and expect runtime env overrides from API dispatch:
  - `POSE_JOB_ID`
  - `POSE_OBJECT_PATH`
  - `POSE_FILENAME`
  - `POSE_SIZE_MB`
- Secret management (Supabase and other secrets) is intentionally not hardcoded in this first pass; wire those with Secret Manager and Cloud Run secret env refs before production cutover.
