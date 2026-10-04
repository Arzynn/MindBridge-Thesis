# MindBridge

MindBridge is a student mental-wellness support and counselor decision-support
prototype. It provides student and counselor pages, a student chat workflow,
counselor review queues, and a gated DASS-21 screening workflow. It is not a
diagnostic tool or an emergency service.

## Technologies

- Frontend: HTML, CSS, and browser JavaScript
- Backend and web app: Google Apps Script (JavaScript / `.gs`)
- Database: Supabase (PostgreSQL and its REST API)
- AI draft integration: Google Gemini
- Build: Node.js using the built-in file-system APIs

The current code uses Gemini, not OpenRouter. No frontend framework or
third-party Node package is required for the current build or unit tests.

## Folder layout

```text
MindBridge/
├── backend/       Maintained Apps Script server source
├── frontend/      Maintained HTML, CSS, and browser JavaScript source
├── apps-script/   Generated flat deployment files; do not edit by hand
├── database/      Supabase schema, policies, grants, and migrations
├── docs/          Setup, testing, and architecture documentation
├── tests/         Node.js unit tests
├── build-gas.js   Generates apps-script/ from backend/ and frontend/
├── .clasp.json.example
└── .env.example
```

`backend/` and `frontend/` are the source of truth. `apps-script/` is generated
by the build and is excluded from Git to avoid maintaining a second editable
copy. Run the build before uploading or pushing files with `clasp`.

## Prerequisites

- Node.js with the built-in `node --test` test runner
- A Supabase project for database-backed operation
- A Google Apps Script project for deployment
- Optional: the `clasp` command-line tool for synchronizing deployment files

No `npm install` step is needed for the current project.

## Local setup

1. Open this `MindBridge/` folder as the project root in VS Code.
2. Review `docs/setup.md` and `docs/testing.md`.
3. Configure server-only values as Google Apps Script Script Properties; do
   not put secrets in frontend files or source control. `.env.example` is only
   a reference for property names—the application does not read a local `.env`
   file.
4. Follow the Supabase setup below, using a test project and synthetic data.

## Supabase setup

In the Supabase SQL editor, review and apply `database/schema.sql` and
`database/policies.sql` to a new project, then apply
`database/service_role_grants.sql`. The base schema and policy scripts are not
safe to rerun blindly. Apply the DASS-21 migration only after reviewing the
gating, approval, and setup requirements in `docs/setup.md`.

The backend connects through Supabase REST. It requires the `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` Script Properties. The service-role key is
privileged and bypasses Row Level Security (RLS); keep it server-side and
preserve the backend's session and role checks.

## Google Apps Script setup and build

Set the required Apps Script Script Properties as described in
`docs/setup.md`. Run this command from the project root to regenerate the flat
deployment files:

```powershell
node .\build-gas.js
```

The generator writes to `apps-script/`, replacing files there. It does not
deploy or publish the application. Before deployment, review the manifest and
restrict access appropriately; the current manifest specifies
`ANYONE_ANONYMOUS`. To use `clasp`, copy `.clasp.json.example` to
`.clasp.json`, replace its placeholder with your own Apps Script project ID,
and keep the real configuration out of Git. See `docs/setup.md` for manual
upload and deployment steps.

## Tests

Run the available DASS-21 unit tests from the project root:

```powershell
node --test tests\dass21.test.js
```

These tests cover scoring, validation, the gated submission path, and review
status transitions. They do not test a live Apps Script deployment, Supabase
project, Gemini request, or browser rendering.

## Security and privacy notes

- Do not use real student records until institutional privacy, consent,
  counselor access, and emergency-response requirements have been reviewed.
- The Apps Script manifest currently permits anonymous web-app access. Restrict
  deployment access before handling real student data; this organization task
  does not change the live deployment or manifest setting.
- Passwords are stored using a single salted SHA-256 hash, and login accepts
  legacy plaintext password records. This is not suitable for production;
  migrate to an approved managed identity or modern password-hashing solution.
- The Supabase service-role key bypasses RLS. Keep it in Apps Script Script
  Properties, never in this repository or browser code.
- Student chat text and approved guidance are sent to the configured Gemini
  API for draft generation. Review institutional approval, consent, data
  minimization, and provider retention terms before enabling this with real
  data.
- Login rate limiting is not implemented. Counselor endpoints currently permit
  any authenticated counselor to access the shared student records; there is
  no counselor-to-student assignment restriction.
- Confirm the crisis contact information in `backend/Code.gs` with the
  institution before use. The application is not an emergency-response
  service.
- DASS-21 submissions remain gated until approved consent text and the review
  policy setting are configured. The instrument, thresholds, and policy need
  the approvals described in `docs/setup.md`.

See `docs/architecture.md` for the verified data flow and feature boundaries.

Leader: Tabelon, Allondra Mae
Members: Gayo, John Carlo M.
         Basco, Ana Leah
         Hidalgo, Mark Daryl
         Villanueva, Aldrin