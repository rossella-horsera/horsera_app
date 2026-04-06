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
  -var "worker_gpu_image=${GPU_IMAGE}"

if [[ "${APPLY_FLAG}" == "--apply" ]]; then
  echo "==> Applying terraform"
  terraform apply \
    -var "project_id=${PROJECT_ID}" \
    -var "region=${REGION}" \
    -var "api_image=${CPU_IMAGE}" \
    -var "worker_image=${CPU_IMAGE}" \
    -var "worker_gpu_image=${GPU_IMAGE}" \
    -auto-approve
fi

echo "==> Done"
