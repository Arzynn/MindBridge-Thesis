# Data Flow Diagrams

## Purpose and notation

These diagrams show verified data exchanges between actors, application
processes, external services, and persistent stores. They are logical views:
Apps Script helper functions and PostgREST requests are grouped for readability.

**Legend**

- Rounded boxes: external actors or services
- Numbered processes: MindBridge processes
- `D#`: persistent Supabase data store
- Arrows: data exchanged; arrow direction indicates flow direction
- DFD numbering here uses context as Level 0, the decomposition as Level 1,
  and detailed workflows as Level 2

## Level 0 — Context

```mermaid
flowchart LR
    Student[Student]
    Counselor[Counselor]
    GAS[Google Apps Script<br/>MindBridge system]
    Supabase[(Supabase PostgreSQL<br/>REST API)]
    Gemini[Google Gemini API]

    Student -->|registration, credentials, chat, screening answers, page requests| GAS
    GAS -->|rendered pages, session result, student data, status, support contacts| Student
    Counselor -->|credentials, review decisions, search and filter requests| GAS
    GAS -->|counselor portal data, queues, review results| Counselor
    GAS -->|REST queries and writes| Supabase
    Supabase -->|records, query results, status| GAS
    GAS -->|chat text and selected approved guidance| Gemini
    Gemini -->|draft response or generation failure| GAS
```

**Boundary note:** Supabase and Gemini are external services. Apps Script is the
server-side application boundary. The diagram does not imply that Gemini output
is directly delivered to students; drafts are staged for counselor review.

## Level 1 — Major processes and stores

```mermaid
flowchart LR
    Student[Student]
    Counselor[Counselor]
    GAS[Apps Script runtime]
    Gemini[Gemini API]

    P1((1. Render and route pages))
    P2((2. Register, sign in, and manage session))
    P3((3. Load student portal data))
    P4((4. Process chat and risk checks))
    P5((5. Review AI drafts and chat risk flags))
    P6((6. Submit and review DASS-21))
    P7((7. Load counselor records and reports))
    P8((8. Persist audit event))

    D1[(D1 users)]
    D2[(D2 student_profiles)]
    D3[(D3 chat_sessions)]
    D4[(D4 chat_messages)]
    D5[(D5 ai_responses)]
    D6[(D6 counselor_reviews)]
    D7[(D7 assessments)]
    D8[(D8 assessment_answers)]
    D9[(D9 risk_flags)]
    D10[(D10 approved_guidance)]
    D11[(D11 audit_logs)]
    Session[(Apps Script Cache<br/>session payloads)]

    Student -->|page route| P1
    Counselor -->|page route| P1
    P1 -->|HTML template response| Student
    P1 -->|HTML template response| Counselor

    Student -->|registration form or credentials| P2
    Counselor -->|credentials| P2
    P2 <--> D1
    P2 <--> D2
    P2 <--> Session
    P2 -->|session token / result| Student
    P2 -->|session token / result| Counselor
    P2 -->|registration audit event| P8

    Student -->|section request and token| P3
    P3 --> D2
    P3 --> D7
    P3 --> D10
    P3 -->|profile, history, resources| Student

    Student -->|chat request, session ID, token| P4
    P4 --> D2
    P4 --> D3
    P4 --> D4
    P4 --> D9
    P4 -->|risk result and configured contacts| Student
    P4 -->|in-scope message and guidance context| Gemini
    Gemini -->|draft or failure| P4
    P4 -->|staged draft metadata| D5
    P4 -->|audit event| P8

    Counselor -->|review queue request, token| P5
    P5 <--> D5
    P5 <--> D4
    P5 <--> D3
    P5 --> D2
    Counselor -->|approve, edit, reject| P5
    P5 --> D6
    P5 <--> D9
    Counselor -->|risk-flag status change| P5
    P5 -->|review outcome, queues| Counselor
    P5 -->|audit event| P8

    Student -->|answers, consent, token| P6
    P6 --> D2
    P6 <--> D7
    P6 --> D8
    P6 <--> D9
    P6 -->|submission result| Student
    Counselor -->|screening queue and status transition| P6
    P6 -->|screening data and review status| Counselor
    P6 -->|screening audit events| P8

    Counselor -->|portal query and token| P7
    P7 --> D1
    P7 --> D2
    P7 --> D5
    P7 --> D6
    P7 --> D7
    P7 --> D8
    P7 --> D9
    P7 --> D10
    P7 -->|records, counts, resources| Counselor
    P8 --> D11
```

### Store descriptions

| Store | SQL table / component | Purpose |
| --- | --- | --- |
| D1 | `users` | Account, role, and status |
| D2 | `student_profiles` | Student-specific identity/profile |
| D3 | `chat_sessions` | Student chat conversation state |
| D4 | `chat_messages` | Student, counselor, or system messages |
| D5 | `ai_responses` | Pending AI draft and review state |
| D6 | `counselor_reviews` | Counselor decision record for an AI response |
| D7 | `assessments` | Screening metadata and subscale scores |
| D8 | `assessment_answers` | Individual screening answers |
| D9 | `risk_flags` | Risk notifications and their review status |
| D10 | `approved_guidance` | Approved content and retrieval keywords |
| D11 | `audit_logs` | Application audit events |
| Session | Apps Script Cache | Short-lived session token to user payload mapping |

**Balance note:** each Level 1 process `Pn` is decomposed in Level 2 as nodes
`n.1`, `n.2`, ... (for example `P4` becomes `4.1`-`4.6`). External flows that
enter or leave a Level 2 diagram are the same flows shown on the matching
Level 1 process. Database writes are separate REST calls; they are not one
transaction. `P8` denotes events recorded where the code calls `AuditLog`
(registration, risk-flag raise, AI draft staged/unavailable, counselor review,
risk-flag review, DASS-21 completion and review). Counselor *read* operations
(`P7`) write no audit events in the inspected code.

**Known gap in the data flow (verified by absence):** no backend function reads
`chat_messages` for the student. A counselor-approved reply or SYSTEM notice is
stored in `D4` by `P5`, but no implemented flow returns it to the student's
browser. The student chat page only shows messages typed in the current page
session plus the status text returned by `processStudentMessage`. Do not draw a
`D4 -> Student` flow until such an endpoint exists.

**Process-to-function map**

| Process | Source functions |
| --- | --- |
| P1 | `Code.gs: doGet`, `include` |
| P2 | `Auth.gs: loginUser`, `getAuthenticatedUser_`, `logoutUser`; `Student.gs: registerStudent` |
| P3 | `Code.gs: getStudentPortalData`, `getDASS21ScreeningConfig` |
| P4 | `Chatbot.gs: getOrCreateActiveSession`, `processStudentMessage`; `ScopeControl`; `RiskDetection.checkChatMessage`; `GuidanceRetrieval`; `AIService.generateDraft` |
| P5 | `Counselor.gs: getPendingAIReviews`, `processCounselorReview`, `getPendingRiskFlags`, `processRiskFlagReview`; `Code.gs: getCounselorRiskFlags` |
| P6 | `Assessment.gs: submitStudentDASS21`; `Code.gs: getCounselorScreenings`, `processDASS21ScreeningReview` |
| P7 | `Code.gs: getCounselorDashboardData`, `getCounselorStudents`, `getCounselorStudentRecord`, `getCounselorResources`, `getCounselorReports`, `getCounselorProfile` |
| P8 | `AuditLog.gs: record` (plus a direct `audit_logs` insert in `registerStudent`) |

## Level 2 — Authentication and student chat

### Level 2 for P2 — Sign-in

```mermaid
flowchart TD
    U[Student or counselor]
    P21((2.1 Validate submitted credentials and requested role))
    P22((2.2 Read account and check status, role, password))
    P23((2.3 Load student profile when account role is STUDENT))
    P24((2.4 Create random token and cache session payload))
    DUsers[(users)]
    DProfiles[(student_profiles)]
    Cache[(Apps Script Cache)]
    Result[Return user data and session token, or error]

    U -->|email, password, expected role| P21
    P21 -->|normalized email, role check| P22
    P22 <--> DUsers
    P22 -->|student account| P23
    P23 <--> DProfiles
    P23 --> P24
    P22 -->|counselor account| P24
    P24 --> Cache
    P24 --> Result
    P22 -->|invalid, inactive, wrong role, or DB failure| Result
    P23 -->|profile lookup failure| Result
```

### Level 2 for P4 — Student chat request

```mermaid
flowchart TD
    Browser[Student browser]
    P41((4.1 Validate session role, input length, and scope))
    P42((4.2 Confirm profile and owned chat session))
    P43((4.3 Save student message))
    P44((4.4 Detect configured risk phrases))
    P45((4.5 Retrieve approved guidance and request Gemini draft))
    P46((4.6 Stage pending review and update session))
    DProf[(student_profiles)]
    DSess[(chat_sessions)]
    DMsg[(chat_messages)]
    DGuidance[(approved_guidance)]
    DRisk[(risk_flags)]
    DAI[(ai_responses)]
    Gemini[Gemini API]
    Result[Status or error to student]

    Browser -->|token, session ID, message| P41
    P41 -->|invalid / out-of-scope| Result
    P41 --> P42
    P42 <--> DProf
    P42 <--> DSess
    P42 -->|not owned or missing session| Result
    P42 --> P43
    P43 --> DMsg
    P43 --> P44
    P44 -->|phrase matched| DRisk
    P44 -->|risk detected and flag saved| DSess
    P44 -->|risk status and configured contacts| Result
    P44 -->|no phrase match| P45
    P45 --> DGuidance
    P45 -->|message and up to two matched contexts| Gemini
    Gemini -->|draft or failure| P45
    P45 --> P46
    P46 --> DAI
    P46 --> DSess
    P46 -->|waiting for counselor review| Result
    P46 -->|save or queue failure| Result
```

**Implementation detail:** an AI failure can still create a pending `ai_responses`
row with model name `AI_UNAVAILABLE` and an empty draft so a counselor can
respond manually. If the database steps partially succeed, the process can
return an error after earlier records have been saved.

## Level 2 — Counselor review and DASS-21

### Level 2 for P5 — Counselor AI-response review

```mermaid
flowchart TD
    C[Counselor browser]
    P51((5.1 Authenticate counselor and load pending response))
    P52((5.2 Validate action and response))
    P53((5.3 Save counselor message or rejection notice))
    P54((5.4 Save review record and update response status))
    P55((5.5 Reopen chat when a reply is delivered))
    DAI[(ai_responses)]
    DMsg[(chat_messages)]
    DReview[(counselor_reviews)]
    DSess[(chat_sessions)]
    Result[Review result]

    C -->|session token and queue request| P51
    P51 <--> DAI
    P51 -->|pending item and linked message| C
    C -->|action, optional edited response, comment| P52
    P52 -->|invalid action, unavailable draft approved, or missing message link| Result
    P52 --> P53
    P53 --> DMsg
    P53 -->|write failure| Result
    P53 --> P54
    P54 --> DReview
    P54 --> DAI
    P54 -->|review/write failure; partial effects possible| Result
    P54 -->|APPROVED or EDITED| P55
    P55 --> DSess
    P55 --> Result
    P54 -->|REJECTED| Result
```

**Important:** the code performs multiple database requests without a shared
transaction. It may save a conversation message before a later review/status
write fails.

### Level 2 for P6 — DASS-21 student submission

```mermaid
flowchart TD
    Student[Student browser]
    P61((6.1 Check student session and configured approvals))
    P62((6.2 Require consent and validate 21 integer answers))
    P63((6.3 Lock submission and enforce rolling seven-day limit))
    P64((6.4 Calculate three independent subscales))
    P65((6.5 Save assessment and 21 answer rows))
    P66((6.6 Create pending risk flag when review is required))
    Profile[(student_profiles)]
    Assess[(assessments)]
    Answers[(assessment_answers)]
    Flags[(risk_flags)]
    Result[Submission status]

    Student -->|token, answers, consent accepted| P61
    P61 -->|approval missing / wrong role| Result
    P61 --> P62
    P62 -->|consent missing / invalid answers| Result
    P62 --> P63
    P63 --> Profile
    P63 --> Assess
    P63 -->|busy, lookup failure, or recent submission| Result
    P63 --> P64
    P64 --> P65
    P65 --> Assess
    P65 --> Answers
    P65 -->|answer batch incomplete; delete assessment attempted| Result
    P65 -->|review not required| Result
    P65 -->|review required| P66
    P66 --> Flags
    P66 -->|flag failed; screening remains saved| Result
    P66 --> Result
```

The endpoint requires Script Properties `DASS21_CONSENT_TEXT` and
`DASS21_REVIEW_POLICY_APPROVED=true`, then requires the student's consent
boolean. Score bands and review routing still require institutional approval.

### Level 2 for P4 — risk-phrase branch (detail of node 4.4)

When a configured risk phrase matches, `RiskDetection.raiseRiskFlag` inserts a
`risk_flags` row (`trigger_type = RISK_LEXICON`, `severity = HIGH`, status
`PENDING`, session ID set), writes a `RISK_FLAG_RAISED` audit event, and, if the
insert succeeded, sets `chat_sessions.risk_flag = true`. `processStudentMessage_`
then sets `chat_sessions.status = WAITING_COUNSELOR` and returns the configured
support contacts. **No Gemini request is made on this branch**, and no
`ai_responses` row is created. The matched phrase is stored in
`risk_flags.trigger_value`; it is not shown on any diagram.

### Level 2 for P5 — Chat risk-flag review (counselor)

```mermaid
flowchart TD
    C[Counselor browser]
    P56((5.6 Authenticate counselor and list flags))
    P57((5.7 Validate expected status and requested transition))
    P58((5.8 Conditional status update))
    P59((5.9 Record audit event))
    DRisk[(risk_flags)]
    DProf[(student_profiles)]
    DAudit[(audit_logs)]
    Result[Updated status or error]

    C -->|token, optional status filter| P56
    P56 <--> DRisk
    P56 <--> DProf
    P56 -->|flag rows with student identifiers| C
    C -->|flag ID, next status, expected status| P57
    P57 -->|invalid transition| Result
    P57 --> P58
    P58 --> DRisk
    P58 -->|no row matched or write failed| Result
    P58 --> P59
    P59 --> DAudit
    P59 --> Result
```

Allowed transitions in `processRiskFlagReview` (expected status defaults to
`PENDING`): `PENDING` to `REVIEWED`, `FOLLOW_UP`, or `CLOSED`; `REVIEWED` to
`FOLLOW_UP` or `CLOSED`; `FOLLOW_UP` to `CLOSED`. The update is filtered on the
expected current status, so a stale request updates nothing and returns an
error. The flag-review path does not message the student and does not contact
any emergency service.

### Level 2 for P6 — DASS-21 counselor screening review

```mermaid
flowchart TD
    C[Counselor browser]
    P67((6.7 Authenticate counselor and validate filters))
    P68((6.8 Load screenings, student identifiers, answers))
    P69((6.9 Validate status transition))
    P610((6.10 Update assessment review status))
    P611((6.11 Synchronize linked risk flag and audit))
    DAss[(assessments)]
    DAns[(assessment_answers)]
    DProf[(student_profiles)]
    DRisk[(risk_flags)]
    DAudit[(audit_logs)]
    Result[Status or error]

    C -->|token, status/date/priority filters| P67
    P67 -->|invalid filter| Result
    P67 --> P68
    P68 <--> DAss
    P68 <--> DProf
    P68 <--> DAns
    P68 -->|screenings with subscales and answers| C
    C -->|assessment ID, next status| P69
    P69 -->|not found or transition not allowed| Result
    P69 --> P610
    P610 --> DAss
    P610 --> P611
    P611 --> DRisk
    P611 --> DAudit
    P611 -->|flag sync failed: partial error| Result
    P611 --> Result
```

`processDASS21ScreeningReview` allows `PENDING` to `REVIEWED` or `FOLLOW_UP`,
`REVIEWED` to `FOLLOW_UP` or `CLOSED`, and `FOLLOW_UP` to `CLOSED`. It updates
`assessments` (`review_status`, `reviewed_by`, `reviewed_at`) filtered on the
current status, then updates the linked `SCREENING_THRESHOLD` risk flag with the
same status. If the flag update affects no row, the function returns
`success: false, partial: true` even though the assessment status was already
saved, and no audit event is written in that case. Assessments in
`POLICY_PENDING` or `NOT_REQUIRED` have no allowed transition.

## Traceability and verified limits

- Routing and page response: `backend/Code.gs:doGet`.
- Authentication: `backend/Auth.gs:loginUser`,
  `getAuthenticatedUser_`, `logoutUser`.
- Chat and risk: `backend/Chatbot.gs`, `backend/RiskDetection.gs`,
  `backend/GuidanceRetrieval.gs`, and `backend/AIService.gs`.
- Counselor actions: `backend/Counselor.gs`; counselor screening and portal
  queries: `backend/Code.gs`.
- DASS-21: `backend/Assessment.gs`.
- Stores: `database/schema.sql` and
  `database/migrations/20261004_dass21_screening.sql`.
- Client/server mechanism: `frontend/js/ui.js` and page scripts use
  `google.script.run`.

Level 2 node numbers for the review diagrams (5.6-5.9, 6.7-6.11) continue the
numbering of the matching Level 2 diagram for the same Level 1 process.

The DFDs do not claim production access restrictions, clinical validity,
transactional writes, or successful live connectivity. The generated manifest
allows anonymous web-app access; deployment configuration must be reviewed
separately.
