# Verification Report

Purpose: record what was checked against source, what was corrected in this
revision, and what remains unresolved. Status values: **Fixed** (documentation
corrected), **Source finding** (a property of the code, documented but not
changed), **Open** (needs a decision or more evidence).

## 1. Findings

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| F-01 | Level 2 DFD node numbers (2.4.x, 2.5.x, 2.6.x) did not match Level 1 process numbers (P4, P5, P6) | `dfd.md` | Fixed: renumbered 4.x, 5.x, 6.x; added a process-to-function map |
| F-02 | Level 1 showed `P7` reading `chat_sessions` and `chat_messages` and implied counselor read audits; the P7 functions read neither store and write no audit events. Audit flows from registration and DASS-21 were missing | `Code.gs` counselor functions; `Student.gs`; `Assessment.gs` | Fixed |
| F-03 | `verifyPassword_` returns true when the stored value equals the typed password (plain-text compare) in addition to the `sha256$salt$hash` format. Documentation described the field generically | `Auth.gs: verifyPassword_`; `Student.gs: hashStudentPassword_` | Source finding; documented. Recommend migrating any plain-text rows and removing the branch |
| F-04 | `Database.gs` sends `app.current_user_id` / `app.current_user_role` as HTTP headers. `policies.sql` reads PostgreSQL settings with the same names. No evidence the headers set those settings, and the service-role key bypasses RLS | `Database.gs: getHeaders`; `policies.sql` | Source finding; documented as unverified. Application authorization relies on `getAuthenticatedUser_` |
| F-05 | Earlier text said routine DASS-21 results become `POLICY_PENDING`. In code `priority` is `ROUTINE` (truthy) and submission is already gated on approval, so every review-requiring result becomes `PENDING`; `POLICY_PENDING` is unreachable | `Assessment.gs: calculateDASS21, submitDASS21_` | Fixed in Structured English and pseudocode |
| F-06 | A counselor-approved reply or SYSTEM notice is inserted into `chat_messages`, but no backend function returns `chat_messages` to a student, and the chat page shows only locally typed text and status messages | `grep chat_messages backend/`; `frontend/student/chatbot.html` | Source finding; added to DFD, structure chart, HIPO |
| F-07 | Counselor registration page only displays an informational message; no endpoint exists | `frontend/counselor/register.html` | Documented (already noted earlier) |
| F-08 | Unreferenced code: `RiskDetection.checkAssessment` (PHQ-9/GAD-7), `Assessment.submitAssessment`, `CONFIG.RISK_THRESHOLD_CONFIG`, and the `reviewRequiredAbove` / `priorityAtOrAbove` policy keys; `checkSupabaseConnection` is manual-run only | grep across `backend/`, `frontend/` | Documented in structure chart and data dictionary |
| F-09 | Enum values with no write path (`ADMIN`, `INACTIVE`, `SUSPENDED`, `RESOLVED`, sender `AI`, `PHQ9`, `GAD7`, `PSS10`, `PHQ9_ITEM9`, `DRAFT`, `DEACTIVATED`); no code writes `approved_guidance` | `database/schema.sql` vs `backend/` | Documented in data dictionary |
| F-10 | Registration inserts the user, then the profile; a profile failure leaves an account without a profile, and the audit insert result is ignored. Counselor and DASS flows make several non-transactional requests with documented partial-failure messages | `Student.gs`, `Counselor.gs`, `Assessment.gs`, `AuditLog.gs` | Source finding; documented |
| F-11 | Gemini model name is the string `gemini-1.5-flash` in `CONFIG`. Whether that model is currently offered was not verified | `Code.gs`, `AIService.gs` | Open: check Google's current model list |
| F-12 | Manifest sets `ANYONE_ANONYMOUS` and `USER_DEPLOYING`; the manifest's source file is unknown without `build-gas.js` | `apps-script/appsscript.json` | Open: release gate in the configuration plan |
| F-13 | The archive omitted `build-gas.js`, `tests/`, `docs/`, `.gitignore`, and templates | archive listing | Open: statements about them are carried forward and labeled |
| F-14 | `getPendingRiskFlags` (chat flags only, `session_id` not null) and `getCounselorRiskFlags` (all flags) overlap; the review page and the portal use different ones | `Counselor.gs`, `Code.gs`, `ai-reviews.html`, `ui.js` | Documented; confirm intent |

## 2. What was checked and agreed

- Every table, column, type, default, key, CHECK, and index in the data
  dictionary and ERD matches `schema.sql` and the migration. The migration's
  additions are already part of `schema.sql`.
- Enum names and values, relationship cardinalities, and `ON DELETE` rules in
  the ERD match the SQL.
- Function names, inputs, validations, role checks, state transitions, and
  failure messages in HIPO, Structured English, and pseudocode match the
  `backend/*.gs` code, with corrections listed above.
- Browser-to-server calls were matched by function name to `frontend/` pages.
  The 21 public functions the pages call all exist in `backend/`.

## 3. Open questions for the project owner

1. Should students see counselor replies, and where? (F-06)
2. Do any `users.password_hash` rows still contain plain text? (F-03)
3. Is the anonymous web-app setting intended for real student data? (F-12)
4. Is the Gemini model name still valid, and where is the manifest generated? (F-11, F-12)
5. Please supply `build-gas.js`, `tests/`, `docs/`, and `.gitignore` to finish
   verifying the build, test, and Git statements. (F-13)

## 4. Limits

This review read source and SQL only. Nothing was executed, deployed, migrated,
or connected to a live Apps Script, Supabase, or Gemini project. No credentials,
tokens, or student data appear in these documents.
