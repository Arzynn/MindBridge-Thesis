# MindBridge architecture

This describes the architecture present in the current source. It distinguishes
implemented code from configuration-dependent or incomplete behavior.

## Main components

### Frontend

`frontend/` contains the maintained HTML pages, shared CSS, and browser
JavaScript:

- `frontend/student/` contains student login/registration, chatbot, dashboard,
  screening, profile, progress, and resources pages.
- `frontend/counselor/` contains counselor login/registration, portal, and AI
  review pages.
- `frontend/js/ui.js` wires page interactions to server functions.
- `frontend/index.html` is a local redirect page; the Apps Script web app uses
  its own generated `Index.html` template.

The browser calls server-side functions with `google.script.run`. The deployed
HTML pages are served by Apps Script; opening the source pages with `file://`
does not reproduce that runtime.

### Google Apps Script backend

`backend/` is the maintained server source. `Code.gs` implements `doGet()`
routing, page data endpoints, and web-app configuration. The remaining modules
provide authentication/session checks, student and counselor operations,
database access, guidance retrieval, risk detection, DASS-21 assessment logic,
audit logging, and Gemini draft generation.

Student and counselor sessions are held in Apps Script Cache for up to one
hour. Server endpoints check the session and required role before handling
protected operations. Student data endpoints scope queries to the authenticated
student; counselor endpoints currently grant authenticated counselors access
to the shared records exposed by the portal.

### Generated Apps Script project

`apps-script/` is build output, not a second source tree. Run
`node .\\build-gas.js` from the project root. The generator:

1. Converts source frontend pages into flat Apps Script HTML files.
2. Combines shared styles and browser helpers into Apps Script include files.
3. Copies each `.gs` module from `backend/`.
4. Writes an Apps Script manifest.

The generator overwrites matching files in `apps-script/`. It does not push to
Google or deploy a web-app version. Do not edit generated files by hand; change
their source and rebuild. The generated folder is ignored by Git.

## Database

`database/schema.sql` defines PostgreSQL enums and the principal tables:

- `users` and `student_profiles` hold account and student-profile records.
- `assessments` and `assessment_answers` hold screening records and responses.
- `chat_sessions`, `chat_messages`, and `ai_responses` hold chat and staged
  drafts.
- `counselor_reviews` stores counselor decisions about AI drafts.
- `risk_flags` stores screening/chat risk notifications and review statuses.
- `approved_guidance` stores approved content used as retrieval context.
- `audit_logs` stores application audit events.

Foreign keys connect profiles to users, assessments and sessions to student
profiles, answers to assessments, messages and AI responses to chat sessions,
and reviews to AI responses. `database/policies.sql` enables RLS and defines
policies; `database/service_role_grants.sql` grants the backend role the
required table and sequence permissions. The DASS-21 migration adds screening
review fields and supporting constraints/indexes.

The Apps Script backend accesses Supabase through its REST API using
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` Script Properties. This key
bypasses RLS, so RLS is not an independent end-user authorization boundary for
these backend requests; server-side session and role checks are essential.
The schema, policies, and grants should only be applied to an approved test or
production project following the setup instructions.

## Data flows

### Sign-in and protected pages

The browser submits credentials using `google.script.run`. The backend checks
the account, validates the password and role, then stores a session payload in
Apps Script Cache. Subsequent protected calls include the session token and
verify it server-side before returning student or counselor data.

### Student chat and counselor review

The backend validates message length and scope, checks ownership of the chat
session, and saves the student's message. Risk detection may add a pending
counselor risk flag and show configured support contacts. Otherwise, approved
guidance may be retrieved and the message is sent to Gemini for a draft. The
draft is stored as pending in `ai_responses`; it is not directly shown to the
student. A counselor reviews or edits it, and the approved counselor response
is then saved to the conversation.

If AI generation is unavailable, the message can be queued for counselor
review without an automated draft. The database operations span multiple REST
requests and are not one transaction; partial-failure cases are surfaced in
the application.

### DASS-21 screening

The student submission endpoint requires all 21 integer answers and explicit
consent. It refuses submissions until institution-approved consent and the
review-policy approval Script Property are present. The backend calculates
three separate subscale scores, stores responses, and may create a counselor
risk flag. Students see participation history rather than score details;
counselors can review the subscales and status. This is not a diagnosis or a
suicide-risk assessment.

## AI integration

`backend/AIService.gs` calls the Google Gemini API using the
`GEMINI_API_KEY` Script Property and the model configured in `backend/Code.gs`.
No OpenRouter integration was found in the current source. Student chat text
and retrieved approved guidance are sent to Gemini for a counselor-reviewed
draft. Do not send real wellness information until privacy, consent, data
minimization, and provider retention requirements have been reviewed.

## Deployment

1. Configure Supabase and Apps Script Script Properties as documented in
   `setup.md`.
2. Run `node .\\build-gas.js` from the project root.
3. Upload the flat contents of `apps-script/` manually or configure `clasp`
   using a private `.clasp.json` based on `.clasp.json.example`.
4. Review the manifest and access settings, test using synthetic data, then
   explicitly deploy a web-app version through Apps Script.

The current generated manifest sets `webapp.access` to `ANYONE_ANONYMOUS`.
This is a security setting to review before any real student data is used.
Building does not change a live deployment.

## Incomplete or configuration-dependent behavior

- Counselor registration is a static prototype; it does not provision accounts.
- DASS-21 is gated pending approved consent text and review policy settings.
- Counselor access is institution-wide; there is no counselor/student
  assignment model.
- Crisis contacts are configured values and must be verified with the
  institution.
- The app does not provide an emergency-response service, and login rate
  limiting is not implemented.
- Local unit tests do not validate Apps Script, Supabase, Gemini, or deployed
  browser behavior.

## Security review items

These are current conditions to review before production use; this
organization change does not alter authentication, database permissions, AI
provider configuration, access rules, or live deployment settings:

- The manifest permits anonymous web-app access, while setup guidance calls
  for restricting access.
- Password storage uses a single salted SHA-256 hash and accepts legacy
  plaintext password records.
- The Supabase service-role key bypasses RLS and must remain server-side.
- Student chat content is sent to Gemini for draft generation.
- Login rate limiting is absent.
- Any authenticated counselor can access the shared counselor data exposed by
  the current endpoints.
- Institutional consent, crisis-response procedures, and configured crisis
  contacts require verification.
