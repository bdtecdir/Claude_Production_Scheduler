# Production Scheduler — notes for Claude

Next.js 15 (App Router) + TypeScript + Tailwind, Firestore, NextAuth (Google), deployed to Cloud Run.
See README.md for architecture, scheduling semantics and setup.

## Commands
- `npm run dev`: local dev. Use `.env.local` with `DATA_BACKEND=memory` and `AUTH_DEV_BYPASS=true`.
- `npm test`: Vitest suites for the scheduling engine. Cloud Build runs these and fails the image if they fail.
- `npm run typecheck`, `npm run build`
- Deploy (Windows): `powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -ProjectId cluade-gantt-project -AdminEmails "brian.dambacher@gmail.com"`

## Live deployment
- GCP project: `cluade-gantt-project` (the ID really is spelled "cluade"). Region: `us-central1`. Service: `production-scheduler`.
- URL: https://production-scheduler-6s5dx4ex7q-uc.a.run.app
- Secrets in Secret Manager: `nextauth-secret`, `google-oauth-client-id`, `google-oauth-client-secret`.
- The Firestore `(default)` database holds live data in collection `tasks`. Don't point local dev at it for experiments.

## Conventions
- `src/lib/scheduling/` is pure: no I/O and no `server-only`. It is shared by the API and the UI drag previews. Add tests for any engine change.
- Every write goes through the `create/update/deleteTask` mutations and `TaskRepository.mutate` (one Firestore transaction).
  The mutations must always include the edited task's id in `changedIds`, because `schedule()` diffs against already-patched input.
- Stored `startDate` means "start no earlier than" (default `respect-dates` mode).
- Files keep LF line endings (`.gitattributes`), except `*.ps1`, which use CRLF.

## Gotchas already hit
- New GCP projects: Cloud Build runs as `<number>-compute@developer.gserviceaccount.com`, which needs `roles/cloudbuild.builds.builder`. The deploy scripts now grant it.
- An OAuth client ID pasted with an `http://` prefix caused `invalid_client`. The deploy scripts now strip the prefix and validate the ID.
- If `gcloud` reports "Python was not found" on Windows, set `CLOUDSDK_PYTHON` to a real python.exe.
