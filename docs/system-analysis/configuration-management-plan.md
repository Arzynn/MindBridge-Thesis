# Configuration Management Plan

## 1. Purpose and status

This plan describes how to manage the MindBridge source, generated Apps Script
project, database SQL, documentation, configuration, tests, and releases.

**Current verified status:** the project archive reviewed for this revision
contained no `.git` directory (an earlier review of the project folder reached
the same result). A zip archive may omit hidden folders, so confirm on the
original folder before treating this as final. No Git repository, branch, remote, or commit history
was available to verify. This document recommends a workflow; it does not
initialize Git, create a remote, publish, deploy, or apply migrations.

### Evidence limits of this revision

The archive reviewed for this revision contained `backend/`, `frontend/`,
`database/`, and the generated `apps-script/` only. It did **not** contain
`build-gas.js`, `tests/`, `docs/`, `.gitignore`, `.env.example`, or
`.clasp.json.example`. Statements below about those files (sections 2, 5, 6, and
the closing traceability list) were carried forward from the earlier revision and
are **not re-verified**; confirm them in the original folder before relying on
them.

## 2. Configuration items and ownership

| Configuration item | Authoritative location | Change rule |
| --- | --- | --- |
| Apps Script server source | `backend/*.gs` | Edit and review here; do not independently maintain generated copies |
| Frontend source | `frontend/` | Edit source pages, CSS, and JS here |
| Generated Apps Script deployment package | `apps-script/` | Regenerate using `build-gas.js`; don't manually edit generated files |
| Build generator | `build-gas.js` | Review path/output changes carefully; it writes into `apps-script/` |
| Database schema | `database/schema.sql` | Treat initial schema edits as controlled DB changes |
| Subsequent database changes | `database/migrations/*.sql` | Add ordered, reviewed migrations; do not silently rewrite applied history |
| RLS policies and role grants | `database/policies.sql`, `database/service_role_grants.sql` | Review security and permissions before applying |
| Tests | `tests/` | Update/add tests alongside behavior changes |
| Project docs | `README.md`, `docs/` | Keep verified implementation and setup information current |
| Local Apps Script project ID | `.clasp.json` | Local-only; ignored by Git; do not commit real project binding |
| Backend secrets | Apps Script Script Properties | Never store in repository, generated client files, or browser storage |
| Environment examples | `.env.example`, `.clasp.json.example` | Placeholders only; update only when actual configuration names/shape change (not present in the reviewed archive) |
| Apps Script manifest | `apps-script/appsscript.json` (generated; its source is not visible without `build-gas.js`) | Review before every release; it sets time zone `Asia/Singapore`, `executeAs: USER_DEPLOYING`, and `access: ANYONE_ANONYMOUS`. Identify where it is generated so it is edited in one place only |

`apps-script/` is currently excluded by `.gitignore` to avoid duplicate,
independently edited backend files. Rebuild it before upload/`clasp push`.
Whether deployment output should be versioned is a team policy decision; this
plan follows the current generated-output exclusion.

## 3. Recommended Git initialization and collaboration

Because the current directory has no Git metadata:

1. Confirm the project root is `MindBridge/`.
2. Review files staged for tracking, especially `.gitignore` exclusions and
   local credentials/configuration.
3. Initialize a repository only when the project owner approves.
4. Use a protected `main` branch and short-lived feature branches, such as
   `docs/erd`, `feature/chat-review`, or `fix/session-validation`.
5. Make focused commits with clear messages. Review the diff before committing.
6. Use pull-request review for changes to authorization, screening, RLS,
   migrations, secrets/configuration, or deployment behavior.
7. Do not include live student data, Script Properties, `.clasp.json`, `.env`,
   archives, or generated runtime output unless a future explicit policy
   requires a sanitized deployable artifact.

No remote URL or branching policy is currently configured; select one with the
project owner before setting up a hosting service.

## 4. Change control

For each change:

1. Identify affected source modules, frontend pages, SQL, build output, tests,
   and documentation.
2. Record intended behavior and affected data/configuration.
3. Make a minimal source change in the authoritative directory.
4. Update tests and related docs.
5. Review `git diff`/`git status` and ensure no secrets or personal data are
   included (after Git has been initialized).
6. Run the focused tests and static checks.
7. Rebuild Apps Script output when frontend/backend source changes.
8. Check the generated output, routed page/include names, and required files.
9. Require a second-person review for security, consent, permissions, migration,
   or production-release changes.

Do not consider generated output an independent change to implement manually.
If output differs unexpectedly, stop and diagnose the source/build rather than
patching the generated directory.

## 5. Build and verification

From the project root:

```powershell
node .\build-gas.js
node --test tests\dass21.test.js
```

The build overwrites/generated files in `apps-script/`. Before running it in an
environment where the generated output has important local changes, preserve
those changes or verify they can be regenerated. The generator does not deploy
to Apps Script.

The DASS-21 test file validates selected scoring, answer validation,
submission gating/duplicate behavior, and status transitions. It does not
verify live Apps Script services, Supabase permissions/schema state, Gemini,
browser compatibility, or production deployment.

## 6. Secrets and configuration management

- Store these as Apps Script Script Properties (all five names verified in
  `backend/`):

  | Property | Read by | Effect when missing |
  | --- | --- | --- |
  | `SUPABASE_URL` | `Database.gs` | Every database call throws "Missing required Apps Script property" |
  | `SUPABASE_SERVICE_ROLE_KEY` | `Database.gs` | Same as above |
  | `GEMINI_API_KEY` | `AIService.gs` | Draft is skipped; the message is queued for manual counselor reply (`AI_UNAVAILABLE`) |
  | `DASS21_CONSENT_TEXT` | `Assessment.gs`, `Code.gs` | DASS-21 submission stays disabled |
  | `DASS21_REVIEW_POLICY_APPROVED` (must be the text `true`) | `Assessment.gs`, `Code.gs` | DASS-21 submission stays disabled |

  The Gemini model name, output limit, and crisis-contact text are **not**
  Script Properties: they are constants in `backend/Code.gs` (`CONFIG`) and change
  only through a reviewed source change.
- The Apps Script project time zone (manifest) drives the rolling-window and
  weekly report calculations through `Session.getScriptTimeZone()`; changing it
  changes report bucketing.
- `.env.example` documents property names but the current code does not load a
  local `.env`.
- Copy `.clasp.json.example` to local `.clasp.json` only when configuring
  `clasp`; use a private project identifier and keep the real file ignored.
- Never paste a service-role key or AI key into frontend source, `appsscript`
  manifest, this documentation, a commit, logs, or a public issue.
- Rotate credentials through the service owner if exposure is suspected;
  changing the repository alone does not revoke a leaked credential.
- Use distinct test and production projects/keys. Do not put synthetic test
  credentials in tracked templates.

## 7. Database schema and migrations

- Keep schema changes in reviewed SQL. Use additive, ordered migration files for
  changes to an already initialized database.
- Record prerequisites, effects, rollback limitations, and data-loss risk in
  each migration's review or release notes.
- Test on a non-production Supabase project with synthetic data.
- Back up production data and obtain explicit database-owner approval before
  applying any migration.
- Verify constraints, indexes, RLS behavior, grants, and application queries
  after migration.
- `database/schema.sql` already contains the DASS-21 columns, the `priority` and
  `assessment_id` risk-flag columns, and their indexes. The migration
  `20261004_dass21_screening.sql` is therefore needed only for a database created
  from an older schema. Recommended order for a new project: `schema.sql`,
  `policies.sql`, `service_role_grants.sql`. Record which of these has been
  applied to each Supabase project.
- The base schema and policies are not documented as safe for blind reruns.
  The DASS-21 migration is written with `IF NOT EXISTS`/constraint checks, but
  must still be reviewed and applied deliberately.
- `service_role_grants.sql` grants privileged table/sequence access; review it
  separately from RLS policies.

This plan does not run SQL or verify a deployed Supabase database.

## 8. Release and deployment

1. Confirm required approvals, tests, database migration status, and access
   controls.
2. Build generated files from the approved source revision.
3. Inspect generated `apps-script/` contents and Apps Script manifest.
4. Confirm required Script Properties are configured in the intended Apps
   Script project, without placing values in source control.
5. Upload manually or `clasp push` to a test project first.
6. Test with synthetic accounts and records in the deployed test web app.
7. Obtain release approval before deploying a production web-app version.
8. Record source revision, migration set, test result, project/environment,
   release date, and operator in a controlled release record without recording
   secret values.
9. Verify the released URL and server logs without exposing student data.

The generated manifest currently specifies anonymous web-app access
(`ANYONE_ANONYMOUS`) and execution as the deploying user (`USER_DEPLOYING`).
Because the backend authorizes through its own cached session token and uses a
privileged service-role key, any deployment-setting change needs owner review. Treat
access level as a release gate for real student records. Do not deploy solely
because the build completes.

## 9. Rollback and backups

- Keep a known-good source revision and backup of the Apps Script project before
  deployment updates.
- For application rollback, redeploy the last known-good Apps Script version
  when supported by the chosen deployment process.
- Database rollback is migration-specific. Prefer a reviewed forward-fix when
  reversing could lose or corrupt data; restore from a verified backup only
  under database-owner approval.
- Back up Supabase according to the project plan and verify restore procedures.
- Preserve approved SQL migration history and release notes.
- Do not rely on stale workspace ZIP archives as the only source backup.

## 10. Roles and approvals

Roles must be assigned by the project owner/institution; the table is a
recommended responsibility model, not a current access-control configuration.

| Activity | Responsible reviewer |
| --- | --- |
| Frontend/backend source change | Developer and peer reviewer |
| Screening content/scoring/consent | Licensed counselor and research/institutional approver |
| Supabase schema/RLS/grants | Database owner and security reviewer |
| Credential/Script Property changes | Apps Script project owner |
| Production deployment | Authorized deployment owner |
| Documentation updates | Change author and project reviewer |

## 11. Open decisions

- Whether a private GitHub repository will be used and who owns it.
- Branch protection and required review policy.
- Whether generated deployment output remains ignored or is published as a
  release artifact.
- Who approves production access settings, student-data processing, consent,
  crisis contacts, and counselor access scope.
- Backup/restore objectives and who is authorized to execute recovery.

## Traceability

Verified project controls: `.gitignore`, `.clasp.json.example`,
`.env.example`, `build-gas.js`, `backend/Code.gs`, `backend/Database.gs`,
`database/schema.sql`, `database/policies.sql`,
`database/service_role_grants.sql`, the DASS-21 migration, and
`docs/setup.md`/`docs/testing.md`.

The project was not a Git repository during this inspection. Recommendations in
this plan do not indicate that Git, remote hosting, branch protections,
backups, or production release controls are already configured.
