# MindBridge deployment setup

## Project layout

The existing app is a plain HTML/CSS/JavaScript frontend and a Google Apps
Script server using Supabase REST plus the Gemini API. Its Supabase schema and
RLS SQL remain in `database/`; the source frontend and server remain in
`frontend/` and `backend/`. Run `node build-gas.js` from the `MindBridge`
directory to generate the flat, deployable Apps Script project in
`apps-script/`. The generator keeps the original frontend pages and styles and
emits one HTML file per page. `apps-script/` is generated output; make source
changes in `frontend/` or `backend/`, then rebuild.

## Configure private service credentials

The credentials were removed from the source files, but you can keep using the
same existing values. No new keys are required for this migration. Copy the
existing values from your private records into Apps Script Script Properties;
do not revoke or replace them if you intend to retain them.

In the Apps Script editor, open **Project Settings → Script Properties** and add:

| Property | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your existing Supabase secret key (`sb_secret_...`) or legacy `service_role` JWT |
| `GEMINI_API_KEY` | Your existing Gemini API key |

Do not put these values in HTML, JavaScript, source control, or deployment
metadata. The existing values were previously present in the server source, so
keeping them active is your choice and carries risk if anyone else can access
that source or the Apps Script project. The Supabase key is privileged and
bypasses RLS; server entry points must continue validating the Apps Script
session token and role before database operations.

For a modern Supabase key beginning `sb_secret_`, enter that exact value:
Apps Script sends it as the `apikey` header and does not send it as a Bearer
JWT. Legacy `service_role` keys are JWTs and are sent in both headers.

## Set up Supabase

Run `database/schema.sql` and `database/policies.sql` in the Supabase SQL editor.
Then run `database/service_role_grants.sql` to grant the backend's
`service_role` database role the CRUD permissions required by the Apps Script
operations. These grants do not expose permissions to `anon` or
`authenticated`; the service-role key itself is privileged and bypasses RLS.
If the schema and policies have already been applied, run only this grants
script; do not rerun the non-idempotent schema and policy scripts.
Review and test the policies before using real student records. The current
Apps Script backend accesses Supabase with a service-role key, so Postgres RLS
does not independently enforce the end-user identity for these requests; the
Apps Script session checks are an important part of the authorization boundary.

## Create and deploy the Apps Script project

1. From the `MindBridge` project root, generate or refresh the deployment
   source: `node build-gas.js`. The parent workspace's `build.js` is a separate
   archive helper, not part of this project root or required for deployment;
   its ZIP outputs can become stale and should not be treated as source.
2. Create a new standalone Apps Script project.
3. In Apps Script, create/upload every file directly inside `apps-script/`.
   Apps Script file names are flat; retain names such as `Code.gs`,
   `Index.html`, `Styles.html`, `JavaScript.html`, `StudentLogin.html`, and
   `CounselorReviews.html` exactly. Include all `.gs` files and `appsscript.json`.
4. Configure the three Script Properties above, using your existing credential
   values if you are retaining them.
5. Run `checkSupabaseConnection` from the editor to verify the database URL and
   key. On first use, review and authorize the external-request permission.
6. Choose **Deploy → New deployment → Web app**. Prefer **Execute as me** (the
   controlled project owner) so server-side Script Properties are available
   consistently, and restrict **Who has access** to institution-managed
   accounts or a narrower approved audience. Never select public/anonymous
   access for real student records. Review the existing deployment settings
   before publishing a new version.
7. Deploy, test the `/exec` URL with a test account, and use **Deploy → Manage
   deployments** to publish subsequent versions.

## DASS-21 activation

The source now includes the 21 item statements supplied for this project,
server-side scoring, counselor review statuses, and a seven-day rolling
duplicate-submission guard. The supplied instrument version and permission to
use it have not been independently verified; confirm those with the research
adviser before collecting responses.

Before syncing or deploying this feature:

1. In Supabase SQL Editor, run
   `database/migrations/20261004_dass21_screening.sql`. It is additive and
   idempotent; do not rerun the original non-idempotent schema SQL. The
   assessment and risk-flag queries in this version require the migration.
2. Obtain licensed-counselor and research-adviser approval of the configured
   severity bands and review-routing policy in `backend/Code.gs`.
3. Obtain the institution-approved participant-information/consent wording.
   It must describe the purpose, data access, non-diagnostic nature, and how
   students can reach human support. The consent is intentionally not
   invented or embedded in source.
4. Only after those approvals, add Apps Script Script Properties:
   - `DASS21_CONSENT_TEXT`: the exact approved consent text.
   - `DASS21_REVIEW_POLICY_APPROVED`: `true` only after both approvers have
     reviewed the rules above.

Until both settings are present and approved, DASS-21 submissions remain
disabled. Students are not shown scores, severity bands, or counselor review
status. Their history displays participation dates only. The server derives all
scores from exactly 21 integer answers in the range 0–3, stores independent
subscale results, and allows one submission per rolling seven days. Normal
bands generate no review flag; Mild/Moderate subscales enter routine review;
Severe/Extremely Severe subscales enter priority review. DASS-21 is not used to
assess suicide risk or immediate safety.

Counselor review and queue notifications are stored in the existing
`assessments` and `risk_flags` tables. This is an in-app queue, not email/SMS
delivery. Review statuses record reviewed-by and reviewed-at; follow-up notes
and appointment scheduling are not implemented. Database writes span multiple
REST requests and are not transactional; monitor the explicit partial-failure
messages and do not retry a submission after a partial-save warning.

To test the Supabase connection without reading student rows, run
`checkSupabaseConnection` from the Apps Script editor's function selector. A
successful result reports HTTP 200; failures report the HTTP status and a
sanitized Supabase error code/message without printing credentials or response
details.

The app uses `google.script.run` for browser-to-server calls and external
`UrlFetchApp` requests to Supabase and Gemini. UI routing uses the `page` query
parameter (`login`, `register`, `student-dashboard`, `screening`, `progress`,
`chatbot`, `resources`, `profile`, `counselor_login`, `counselor`,
`counselor-students`, `counselor-student`, `counselor-screenings`,
`counselor-risks`, `counselor-reviews`, `counselor-followups`,
`counselor-reports`, `counselor-resources`, `counselor-profile`,
`counselor-settings`, and `counselor-register`). Navigation and the HtmlService
template includes must be tested from the deployed URL; local `file://`
browsing is not a supported runtime.

## Optional clasp workflow

From the `MindBridge` project root, install `clasp` if needed and authenticate.
Copy `.clasp.json.example` to `.clasp.json`, replace the placeholder project ID
with your own private Apps Script project ID, and keep `.clasp.json` out of
source control. Build first so `apps-script/` contains the latest output. Then
push the generated files:

```text
clasp login
clasp push
```

If you need a new standalone project, create it explicitly before configuring
the private `.clasp.json`. Set Script Properties in the Apps Script project
settings (for example, with `clasp create --type standalone --title MindBridge`
after `clasp login`). Deployment still requires an explicit **Deploy → New deployment →
Web app** action (or an explicit `clasp deploy`); the build script does not
publish anything. The current generated manifest allows anonymous access;
review and restrict access before using real student records.

## Current feature boundaries

- Student login/registration, the student chat, counselor login, and the AI
  review queue are implemented in the current source.
- Counselor registration is only a static prototype. Its previous browser-side
  behavior stored the submitted password in local storage and did not create an
  account; that behavior is removed. Provision counselor accounts through a
  separately approved administrative process until a trusted enrollment flow
  exists.
- The student portal now includes dashboard, progress/history, resources,
  profile, screening-availability, and chatbot routes. Portal data endpoints
  authenticate the session on the server and scope assessment queries to the
  authenticated student's profile. The counselor review page also exposes a
  counselor-only pending risk-flag queue.
- DASS-21 is the sole enabled screening submission path. Its scoring and
  review workflow are implemented but gated until approved consent and
  counselor/research policy settings are configured. Apply the additive SQL
  migration first. Students see only participation history; counselors see
  separate subscale scores, severity bands, priority, and review status.
- The counselor portal uses counselor-session checks on data endpoints and
  includes dashboard counts, searchable student records, student detail,
  stored screening records/answers, risk status management, follow-up status
  views, aggregate counts, approved resources, and read-only profile/settings.
  The AI review queue now resolves a queued item through its `message_id`
  foreign key rather than attempting an unrelated nested chat-message
  relationship.
- The current schema does not provide per-assessment review status, an
  appointment scheduler, private counselor notes, or a notifications table.
  Accordingly, screening records are read-only, follow-ups are existing
  `risk_flags` in `FOLLOW_UP` status, notifications are surfaced from existing
  pending queues, and profile/settings are read-only. Do not represent these
  as full case-management workflows.
- No counselor-to-student assignment or scope table exists. The current
  counselor authorization therefore grants every authenticated counselor
  access to the shared student records exposed by these endpoints. Confirm that
  institution-wide counselor access is authorized before using real records;
  per-counselor restrictions require an approved assignment model.
- AI failure logging records only a coarse failure code (missing
  configuration, HTTP status, unusable response, or request failure), not the
  student message or AI provider response. Check Apps Script execution logs
  and `audit_logs` to identify a cause; no single AI outage cause was verified
  without a live request.
- Weekly screening submission remains disabled because the repository has
  scoring code but no approved questionnaire text, consent, duplicate-
  submission policy, or counselor-approved score-display rules. The resource
  page uses explicit counselor-review placeholders when no approved guidance
  exists; configured support contacts must be verified by the institution.
- Login sessions are held in Apps Script cache for up to one hour. Browser
  session storage contains the bearer session token. Student navigation
  includes sign-out, and expired portal sessions return to login. Login rate
  limiting is not implemented; add abuse controls before production use.
- Student chat messages and matched approved guidance are sent to the configured
  Gemini API for draft generation. Confirm institutional approval, student
  consent, provider retention terms, and data-minimization requirements before
  sending any real wellness information.
- Existing password storage uses a single salted SHA-256 hash and still accepts
  legacy plaintext password records. That is not an appropriate production
  password scheme; migrate users to a managed identity provider/modern
  password-hashing flow before handling real accounts.
- Do not use real student wellness data until credential exposure risk, role
  permissions, institutional web-app access, applicable consent/privacy
  requirements, password-storage migration, and disaster/crisis-response
  workflow have been reviewed.
