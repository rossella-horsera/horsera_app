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

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="${ROOT_DIR}/pose_api/infra"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/horsera-pose-repo/pose-api:${TAG}"

echo "==> Building image ${IMAGE}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev"
docker build -f "${ROOT_DIR}/pose_api/Dockerfile" -t "${IMAGE}" "${ROOT_DIR}/pose_api"
docker push "${IMAGE}"

echo "==> Running terraform plan"
cd "${INFRA_DIR}"
terraform init
terraform plan \
  -var "project_id=${PROJECT_ID}" \
  -var "region=${REGION}" \
  -var "api_image=${IMAGE}" \
  -var "worker_image=${IMAGE}"

if [[ "${APPLY_FLAG}" == "--apply" ]]; then
  echo "==> Applying terraform"
  terraform apply \
    -var "project_id=${PROJECT_ID}" \
    -var "region=${REGION}" \
    -var "api_image=${IMAGE}" \
    -var "worker_image=${IMAGE}" \
    -auto-approve
fi

echo "==> Done"
