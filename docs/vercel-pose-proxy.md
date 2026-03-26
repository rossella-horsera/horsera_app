# Vercel -> Cloud Run Pose Proxy (Authenticated Backend, Unauthenticated Browser)

This setup keeps Cloud Run authenticated while letting the browser call a same-origin Vercel route:

- Browser: `POST /api/pose/...` (no user auth required)
- Vercel function: exchanges Vercel OIDC token for GCP identity
- Cloud Run Pose API: accepts authenticated call from proxy identity

## 1) Terraform / Cloud Run

In `pose_api/infra/terraform.tfvars`:

```hcl
allow_unauthenticated_api = false
api_invoker_members = ["serviceAccount:vercel-pose-proxy@<project-id>.iam.gserviceaccount.com"]
```

Then apply Terraform.

## 2) Create Proxy Service Account

```bash
PROJECT_ID="<project-id>"
gcloud iam service-accounts create vercel-pose-proxy \
  --project "$PROJECT_ID" \
  --display-name "Vercel Pose Proxy"
```

If Terraform is not managing `api_invoker_members`, grant manually:

```bash
gcloud run services add-iam-policy-binding horsera-pose-api \
  --project "$PROJECT_ID" \
  --region us-east4 \
  --member "serviceAccount:vercel-pose-proxy@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role roles/run.invoker
```

## 3) Configure Workload Identity Federation (Keyless)

```bash
PROJECT_ID="<project-id>"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
POOL_ID="vercel-pool"
PROVIDER_ID="vercel-provider"
TEAM_SLUG="<your-vercel-team-slug>"
VERCEL_PROJECT_NAME="<your-vercel-project-name>"
SA_EMAIL="vercel-pose-proxy@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  --project "$PROJECT_ID"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --project "$PROJECT_ID" \
  --location global \
  --display-name "Vercel Workload Identity Pool"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project "$PROJECT_ID" \
  --location global \
  --workload-identity-pool "$POOL_ID" \
  --display-name "Vercel OIDC Provider" \
  --issuer-uri "https://oidc.vercel.com/${TEAM_SLUG}" \
  --allowed-audiences "https://vercel.com/${TEAM_SLUG}" \
  --attribute-mapping "google.subject=assertion.sub,attribute.owner=assertion.owner,attribute.project=assertion.project,attribute.environment=assertion.environment" \
  --attribute-condition "assertion.owner=='${TEAM_SLUG}' && assertion.project=='${VERCEL_PROJECT_NAME}' && assertion.environment=='production'"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/subject/owner:${TEAM_SLUG}:project:${VERCEL_PROJECT_NAME}:environment:production"
```

## 4) Add Vercel Environment Variables

- `POSE_API_URL=https://<cloud-run-service-url>`
- `POSE_API_AUDIENCE=https://<cloud-run-service-url>` (optional; defaults to `POSE_API_URL`)
- `GCP_PROJECT_NUMBER=<gcp-project-number>`
- `GCP_WORKLOAD_IDENTITY_POOL_ID=vercel-pool`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel-provider`
- `GCP_SERVICE_ACCOUNT_EMAIL=vercel-pose-proxy@<project-id>.iam.gserviceaccount.com`
- `VITE_POSE_API_URL=/api/pose`
- `VITE_POSE_API_LEGACY_UPLOAD_FALLBACK=0`

Optional fallback if your org allows key creation:

- `GCP_SERVICE_ACCOUNT_JSON=<entire service account key JSON>`

## 5) Deploy Frontend

Deploy to Vercel. The frontend will use `/api/pose` by default in non-local environments.

## Notes

- `vercel.json` is configured to keep `/api/*` routes intact and rewrite non-API paths to the SPA.
- Legacy multipart fallback (`/analyze/video`) is disabled by default for proxy mode, since large file passthrough via Vercel functions is not recommended.
