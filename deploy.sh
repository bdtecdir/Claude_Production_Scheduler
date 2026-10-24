#!/usr/bin/env bash
# Build and deploy the scheduler to Google Cloud Run (bash / Git Bash / Cloud Shell).
# Windows PowerShell users can run deploy.ps1 instead; both do the same thing.
#
# Required:  PROJECT_ID, ADMIN_EMAILS (comma separated)
# Optional:  REGION (us-central1), SERVICE (production-scheduler), AR_REPO (containers),
#            FIRESTORE_DATABASE_ID ((default)), FIRESTORE_LOCATION (nam5),
#            ADMIN_EMAIL_DOMAIN, NEXTAUTH_URL (defaults to the service URL)
#
# Missing secrets are created on first run: nextauth-secret is generated, and
# you are prompted for the Google OAuth client ID and secret.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
ADMIN_EMAILS="${ADMIN_EMAILS:?Set ADMIN_EMAILS (comma separated)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-production-scheduler}"
AR_REPO="${AR_REPO:-containers}"
FIRESTORE_DATABASE_ID="${FIRESTORE_DATABASE_ID:-(default)}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-nam5}"
ADMIN_EMAIL_DOMAIN="${ADMIN_EMAIL_DOMAIN:-}"
SA_NAME="${SERVICE}-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE}:${TAG}"
SECRETS=(nextauth-secret google-oauth-client-id google-oauth-client-secret)

die() { echo "ERROR: $*" >&2; exit 1; }

# ---- Preflight ---------------------------------------------------------------
command -v gcloud >/dev/null || die "gcloud CLI not found. Install the Google Cloud SDK."
gcloud --version >/dev/null 2>&1 || die "gcloud is installed but cannot run (often a missing Python). Reinstall the Cloud SDK with bundled Python."
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
[[ -n "$ACCOUNT" ]] || die "Not logged in. Run: gcloud auth login"
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || die "Project '$PROJECT_ID' not found or no access for $ACCOUNT."
echo "==> Deploying as ${ACCOUNT} to ${PROJECT_ID} (${REGION})"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com firestore.googleapis.com secretmanager.googleapis.com

echo "==> Firestore database ${FIRESTORE_DATABASE_ID}"
if ! gcloud firestore databases describe --database="$FIRESTORE_DATABASE_ID" >/dev/null 2>&1; then
  gcloud firestore databases create --database="$FIRESTORE_DATABASE_ID" \
    --location="$FIRESTORE_LOCATION" --type=firestore-native
fi

echo "==> Secrets"
create_secret() { # name value
  printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  echo "    created $1"
}
for s in "${SECRETS[@]}"; do
  gcloud secrets describe "$s" >/dev/null 2>&1 && continue
  case "$s" in
    nextauth-secret) create_secret "$s" "$(head -c 32 /dev/urandom | base64)" ;;
    google-oauth-client-id)
      read -rp "    Google OAuth client ID: " v
      v="$(echo "$v" | tr -d '[:space:]')"; v="${v#http://}"; v="${v#https://}"
      [[ "$v" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]] ||
        die "That doesn't look like an OAuth client ID (expected 1234-abc.apps.googleusercontent.com)"
      create_secret "$s" "$v" ;;
    google-oauth-client-secret) read -rsp "    Google OAuth client secret: " v; echo; [[ -n "$v" ]] || die "Client secret required"; create_secret "$s" "$v" ;;
  esac
done

echo "==> Artifact Registry repo ${AR_REPO}"
gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION"

echo "==> Runtime service account ${SA_EMAIL}"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NAME" --display-name "${SERVICE} runtime"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${SA_EMAIL}" --role roles/datastore.user --condition None >/dev/null
for s in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor >/dev/null
done

# Newer projects run Cloud Build as the default compute service account, which
# can't read the uploaded source or push images until it gets the builder role.
echo "==> Cloud Build service account"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/cloudbuild.builds.builder --condition None >/dev/null

echo "==> Building ${IMAGE} with Cloud Build"
gcloud builds submit --tag "$IMAGE" .

# Keep NEXTAUTH_URL stable across redeploys: reuse the existing service URL.
EXISTING_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)' 2>/dev/null || true)"
AUTH_URL="${NEXTAUTH_URL:-$EXISTING_URL}"

# An env-vars file avoids delimiter problems with comma-separated values.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
{
  echo "DATA_BACKEND: \"firestore\""
  echo "GOOGLE_CLOUD_PROJECT: \"${PROJECT_ID}\""
  echo "FIRESTORE_DATABASE_ID: \"${FIRESTORE_DATABASE_ID}\""
  echo "ADMIN_EMAILS: \"${ADMIN_EMAILS}\""
  echo "ADMIN_EMAIL_DOMAIN: \"${ADMIN_EMAIL_DOMAIN}\""
  [[ -n "$AUTH_URL" ]] && echo "NEXTAUTH_URL: \"${AUTH_URL}\""
} >"$ENV_FILE"

echo "==> Deploying ${SERVICE}"
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 60s \
  --cpu-boost \
  --env-vars-file "$ENV_FILE" \
  --set-secrets "NEXTAUTH_SECRET=nextauth-secret:latest,GOOGLE_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
if [[ -z "$AUTH_URL" ]]; then
  echo "==> First deploy: setting NEXTAUTH_URL=${URL}"
  gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "NEXTAUTH_URL=${URL}" >/dev/null
  AUTH_URL="$URL"
fi

cat <<MSG

Deployed: ${URL}
Health:   ${URL}/api/healthz
Make sure this redirect URI is on your Google OAuth client:
  ${AUTH_URL}/api/auth/callback/google
MSG
