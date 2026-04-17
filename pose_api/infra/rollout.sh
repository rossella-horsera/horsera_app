#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" || "${2:-}" == "" ]]; then
  echo "Usage: $0 <project-id> <region> [tag] [--apply]"
  echo "Example: $0 my-gcp-project us-east4 \$(git rev-parse --short HEAD) --apply"
  exit 1
fi

PROJECT_ID="$1"
REGION="$2"
TAG="${3:-$(git rev-parse --short HEAD)}"
APPLY_FLAG="${4:-}"
PLATFORM="${PLATFORM:-linux/amd64}"
UPLOAD_BUCKET_NAME="${UPLOAD_BUCKET_NAME:-horsera-pose-input-${PROJECT_ID}}"
NAME_PREFIX="${NAME_PREFIX:-horsera-pose}"
FIRESTORE_COLLECTION="${FIRESTORE_COLLECTION:-pose_jobs}"
GCS_RESULTS_PREFIX="${GCS_RESULTS_PREFIX:-job-results}"
GPU_JOB_NAME="${GPU_JOB_NAME:-${NAME_PREFIX}-worker-gpu}"
GPU_CPU="${GPU_CPU:-4}"
GPU_MEMORY="${GPU_MEMORY:-16Gi}"
GPU_COUNT="${GPU_COUNT:-1}"
GPU_TYPE="${GPU_TYPE:-nvidia-l4}"
GPU_TASKS="${GPU_TASKS:-1}"
GPU_PARALLELISM="${GPU_PARALLELISM:-1}"
GPU_TIMEOUT_SECONDS="${GPU_TIMEOUT_SECONDS:-3600}"
GPU_INFER_BATCH_SIZE="${GPU_INFER_BATCH_SIZE:-4}"
WORKER_SERVICE_ACCOUNT="${WORKER_SERVICE_ACCOUNT:-${NAME_PREFIX//-/}worker@${PROJECT_ID}.iam.gserviceaccount.com}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="${ROOT_DIR}/pose_api/infra"
CPU_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/horsera-pose-repo/pose-api:${TAG}"
GPU_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/horsera-pose-repo/pose-api:${TAG}-gpu"

echo "==> Building CPU image ${CPU_IMAGE}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev"
docker buildx build \
  --platform "${PLATFORM}" \
  -f "${ROOT_DIR}/pose_api/Dockerfile" \
  --build-arg "PIP_REQUIREMENTS=requirements.cpu.txt" \
  -t "${CPU_IMAGE}" \
  --push \
  "${ROOT_DIR}/pose_api"

echo "==> Building GPU image ${GPU_IMAGE}"
docker buildx build \
  --platform "${PLATFORM}" \
  -f "${ROOT_DIR}/pose_api/Dockerfile" \
  --build-arg "PIP_REQUIREMENTS=requirements.gpu.txt" \
  -t "${GPU_IMAGE}" \
  --push \
  "${ROOT_DIR}/pose_api"

echo "==> Running terraform plan"
cd "${INFRA_DIR}"
terraform init
terraform plan \
  -var "project_id=${PROJECT_ID}" \
  -var "region=${REGION}" \
  -var "api_image=${CPU_IMAGE}" \
  -var "worker_image=${CPU_IMAGE}" \
  -var "worker_gpu_image=${GPU_IMAGE}" \
  -var "enable_gpu_job=false" \
  -var "upload_bucket_name=${UPLOAD_BUCKET_NAME}"

if [[ "${APPLY_FLAG}" == "--apply" ]]; then
  echo "==> Applying terraform"
  terraform apply \
    -var "project_id=${PROJECT_ID}" \
    -var "region=${REGION}" \
    -var "api_image=${CPU_IMAGE}" \
    -var "worker_image=${CPU_IMAGE}" \
    -var "worker_gpu_image=${GPU_IMAGE}" \
    -var "enable_gpu_job=false" \
    -var "upload_bucket_name=${UPLOAD_BUCKET_NAME}" \
    -auto-approve

  GPU_JOB_SPEC="$(mktemp "${TMPDIR:-/tmp}/horsera-gpu-job.XXXXXX.yaml")"
  cat > "${GPU_JOB_SPEC}" <<EOF
apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: ${GPU_JOB_NAME}
  labels:
    cloud.googleapis.com/location: ${REGION}
    app: ${NAME_PREFIX}
    managed_by: rollout-script
    environment: prod
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/gpu-zonal-redundancy-disabled: "true"
    spec:
      taskCount: ${GPU_TASKS}
      parallelism: ${GPU_PARALLELISM}
      template:
        spec:
          maxRetries: 0
          timeoutSeconds: ${GPU_TIMEOUT_SECONDS}
          serviceAccountName: ${WORKER_SERVICE_ACCOUNT}
          containers:
            - image: ${GPU_IMAGE}
              command:
                - python
                - worker.py
              env:
                - name: JOB_STORE_BACKEND
                  value: firestore
                - name: FIRESTORE_COLLECTION
                  value: ${FIRESTORE_COLLECTION}
                - name: GCS_UPLOAD_BUCKET
                  value: ${UPLOAD_BUCKET_NAME}
                - name: GCS_RESULTS_PREFIX
                  value: ${GCS_RESULTS_PREFIX}
                - name: STRICT_JOB_PERSISTENCE
                  value: "1"
                - name: INFER_BATCH_SIZE
                  value: "${GPU_INFER_BATCH_SIZE}"
                - name: REQUIRE_CUDA
                  value: "1"
              resources:
                limits:
                  cpu: "${GPU_CPU}"
                  memory: "${GPU_MEMORY}"
                  nvidia.com/gpu: "${GPU_COUNT}"
          nodeSelector:
            run.googleapis.com/accelerator: ${GPU_TYPE}
EOF

  echo "==> Creating/updating GPU worker job ${GPU_JOB_NAME}"
  gcloud run jobs replace "${GPU_JOB_SPEC}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}"

  rm -f "${GPU_JOB_SPEC}"
fi

echo "==> Done"
