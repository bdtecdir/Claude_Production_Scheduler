# Production Scheduler

Production & project scheduling with Critical Path Method (CPM) analysis.
Next.js 15 (App Router) + TypeScript + Tailwind, Google Cloud Firestore, and
Google SSO for admins. Built to run on Google Cloud Run.

- **Gantt**: custom SVG chart with a hierarchical task tree, Days/Weeks/Months zoom,
  critical path in red, FS/SS/FF/SF connector arrows, milestone diamonds, and
  drag-to-move / drag-to-resize with a live cascade preview.
- **Calendar**: month grid with multi-day spanning bars, milestone badges and a
  `Monday Start | Sunday Start` toggle (saved per browser). Admins click a day to add an item on it.
- **Table**: WBS codes, predecessors (`1.2FS+3d`), float and critical flags, plus search, type and critical filters,
  sorting, inline editing and an Edit / Add subtask / Delete menu.
- **Quick-Add** (header button, or press `N`): tasks or milestones, parent, predecessors
  with type and lag, and dates. The form dry-runs the change through the engine, so it shows
  cycles and pushed dates before you save.

Anyone can view. Only signed-in admins can change the schedule.

## Project layout

```
src/
  lib/scheduling/        Pure scheduling engine (no I/O). Shared by API and UI.
    dates.ts             Calendar-day arithmetic on ISO dates (7-day calendar)
    graph.ts             Topological sort + CycleError with the offending loop
    hierarchy.ts         Parent/subtask tree, WBS codes, parent-cycle checks
    cpm.ts               Forward/backward pass, float, critical flags, rollups
    mutations.ts         create/update/delete → fully rescheduled task list
    validate.ts          Request-body validation
    __tests__/           Vitest suites (38 tests)
  lib/db/                TaskRepository: Firestore (transactional) or in-memory
  lib/auth.ts            NextAuth Google provider + admin allowlist
  app/api/tasks          GET (public), POST, PATCH, DELETE (admin)
  components/            AppShell, TaskFormModal, views/{Gantt,Calendar,Table}View
Dockerfile               Multi-stage node:20-alpine → standalone server on :8080
deploy.sh                Artifact Registry build + `gcloud run deploy`
firestore.rules          Public read, admin-only write
```

## Scheduling semantics

| Concept | Rule |
| --- | --- |
| Dates | `startDate` and `endDate` are inclusive ISO dates. Tasks last `durationDays` ≥ 1, and a milestone has `durationDays = 0` with `endDate = startDate`. |
| Calendar | 7-day calendar. Every day counts. |
| FS | successor starts ≥ predecessor finish + lag (the next day when lag is 0) |
| SS | successor starts ≥ predecessor start + lag |
| FF | successor finishes ≥ predecessor finish + lag |
| SF | successor finishes ≥ predecessor start + lag |
| Lag | Any integer number of days. A negative lag is a lead. |
| Stored start | Treated as "start no earlier than". When a predecessor slips, successors are pushed later. A successor you deliberately placed later keeps its date. |
| `SCHEDULE_MODE=asap` | Tasks that have predecessors are pulled back to their earliest feasible date, except the task being edited. |
| Critical | `totalFloat <= 0`. Float is late start minus early start, measured against the project finish. |
| Summary tasks | A summary's dates span its subtasks, and its progress is the duration-weighted average of theirs. A dependency on a summary uses the rolled-up dates. A summary's own predecessors are inherited by every subtask. |
| Cycles | Dependency loops and parent loops (including a subtask that depends on its own parent) raise `CycleError`, which names the loop. The API returns this as HTTP 409. |

Every write runs inside one Firestore transaction. It reads all tasks, applies the change,
reschedules, then writes only the changed documents and deletes the removed ones. A cascade
therefore never lands half-written. One change can touch at most 500 documents, which is
Firestore's per-transaction limit.

## Local development

```bash
npm install
cp .env.example .env.local
```

The quickest way to run with no GCP account is to put this in `.env.local`:

```
DATA_BACKEND=memory      # seeded demo schedule, not persisted
AUTH_DEV_BYPASS=true     # treat every visitor as admin (ignored in production)
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=anything-for-local
```

```bash
npm run dev        # http://localhost:3000
npm test           # scheduling engine unit tests
npm run typecheck
```

To use real Firestore locally, set `DATA_BACKEND=firestore` and `GOOGLE_CLOUD_PROJECT`, then run
`gcloud auth application-default login`. Alternatively, set `FIRESTORE_EMULATOR_HOST`.

## Authentication

1. In Google Cloud Console, go to **APIs & Services → Credentials** and create an OAuth client ID
   of type *Web application*.
2. Add this authorised redirect URI: `https://<your-service-url>/api/auth/callback/google`.
   For local work also add `http://localhost:3000/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `NEXTAUTH_SECRET`.
4. Choose admins with `ADMIN_EMAILS=a@x.com,b@x.com` and/or `ADMIN_EMAIL_DOMAIN=x.com`.

Any Google account with a verified email can sign in, but only allowlisted emails can write.
The allowlist is checked on every request, so removing an email revokes access immediately.
Mutating requests must be JSON and same-origin.

## Deploying to Cloud Run

Prerequisites: a working `gcloud` CLI (`gcloud --version` must succeed), `gcloud auth login`,
and a Google OAuth client (see Authentication). Docker is **not** needed locally, because the image
is built by Cloud Build.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -ProjectId my-project -AdminEmails "you@example.com"
```

bash / Git Bash / Cloud Shell:

```bash
PROJECT_ID=my-project ADMIN_EMAILS=you@example.com ./deploy.sh
```

On the first run, the script creates any missing secrets. It generates `nextauth-secret` and
prompts you for the OAuth client ID and secret. It also creates the Firestore database if it
doesn't exist yet (`FIRESTORE_LOCATION`, default `nam5`). `.gcloudignore` keeps `.env*`,
`node_modules` and `.next` out of the upload.

Both scripts then:

- enable the required APIs
- creates an Artifact Registry repo and a runtime service account that has only `roles/datastore.user` and access to the secrets
- builds the image with Cloud Build (the build fails if the unit tests fail)
- deploys with these settings: 512Mi memory, 1 vCPU, concurrency 80, 0–10 instances, startup CPU boost, `--allow-unauthenticated` (public read)

After the first deploy, it sets `NEXTAUTH_URL` to the service URL and prints the OAuth redirect URI to register.
If you use a custom domain, pass `NEXTAUTH_URL=https://schedule.example.com`.

Firestore rules (optional) are applied with `firebase deploy --only firestore:rules`.
The server uses IAM through its service account, so it bypasses these rules. They govern any
direct client-SDK access. In the rules, an admin has a verified email plus either the custom
claim `admin: true` or a document at `/admins/{email}`.

## Extension points

- `venueId` and `assignedPersonnelIds` are already stored and validated. Add `venues`
  and `personnel` collections, then show them in the form and filters.
- Working-day calendars: replace the arithmetic in `lib/scheduling/dates.ts` with a
  calendar-aware version. The engine itself only works on day numbers.
- Multiple projects: put a `projectId` on each task and scope the repository queries
  by it. The engine needs no changes.
