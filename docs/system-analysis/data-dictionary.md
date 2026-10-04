# Data Dictionary

## Scope and conventions

This dictionary is derived from `database/schema.sql` plus
`database/migrations/20261004_dass21_screening.sql`. PostgreSQL types and
constraints below describe the source SQL. Supabase/PostgREST responses may
represent these values as JSON strings, numbers, booleans, or arrays.

- **PK**: primary key; **FK**: foreign key; **UQ**: unique constraint.
- Unless listed as nullable, fields have `NOT NULL`.
- `uuid_generate_v4()` and `NOW()` are database defaults.
- `assessment_id` and `priority` appear in the base schema and are also
  introduced idempotently in the migration for compatibility with older
  schemas.
- Intended meanings are taken from schema comments/constraints and application
  use. Unknown meanings are explicitly marked.

## Enumerated types

| Type | Values |
| --- | --- |
| `user_role` | `STUDENT`, `COUNSELOR`, `ADMIN` |
| `user_status` | `ACTIVE`, `INACTIVE`, `SUSPENDED` |
| `assessment_type` | `DASS21`, `PHQ9`, `GAD7`, `PSS10` |
| `chat_status` | `ACTIVE`, `WAITING_COUNSELOR`, `RESOLVED` |
| `message_sender` | `STUDENT`, `AI`, `COUNSELOR`, `SYSTEM` |
| `ai_response_status` | `PENDING`, `APPROVED`, `EDITED`, `REJECTED` |
| `review_action` | `APPROVED`, `EDITED`, `REJECTED` |
| `trigger_type` | `PHQ9_ITEM9`, `SCREENING_THRESHOLD`, `RISK_LEXICON` |
| `risk_status` | `PENDING`, `REVIEWED`, `FOLLOW_UP`, `CLOSED` |
| `guidance_status` | `DRAFT`, `APPROVED`, `DEACTIVATED` |

## Tables and columns

### `users`

Application accounts and roles.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Account identifier |
| `email` | `VARCHAR(255)` | NOT NULL | UQ | Login email |
| `password_hash` | `VARCHAR(255)` | NOT NULL | — | Credential value checked at sign-in. `registerStudent` writes `sha256$<salt>$<hex digest>`; `verifyPassword_` also accepts a stored value equal to the typed password (legacy plain-text comparison). See finding F-03 in the [verification report](verification-report.md) |
| `role` | `user_role` | NOT NULL / `STUDENT` | Enum | Account role |
| `status` | `user_status` | NOT NULL / `ACTIVE` | Enum | Account availability |
| `full_name` | `VARCHAR(255)` | NULL | — | Optional display name |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Creation time |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Last-update time; automatic updater not shown in supplied SQL |

### `student_profiles`

Student-specific attributes linked one-to-one to an account.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Profile identifier |
| `user_id` | UUID | NOT NULL | FK → `users.id`, UQ, `ON DELETE CASCADE` | Owning user account |
| `student_number` | `VARCHAR(50)` | NOT NULL | UQ | Institutional student identifier |
| `first_name` | `VARCHAR(100)` | NOT NULL | — | Student given name |
| `last_name` | `VARCHAR(100)` | NOT NULL | — | Student family name |
| `course` | `VARCHAR(255)` | NOT NULL | — | Course/program label |
| `year_level` | `SMALLINT` | NOT NULL | CHECK 1–6 | Student year level |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Creation time |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Last-update time; automatic updater not shown |

Index: `idx_student_profiles_user_id` on `user_id` (the column is already
unique).

### `assessments`

Assessment header and DASS-21 review metadata. The active submission endpoint
accepts DASS-21 only; enum values include other legacy/planned instruments.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Assessment identifier |
| `student_id` | UUID | NOT NULL | FK → `student_profiles.id`, `ON DELETE CASCADE` | Student profile that submitted |
| `type` | `assessment_type` | NOT NULL | Enum | Assessment instrument |
| `total_score` | INTEGER | NOT NULL / `0` | — | Legacy aggregate field; DASS-21 stores zero to avoid aggregate scoring |
| `severity` | `VARCHAR(50)` | NOT NULL | — | Legacy/general severity; DASS-21 stores `NOT_AGGREGATED` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Submission time |
| `depression_score` | INTEGER | NULL | CHECK null or 0–42 | DASS-21 depression standardized subscale score |
| `anxiety_score` | INTEGER | NULL | CHECK null or 0–42 | DASS-21 anxiety standardized subscale score |
| `stress_score` | INTEGER | NULL | CHECK null or 0–42 | DASS-21 stress standardized subscale score |
| `depression_severity` | `VARCHAR(30)` | NULL | — | DASS-21 depression severity band |
| `anxiety_severity` | `VARCHAR(30)` | NULL | — | DASS-21 anxiety severity band |
| `stress_severity` | `VARCHAR(30)` | NULL | — | DASS-21 stress severity band |
| `review_status` | `VARCHAR(20)` | NOT NULL / `NOT_REQUIRED` | CHECK allowed statuses | DASS-21 counselor review lifecycle |
| `reviewed_at` | `TIMESTAMPTZ` | NULL | — | Time of last recorded DASS-21 counselor status update |
| `reviewed_by` | UUID | NULL | FK → `users.id`, `ON DELETE SET NULL` | Counselor account that performed status update |

Review status values: `NOT_REQUIRED`, `POLICY_PENDING`, `PENDING`, `REVIEWED`,
`FOLLOW_UP`, `CLOSED`.

Indexes: `idx_assessments_student_id` on `student_id`; migration adds
`idx_assessments_dass_review` on `(type, review_status, created_at DESC)`.

### `assessment_answers`

Individual answer rows for an assessment.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Answer-row identifier |
| `assessment_id` | UUID | NOT NULL | FK → `assessments.id`, `ON DELETE CASCADE` | Parent assessment |
| `question_number` | INTEGER | NOT NULL | — | Instrument question number |
| `answer` | TEXT | NOT NULL | — | Submitted answer serialized as text |
| `score` | INTEGER | NOT NULL / `0` | — | Numeric answer score |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Row creation time |

No unique constraint on `(assessment_id, question_number)` is declared in the
supplied schema.

### `chat_sessions`

Conversation container and current state.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Chat session identifier |
| `student_id` | UUID | NOT NULL | FK → `student_profiles.id`, `ON DELETE CASCADE` | Session owner |
| `status` | `chat_status` | NOT NULL / `ACTIVE` | Enum | Conversation state |
| `risk_flag` | BOOLEAN | NOT NULL / `FALSE` | — | Session-level indicator set by risk path |
| `started_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Session start time |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Last-update time; automatic updater not shown |

Index: `idx_chat_sessions_student_id` on `student_id`.

### `chat_messages`

Messages associated with a chat session.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Message identifier |
| `session_id` | UUID | NOT NULL | FK → `chat_sessions.id`, `ON DELETE CASCADE` | Parent conversation |
| `sender` | `message_sender` | NOT NULL | Enum | Message origin role/type |
| `message` | TEXT | NOT NULL | — | Message body |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Message time |

Index: `idx_chat_messages_session_id` on `session_id`.

### `ai_responses`

AI draft staged for counselor review.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Draft identifier |
| `session_id` | UUID | NOT NULL | FK → `chat_sessions.id`, `ON DELETE CASCADE` | Conversation containing the draft |
| `message_id` | UUID | NULL | FK → `chat_messages.id`, `ON DELETE SET NULL` | Student message that prompted the draft |
| `ai_response` | TEXT | NOT NULL | — | Draft text; empty string used for `AI_UNAVAILABLE` queue rows |
| `model_name` | `VARCHAR(255)` | NULL | — | Configured model name or failure marker |
| `status` | `ai_response_status` | NOT NULL / `PENDING` | Enum | Review lifecycle |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Draft record time |

Indexes: `idx_ai_responses_session_id` on `session_id`;
`idx_ai_responses_status` on `status`.

### `counselor_reviews`

Counselor decision record for an AI-response queue item.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Review identifier |
| `ai_response_id` | UUID | NOT NULL | FK → `ai_responses.id`, `ON DELETE CASCADE` | Reviewed draft |
| `counselor_id` | UUID | NOT NULL | FK → `users.id`, `ON DELETE CASCADE` | Counselor making decision |
| `action` | `review_action` | NOT NULL | Enum | `APPROVED`, `EDITED`, or `REJECTED` |
| `original_response` | TEXT | NULL | — | Original AI draft at review time |
| `edited_response` | TEXT | NULL | — | Counselor-edited response where applicable |
| `review_comment` | TEXT | NULL | — | Optional review comment |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Review time |

No uniqueness constraint limits reviews per AI response in the supplied SQL.

### `risk_flags`

Pending or reviewed risk notifications from chat or screening.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Risk flag identifier |
| `student_id` | UUID | NOT NULL | FK → `student_profiles.id`, `ON DELETE CASCADE` | Student associated with flag |
| `assessment_id` | UUID | NULL | FK → `assessments.id`, `ON DELETE CASCADE` | Source assessment when screening-triggered |
| `session_id` | UUID | NULL | FK → `chat_sessions.id`, `ON DELETE SET NULL` | Source chat session when chat-triggered |
| `trigger_type` | `trigger_type` | NOT NULL | Enum | Trigger category |
| `trigger_value` | TEXT | NOT NULL | — | Trigger description/value |
| `severity` | `VARCHAR(20)` | NOT NULL / `HIGH` | — | Severity label. Code writes `HIGH` (chat risk phrase; DASS-21 priority result) and `ROUTINE` (DASS-21 routine result). No SQL CHECK limits the values |
| `priority` | `VARCHAR(20)` | NOT NULL / `PRIORITY` | CHECK `ROUTINE` or `PRIORITY` | Counselor queue priority |
| `status` | `risk_status` | NOT NULL / `PENDING` | Enum | Review lifecycle |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Flag time |

Indexes: `idx_risk_flags_student_id` on `student_id`; unique partial
`idx_risk_flags_assessment_type_unique` on `(assessment_id, trigger_type)`
where assessment ID is not null; migration also creates
`idx_risk_flags_dass_priority` on `(priority, status, created_at DESC)` for
`SCREENING_THRESHOLD`.

### `approved_guidance`

Approved content available for student resources and guidance retrieval.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Guidance item identifier |
| `topic` | `VARCHAR(255)` | NOT NULL | — | Guidance topic |
| `content` | TEXT | NOT NULL | — | Guidance content |
| `keywords` | `TEXT[]` | NOT NULL / empty text array | — | Keywords used for simple matching |
| `status` | `guidance_status` | NOT NULL / `APPROVED` | Enum | Publication state |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Creation time |

### `audit_logs`

Application audit events.

| Column | PostgreSQL type | Null/default | Keys / constraints | Purpose |
| --- | --- | --- | --- | --- |
| `id` | UUID | NOT NULL / generated UUID | PK | Audit event identifier |
| `user_id` | UUID | NULL | FK → `users.id`, `ON DELETE SET NULL` | Actor when known |
| `action` | `VARCHAR(255)` | NOT NULL | — | Event action label |
| `entity_type` | `VARCHAR(255)` | NULL | — | Referenced entity category |
| `entity_id` | UUID | NULL | — | Referenced entity identifier |
| `details` | JSONB | NULL | — | Event metadata object |
| `created_at` | `TIMESTAMPTZ` | NOT NULL / `NOW()` | — | Event time |

Index: `idx_audit_logs_user_id` on `user_id`.

## Relationships and indexes

Foreign-key relationships and cardinalities are shown in [ERD](erd.md).
Explicit indexes are listed per table above. Primary-key and unique constraints
also create indexes in PostgreSQL. No indexes beyond those declared in the base
schema and DASS-21 migration are documented here.

## Enum values and constraints defined in SQL but not written by the backend

These are valid database values, but no function in `backend/` writes them.
They are listed so readers do not assume the feature exists.

| SQL element | Value(s) | Observed in code |
| --- | --- | --- |
| `user_role` | `ADMIN` | Used only as a context label for audit inserts; no code creates an ADMIN account |
| `user_status` | `INACTIVE`, `SUSPENDED` | Not written; `loginUser` rejects any status other than `ACTIVE` |
| `assessment_type` | `PHQ9`, `GAD7`, `PSS10` | Not written; `submitAssessment` rejects every type except `DASS21` |
| `chat_status` | `RESOLVED` | Never written; only `ACTIVE` and `WAITING_COUNSELOR` are set |
| `message_sender` | `AI` | Never written; AI drafts are stored in `ai_responses`, not `chat_messages` |
| `trigger_type` | `PHQ9_ITEM9` | Reachable only through `RiskDetection.checkAssessment`, which has no caller |
| `guidance_status` | `DRAFT`, `DEACTIVATED` | No write path to `approved_guidance` exists in `backend/`; reads filter on `APPROVED` |
| `assessments.review_status` | `POLICY_PENDING` | Written only by an unreachable branch of `submitDASS21_` (see F-05) |

## `audit_logs.action` values written by the application

| Action | Written by | Entity |
| --- | --- | --- |
| `USER_REGISTERED` | `Student.gs: registerStudent` | `users` |
| `RISK_FLAG_RAISED` | `RiskDetection.gs: raiseRiskFlag` | `risk_flags` |
| `AI_DRAFT_STAGED` | `Chatbot.gs: processStudentMessage_` | `ai_responses` |
| `AI_UNAVAILABLE_QUEUED` | `Chatbot.gs: processStudentMessage_` | `ai_responses` |
| `COUNSELOR_REVIEW_COMPLETED` | `Counselor.gs: processCounselorReview_` | `ai_responses` |
| `RISK_FLAG_REVIEWED` | `Counselor.gs: processRiskFlagReview` | `risk_flags` |
| `DASS21_SCREENING_COMPLETED` | `Assessment.gs: submitDASS21_` | `assessments` |
| `DASS21_SCREENING_REVIEWED` | `Code.gs: processDASS21ScreeningReview` | `assessments` |

Login, logout, and counselor read operations write no audit event.

## Application-only configuration and values

These are not database fields:

| Name | Location | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Apps Script Script Properties | Supabase REST endpoint base |
| `SUPABASE_SERVICE_ROLE_KEY` | Apps Script Script Properties | Privileged server-side Supabase key |
| `GEMINI_API_KEY` | Apps Script Script Properties | Gemini API credential |
| `DASS21_CONSENT_TEXT` | Apps Script Script Properties | Required approved consent text for submission |
| `DASS21_REVIEW_POLICY_APPROVED` | Apps Script Script Properties | Must equal `true` to enable submission |
| `mindbridge_session_<uuid>` | Apps Script `CacheService` (script cache) | Session payload `{id, email, role, profileId, name}`, 3600-second TTL; not a SQL table |
| `mindbridge_session_token`, `mindbridge_user` | Browser `sessionStorage` | Client copy of the token and user payload; set at login, cleared at logout |
| `CONFIG.AI_PROVIDER`, `AI_MODEL`, `MAX_OUTPUT_TOKENS` | `backend/Code.gs` constant | Gemini provider label, model name string, and output limit (350) used by `AIService` |
| `CONFIG.DASS21_REVIEW_POLICY` | `backend/Code.gs` constant | Band cut-offs per subscale. Its keys `reviewRequiredAbove` and `priorityAtOrAbove` are not read by any code (rules are hard-coded in `calculateDASS21`) |
| `CONFIG.CRISIS_RESOURCES` | `backend/Code.gs` constant | Configured support-contact text returned to students; contact values are unverified and must be confirmed by the institution |
| `app.current_user_id`, `app.current_user_role` | HTTP request headers added in `Database.gs` | Intended RLS context. Not confirmed to reach the PostgreSQL settings read by `current_app_user_id()` (see F-04) |

**Not inferred:** the SQL schema does not define a counselor-to-student
assignment table, a notification-delivery table, appointment records, or a
private counselor-notes table.

## Traceability

- Base tables, fields, enums, constraints, and indexes:
  `database/schema.sql`.
- DASS-21 review and priority migration:
  `database/migrations/20261004_dass21_screening.sql`.
- Field usage: `backend/Auth.gs`, `Student.gs`, `Chatbot.gs`, `Assessment.gs`,
  `Counselor.gs`, `Code.gs`, `Database.gs`, and `RiskDetection.gs`.
- This dictionary describes source SQL; it does not verify a live Supabase
  project's applied schema.
