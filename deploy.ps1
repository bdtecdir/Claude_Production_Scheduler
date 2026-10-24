<#
.SYNOPSIS
  Build and deploy the scheduler to Google Cloud Run (Windows PowerShell).

.EXAMPLE
  .\deploy.ps1 -ProjectId my-project -AdminEmails "you@example.com,ops@example.com"

.NOTES
  Same steps as deploy.sh. Missing secrets are created on first run:
  nextauth-secret is generated; you are prompted for the Google OAuth client ID/secret.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$AdminEmails,
  [string]$Region = 'us-central1',
  [string]$Service = 'production-scheduler',
  [string]$ArRepo = 'containers',
  [string]$FirestoreDatabaseId = '(default)',
  [string]$FirestoreLocation = 'nam5',
  [string]$AdminEmailDomain = '',
  [string]$NextAuthUrl = ''
)

$ErrorActionPreference = 'Continue'
$SaName = "$Service-sa"
$SaEmail = "$SaName@$ProjectId.iam.gserviceaccount.com"
$Tag = Get-Date -Format 'yyyyMMddHHmmss'
$Image = "$Region-docker.pkg.dev/$ProjectId/$ArRepo/${Service}:$Tag"
$Secrets = @('nextauth-secret', 'google-oauth-client-id', 'google-oauth-client-secret')

function Fail([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

# Runs gcloud and stops the script if it fails.
function G {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) { Fail "gcloud $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

# True when a gcloud "describe" call succeeds (resource exists).
function Test-G {
  & gcloud @args *> $null
  return ($LASTEXITCODE -eq 0)
}

function New-Secret([string]$Name, [string]$Value) {
  # Write without a trailing newline; piping to a native exe would append CRLF.
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $Value)
    G secrets create $Name --replication-policy=automatic "--data-file=$tmp" | Out-Null
    Write-Host "    created $Name"
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# ---- Preflight ---------------------------------------------------------------
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { Fail 'gcloud CLI not found. Install the Google Cloud SDK.' }
if (-not (Test-G --version)) { Fail 'gcloud is installed but cannot run (often a missing Python). Reinstall the Cloud SDK with bundled Python.' }
$Account = (& gcloud auth list --filter=status:ACTIVE '--format=value(account)' 2>$null | Select-Object -First 1)
if (-not $Account) { Fail 'Not logged in. Run: gcloud auth login' }
if (-not (Test-G projects describe $ProjectId)) { Fail "Project '$ProjectId' not found or no access for $Account." }
Write-Host "==> Deploying as $Account to $ProjectId ($Region)" -ForegroundColor Cyan
G config set project $ProjectId 2>$null | Out-Null

Write-Host '==> Enabling APIs' -ForegroundColor Cyan
G services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com secretmanager.googleapis.com

Write-Host "==> Firestore database $FirestoreDatabaseId" -ForegroundColor Cyan
if (-not (Test-G firestore databases describe "--database=$FirestoreDatabaseId")) {
  G firestore databases create "--database=$FirestoreDatabaseId" "--location=$FirestoreLocation" --type=firestore-native
}

Write-Host '==> Secrets' -ForegroundColor Cyan
foreach ($s in $Secrets) {
  if (Test-G secrets describe $s) { continue }
  switch ($s) {
    'nextauth-secret' {
      $bytes = New-Object byte[] 32
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      New-Secret $s ([Convert]::ToBase64String($bytes))
    }
    'google-oauth-client-id' {
      $v = Read-Host '    Google OAuth client ID'
      $v = ($v.Trim() -replace '^https?://', '')
      if ($v -notmatch '^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$') {
        Fail "That doesn't look like an OAuth client ID (expected 1234-abc.apps.googleusercontent.com)"
      }
      New-Secret $s $v
    }
    'google-oauth-client-secret' {
      $secure = Read-Host '    Google OAuth client secret' -AsSecureString
      $v = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
      if (-not $v) { Fail 'Client secret required' }
      New-Secret $s $v.Trim()
    }
  }
}

Write-Host "==> Artifact Registry repo $ArRepo" -ForegroundColor Cyan
if (-not (Test-G artifacts repositories describe $ArRepo --location $Region)) {
  G artifacts repositories create $ArRepo --repository-format docker --location $Region
}

Write-Host "==> Runtime service account $SaEmail" -ForegroundColor Cyan
if (-not (Test-G iam service-accounts describe $SaEmail)) {
  G iam service-accounts create $SaName --display-name "$Service runtime"
}
G projects add-iam-policy-binding $ProjectId --member "serviceAccount:$SaEmail" --role roles/datastore.user --condition None | Out-Null
foreach ($s in $Secrets) {
  G secrets add-iam-policy-binding $s --member "serviceAccount:$SaEmail" --role roles/secretmanager.secretAccessor | Out-Null
}

# Newer projects run Cloud Build as the default compute service account, which
# can't read the uploaded source or push images until it gets the builder role.
Write-Host '==> Cloud Build service account' -ForegroundColor Cyan
$ProjectNumber = (& gcloud projects describe $ProjectId '--format=value(projectNumber)')
G projects add-iam-policy-binding $ProjectId --member "serviceAccount:$ProjectNumber-compute@developer.gserviceaccount.com" --role roles/cloudbuild.builds.builder --condition None | Out-Null

Write-Host "==> Building $Image with Cloud Build" -ForegroundColor Cyan
G builds submit --tag $Image .

# Keep NEXTAUTH_URL stable across redeploys: reuse the existing service URL.
$ExistingUrl = (& gcloud run services describe $Service --region $Region '--format=value(status.url)' 2>$null)
$AuthUrl = if ($NextAuthUrl) { $NextAuthUrl } else { $ExistingUrl }

# An env-vars file avoids delimiter problems with comma-separated values.
$envFile = [IO.Path]::GetTempFileName()
$lines = @(
  'DATA_BACKEND: "firestore"',
  "GOOGLE_CLOUD_PROJECT: `"$ProjectId`"",
  "FIRESTORE_DATABASE_ID: `"$FirestoreDatabaseId`"",
  "ADMIN_EMAILS: `"$AdminEmails`"",
  "ADMIN_EMAIL_DOMAIN: `"$AdminEmailDomain`""
)
if ($AuthUrl) { $lines += "NEXTAUTH_URL: `"$AuthUrl`"" }
[IO.File]::WriteAllLines($envFile, $lines)

$SecretMap = 'NEXTAUTH_SECRET=nextauth-secret:latest,GOOGLE_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest'
try {
  Write-Host "==> Deploying $Service" -ForegroundColor Cyan
  G run deploy $Service `
    --image $Image `
    --region $Region `
    --platform managed `
    --service-account $SaEmail `
    --allow-unauthenticated `
    --port 8080 `
    --cpu 1 `
    --memory 512Mi `
    --concurrency 80 `
    --min-instances 0 `
    --max-instances 10 `
    --timeout 60s `
    --cpu-boost `
    --env-vars-file $envFile `
    --set-secrets $SecretMap
} finally { Remove-Item $envFile -Force -ErrorAction SilentlyContinue }

$Url = (& gcloud run services describe $Service --region $Region '--format=value(status.url)')
if (-not $AuthUrl) {
  Write-Host "==> First deploy: setting NEXTAUTH_URL=$Url" -ForegroundColor Cyan
  G run services update $Service --region $Region --update-env-vars "NEXTAUTH_URL=$Url" | Out-Null
  $AuthUrl = $Url
}

Write-Host ''
Write-Host "Deployed: $Url" -ForegroundColor Green
Write-Host "Health:   $Url/api/healthz"
Write-Host 'Make sure this redirect URI is on your Google OAuth client:'
Write-Host "  $AuthUrl/api/auth/callback/google"
