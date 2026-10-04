# Structured English

Structured English expresses verified workflows in constrained, readable
statements. These descriptions reflect the present implementation, including
failure and partial-write cases.

## 1. Sign in and establish a session

**Input:** email, password, expected role (`STUDENT` or `COUNSELOR`)  
**Output:** user payload and session token, or an error

```text
BEGIN sign-in
    Normalize the email by trimming whitespace and converting it to lowercase.
    Convert the requested role to uppercase.

    IF email or password is missing
       OR requested role is not STUDENT or COUNSELOR
        RETURN invalid credentials.
    END IF

    Read the matching user account from Supabase.
    IF the query fails
        RETURN a temporary sign-in error.
    END IF
    IF no account is found
        RETURN invalid credentials.
    END IF

    IF account is not ACTIVE
        RETURN inactive-account error.
    END IF
    IF account role differs from requested role
        RETURN invalid credentials.
    END IF
    IF password does not match stored value/hash
        RETURN invalid credentials.
    END IF

    IF account role is STUDENT
        Read the student's profile.
        IF profile lookup fails or profile is absent
            RETURN profile/sign-in error.
        END IF
    END IF

    Create a user session payload.
    Generate a UUID token.
    Store token-to-payload mapping in Apps Script Cache for 3600 seconds.
    RETURN user payload and token.
END sign-in
```

**Session check:** reject missing, non-string, or oversized tokens; read the
cache entry; parse the payload; confirm user ID and role; reject if the
requested role does not match.

## 2. Process a student chat message

**Input:** session token, session ID, message text  
**Output:** out-of-scope, risk, waiting-for-review, or error status

```text
BEGIN process student message
    Authenticate token as STUDENT.
    Trim the message.
    IF message is empty, longer than 2000 characters, or session ID is absent
        RETURN input error.
    END IF

    IF message is outside supported wellness scope
        RETURN configured out-of-scope response.
    END IF

    Load the student's profile.
    Confirm that the session belongs to that profile.
    IF either lookup fails or session is not owned by this student
        RETURN an error without processing the request.
    END IF

    Insert the student message.
    IF message insert fails
        RETURN save error.
    END IF

    Check message for a configured risk phrase.
    IF a risk phrase matches
        Insert a pending risk flag (trigger RISK_LEXICON, severity HIGH).
        Record a risk-flag-raised audit event.
        IF the flag was saved
            Mark the chat session's risk_flag as true.
        END IF
        IF flag insert fails
            RETURN error and configured support contacts.
        END IF
        Update the session status to WAITING_COUNSELOR.
        IF session update fails
            RETURN partial-failure error and configured support contacts.
        END IF
        RETURN risk-detected status and configured support contacts.
    END IF

    Load approved guidance and select up to two keyword matches.
    Request an AI draft from Gemini using the message and selected context.

    IF Gemini does not return a usable draft
        Insert a pending ai_responses record marked AI_UNAVAILABLE.
        IF queue insert fails
            RETURN error; student message remains saved.
        END IF
        Update session status to WAITING_COUNSELOR.
        IF update fails
            RETURN partial-failure error.
        END IF
        Record coarse AI-unavailable audit event.
        RETURN waiting-for-manual-counselor-review status.
    END IF

    Insert the draft as a pending ai_responses record.
    IF insert fails
        RETURN error; student message remains saved.
    END IF
    Update session status to WAITING_COUNSELOR.
    IF update fails
        RETURN partial-failure error.
    END IF
    Record AI-draft-staged audit event.
    RETURN waiting-for-counselor-review status.
END process student message
```

The draft is not directly delivered to the student. Individual database calls
are not wrapped in a transaction.

## 3. Review a pending AI response

**Input:** counselor token, AI response ID, action, optional edited text/comment  
**Output:** success/failure and delivery status

```text
BEGIN counselor AI review
    Authenticate token as COUNSELOR.
    Confirm action is APPROVED, EDITED, or REJECTED.
    For EDITED, require non-empty edited text no longer than 10000 characters.
    Load the response only if its current status is PENDING.
    IF no pending response is found
        RETURN not-found/review error.
    END IF

    IF response is marked AI_UNAVAILABLE AND action is APPROVED
        RETURN error; require counselor-authored text with EDITED action.
    END IF
    IF action is APPROVED or EDITED AND original message link is missing
        RETURN error; block sending.
    END IF

    IF action is APPROVED
        Require non-empty original draft.
        Insert draft text as a COUNSELOR chat message.
    ELSE IF action is EDITED
        Insert edited text as a COUNSELOR chat message.
    ELSE
        Insert the configured SYSTEM rejection notice.
    END IF
    IF message insert fails
        RETURN delivery error.
    END IF

    Insert counselor_reviews record.
    IF review insert fails
        RETURN failure noting message may already be delivered.
    END IF

    Update ai_responses status to the selected action, requiring current PENDING.
    IF status update fails
        RETURN failure noting message may already be delivered.
    END IF

    IF action is APPROVED or EDITED
        Update chat session to ACTIVE.
        IF session update fails
            RETURN failure noting response was delivered.
        END IF
    END IF

    Record counselor-review audit event.
    RETURN success and delivery state.
END counselor AI review
```

## 4. Submit a DASS-21 screening

**Input:** student token, map of question numbers to integer answers, consent  
**Output:** saved result or validation/configuration/database failure

```text
BEGIN DASS-21 submission
    Authenticate token as STUDENT.
    Read consent text and review-policy approval from Script Properties.
    IF approved consent text is empty OR policy approval is not true
        REJECT submission.
    END IF
    IF consentAccepted is not exactly true
        REJECT submission.
    END IF
    Require exactly keys 1 through 21, each an integer from 0 through 3.
    IF validation fails
        RETURN validation error.
    END IF

    Acquire Apps Script lock for up to 30 seconds.
    IF lock cannot be acquired
        RETURN busy error.
    END IF

    TRY
        Confirm exactly one student profile.
        Check for a DASS21 assessment in the rolling seven-day window.
        IF query fails or a recent submission exists
            RETURN corresponding error.
        END IF

        Sum mapped questions independently for depression, anxiety, and stress.
        Multiply each subscale raw score by two.
        Classify each subscale using configured thresholds.
        Set priority to PRIORITY if any subscale is SEVERE or higher;
        otherwise set it to ROUTINE if any subscale is not NORMAL.

        Insert assessment with total_score zero and NOT_AGGREGATED severity.
        Insert all 21 answer rows.
        IF answer insertion is incomplete
            Attempt to delete the assessment.
            RETURN removed-incomplete or partial-save warning based on delete result.
        END IF

        IF any subscale requires review
            Insert a pending SCREENING_THRESHOLD risk flag.
            IF flag insert fails
                RETURN success-with-warning; assessment and answers remain saved.
            END IF
        END IF
        Record completion audit event.
        RETURN saved result.
    FINALLY
        Release Apps Script lock.
    END TRY
END DASS-21 submission
```

**Review-status rule as implemented:** `review_status` is `NOT_REQUIRED` when
every subscale is NORMAL; otherwise it is `PENDING` when `calculated.priority`
is set and policy approval is true, else `POLICY_PENDING`. Because the
priority value is `ROUTINE` (a non-empty value) for non-severe results, and
submission is already blocked unless policy approval is true, **every
review-requiring result becomes `PENDING` and the `POLICY_PENDING` branch cannot
be reached** in the current code. The data dictionary and ERD still list
`POLICY_PENDING` because the SQL CHECK allows it (finding F-05).

## 5. Review a screening or a chat risk flag (counselor)

**Input:** counselor token, record ID, requested next status  
**Output:** new status or error

```text
BEGIN counselor DASS-21 screening review
    Authenticate token as COUNSELOR.
    Require a non-empty assessment ID.
    Read the assessment (type DASS21) and its current review status.
    IF not found
        RETURN not-found error.
    END IF
    IF the requested status is not an allowed next step from the current status
       (PENDING -> REVIEWED or FOLLOW_UP; REVIEWED -> FOLLOW_UP or CLOSED;
        FOLLOW_UP -> CLOSED)
        RETURN transition-not-allowed error.
    END IF
    Update the assessment status, reviewer, and review time,
        but only where the status is still the one that was read.
    IF no row was updated
        RETURN save error.
    END IF
    Update the linked SCREENING_THRESHOLD risk flag to the same status,
        but only where it still has the old status.
    IF no row was updated
        RETURN partial error (assessment status was saved; queue not synchronized).
    END IF
    Record a screening-reviewed audit event.
    RETURN new status.
END counselor DASS-21 screening review

BEGIN counselor chat risk-flag review
    Authenticate token as COUNSELOR.
    Use PENDING as the expected status when none is supplied.
    IF the flag ID is empty OR the requested status is not an allowed next step
       (PENDING -> REVIEWED, FOLLOW_UP, or CLOSED; REVIEWED -> FOLLOW_UP or CLOSED;
        FOLLOW_UP -> CLOSED)
        RETURN invalid-action error.
    END IF
    Update the risk flag status where the flag ID and expected status match.
    IF no row was updated
        RETURN error (it may already have been reviewed).
    END IF
    Record a risk-flag-reviewed audit event.
    RETURN success.
END counselor chat risk-flag review
```

Neither review notifies the student or any emergency service.

## Traceability and limits

Authentication and chat flow: `backend/Auth.gs`, `backend/Chatbot.gs`,
`backend/ScopeControl.gs`, `backend/RiskDetection.gs`,
`backend/GuidanceRetrieval.gs`, `backend/AIService.gs`.
Counselor review: `backend/Counselor.gs`; screening review:
`backend/Code.gs: processDASS21ScreeningReview`.
DASS-21: `backend/Assessment.gs`; submission configuration and portal:
`backend/Code.gs`.

These descriptions do not claim atomic transactions, verified clinical policy,
live service availability, or emergency response.
