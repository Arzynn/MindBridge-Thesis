# Pseudocode

This pseudocode translates selected implementation workflows into
language-neutral algorithms. Names retain source terminology where useful.

## 1. Authentication and session validation

```text
FUNCTION loginUser(emailInput, passwordInput, expectedRole):
    email <- LOWERCASE(TRIM(emailInput))
    role <- UPPERCASE(expectedRole)

    IF email is empty OR passwordInput is empty
       OR role NOT IN {"STUDENT", "COUNSELOR"}:
        RETURN failure("Invalid credentials")

    userResult <- Database.select user by email
    IF userResult failed:
        RETURN failure("Unable to sign in right now")
    IF userResult has no row:
        RETURN failure("Invalid credentials")

    user <- first userResult row
    IF UPPERCASE(user.status) != "ACTIVE":
        RETURN failure("Account inactive")
    IF UPPERCASE(user.role) != role:
        RETURN failure("Invalid credentials")
    IF NOT verifyPassword(passwordInput, user.password_hash):
        RETURN failure("Invalid credentials")

    profileId <- null
    displayName <- user.full_name OR user.name OR email
    IF user.role == "STUDENT":
        profileResult <- Database.select student profile for user.id
        IF profileResult failed OR profileResult has no row:
            RETURN failure("Student profile unavailable")
        profileId <- profileResult.first.id
        displayName <- joined non-empty first_name and last_name
                       OR displayName

    payload <- {
        id: user.id,
        email: email,
        role: UPPERCASE(user.role),
        profileId: profileId,
        name: displayName
    }
    token <- GENERATE_UUID()
    Cache.put("mindbridge_session_" + token, JSON(payload), 3600 seconds)
    RETURN success(payload, token)
END FUNCTION

FUNCTION verifyPassword(input, stored):
    IF input empty OR stored empty:
        RETURN false
    IF stored == input:                      # legacy plain-text match (finding F-03)
        RETURN true
    IF stored starts with "sha256$" AND has exactly three "$"-separated parts:
        RETURN SHA256(salt + input) as hex == third part
    RETURN false
END FUNCTION

FUNCTION getAuthenticatedUser(token, expectedRole):
    IF token missing OR token is not string OR LENGTH(token) > 128:
        RAISE expired-session error
    serialized <- Cache.get("mindbridge_session_" + token)
    IF serialized missing:
        RAISE expired-session error
    payload <- PARSE_JSON(serialized)
    IF parsing fails:
        Cache.remove(token)
        RAISE invalid-session error
    IF payload.id missing OR payload.role missing:
        RAISE unauthorized error
    IF expectedRole supplied AND payload.role != expectedRole:
        RAISE unauthorized error
    RETURN payload
END FUNCTION
```

## 2. Chat message, risk branch, and AI queue

```text
FUNCTION processStudentMessage(token, sessionId, messageText):
    user <- getAuthenticatedUser(token, "STUDENT")
    message <- TRIM(messageText if string else "")
    IF message empty OR LENGTH(message) > 2000 OR sessionId missing:
        RETURN error("Invalid message")

    IF ScopeControl.isWithinScope(message) is false:
        RETURN outOfScope(ScopeControl.getFallbackResponse())

    profile <- find student_profiles row for user.id
    IF profile lookup failed OR no profile:
        RETURN error("Student profile not found")

    session <- find chat_sessions row matching sessionId
               AND profile.id
    IF query failed OR no matching session:
        RETURN error("Session unavailable")

    savedMessage <- INSERT chat_messages(
        sessionId, sender="STUDENT", message
    )
    IF savedMessage failed or has no generated ID:
        RETURN error("Unable to save message")

    risk <- RiskDetection.checkChatMessage(
        profile.id, sessionId, message, student context
    )
    # checkChatMessage: lexicon match -> INSERT risk_flags(RISK_LEXICON, HIGH, PENDING),
    #   audit RISK_FLAG_RAISED, UPDATE chat_sessions.risk_flag = true when saved
    IF risk.riskDetected:
        IF risk.queued is false:
            RETURN error with configured support contacts
        sessionUpdate <- UPDATE chat_sessions.status to "WAITING_COUNSELOR"
        IF update failed:
            RETURN partial-failure error with configured contacts
        RETURN risk-detected with configured contacts

    context <- GuidanceRetrieval.getRelevantGuidance(message)
    draft <- AIService.generateDraft(message, context)

    IF draft failed:
        queue <- INSERT ai_responses(
            sessionId, savedMessage.id, ai_response="",
            model_name="AI_UNAVAILABLE", status="PENDING"
        )
        IF queue failed:
            RETURN error("Message saved; counselor queue unavailable")
        sessionUpdate <- UPDATE chat_sessions.status to "WAITING_COUNSELOR"
        IF update failed:
            RETURN partial-failure error
        WRITE coarse AI failure audit event
        RETURN waiting-for-manual-counselor-review

    queue <- INSERT ai_responses(
        sessionId, savedMessage.id, draft.text,
        model_name=draft.model, status="PENDING"
    )
    IF queue failed:
        RETURN error("Message saved; review queue failed")

    sessionUpdate <- UPDATE chat_sessions.status to "WAITING_COUNSELOR"
    IF update failed:
        RETURN partial-failure error
    WRITE draft-staged audit event
    RETURN waiting-for-counselor-review
END FUNCTION
```

## 3. Counselor review

```text
FUNCTION processCounselorReview(token, responseId, action, editedText, comment):
    counselor <- getAuthenticatedUser(token, "COUNSELOR")
    IF action NOT IN {"APPROVED", "EDITED", "REJECTED"}:
        RETURN invalid-action error
    IF action == "EDITED"
       AND (editedText is not string OR TRIM(editedText) empty
            OR LENGTH(editedText) > 10000):
        RETURN invalid-response error

    draft <- SELECT ai_responses
             WHERE id=responseId AND status="PENDING"
    IF query failed OR no row:
        RETURN pending-response-not-found error
    IF draft.model_name == "AI_UNAVAILABLE" AND action == "APPROVED":
        RETURN require-counselor-authored-response error
    IF action IN {"APPROVED", "EDITED"} AND draft.message_id is null:
        RETURN missing-original-message-link error

    IF action == "APPROVED":
        finalText <- draft.ai_response
        IF TRIM(finalText) empty:
            RETURN empty-response error
        messageResult <- INSERT COUNSELOR message with finalText
    ELSE IF action == "EDITED":
        messageResult <- INSERT COUNSELOR message with editedText
    ELSE:
        messageResult <- INSERT SYSTEM rejection notice
    IF messageResult failed:
        RETURN delivery error

    reviewResult <- INSERT counselor_reviews(
        responseId, counselor.id, action, original draft,
        edited text when EDITED, comment
    )
    IF reviewResult failed:
        RETURN error indicating message may already be saved

    statusResult <- UPDATE ai_responses.status to action
                    WHERE id=responseId AND status="PENDING"
    IF statusResult failed or no row:
        RETURN error indicating message may already be saved

    IF action IN {"APPROVED", "EDITED"}:
        reopenResult <- UPDATE chat_sessions.status to "ACTIVE"
        IF reopenResult failed or no row:
            RETURN error indicating response was delivered

    WRITE counselor-review audit event
    RETURN success(delivered=true)
END FUNCTION
```

## 4. DASS-21 scoring and submission

```text
CONSTANT SUBSCALES:
    depression = [3, 5, 10, 13, 16, 17, 21]
    anxiety    = [2, 4, 7, 9, 15, 19, 20]
    stress     = [1, 6, 8, 11, 12, 14, 18]

FUNCTION validateAnswers(answers):
    IF answers is null OR not an object OR is an array:
        RETURN invalid
    IF count(keys(answers)) != 21:
        RETURN invalid
    FOR question FROM 1 TO 21:
        value <- answers[string(question)]
        IF key missing OR value is not integer OR value < 0 OR value > 3:
            RETURN invalid
    IF any key is not a decimal question number from 1 through 21:
        RETURN invalid
    RETURN valid
END FUNCTION

FUNCTION calculateDASS21(answers):
    REQUIRE validateAnswers(answers)
    FOR EACH subscale IN SUBSCALES:
        raw <- SUM(answers[q] FOR q IN SUBSCALES[subscale])
        standardized <- raw * 2
        severity <- classify standardized using CONFIG thresholds
        result[subscale] <- {raw, standardized, severity}

    requiresReview <- any severity != "NORMAL"
    priority <- "PRIORITY" if any severity >= "SEVERE"
                ELSE "ROUTINE" if requiresReview
                ELSE null
    RETURN result, requiresReview, priority
END FUNCTION

FUNCTION submitDASS21(token, answers, consentAccepted):
    user <- getAuthenticatedUser(token, "STUDENT")
    approval <- read DASS21_CONSENT_TEXT and
                DASS21_REVIEW_POLICY_APPROVED from Script Properties
    IF consent text blank OR policy approval != "true":
        RETURN disabled error
    IF consentAccepted is not exactly true:
        RETURN consent-required error
    IF validateAnswers(answers) is invalid:
        RETURN validation error

    IF script lock cannot be acquired within 30 seconds:
        RETURN busy error
    TRY:
        profile <- confirm exactly one student profile for user.id
        IF unavailable:
            RETURN profile error

        recent <- query assessments for same student, type DASS21,
                  created within rolling prior seven days
        IF query failed:
            RETURN duplicate-check error
        IF recent row exists:
            RETURN seven-day-limit error

        scores <- calculateDASS21(answers)
        status <- NOT_REQUIRED if no review needed
                  ELSE PENDING if priority is set and policy approved
                  ELSE POLICY_PENDING      # unreachable: priority is ROUTINE or
                                           # PRIORITY here and approval is already true
        assessment <- INSERT assessments with type DASS21,
                       total_score=0, severity="NOT_AGGREGATED",
                       independent subscale scores and status
        IF insert failed:
            RETURN save error

        rows <- 21 assessment_answers records
        answerResult <- INSERT rows
        IF not all 21 saved:
            rollback <- DELETE assessment
            RETURN incomplete-save error based on rollback result

        IF scores.requiresReview:
            flagResult <- INSERT pending SCREENING_THRESHOLD risk flag
            IF flagResult failed:
                RETURN saved-with-queue-warning

        WRITE DASS-21 completion audit event
        RETURN saved result and timestamp
    FINALLY:
        release script lock
END FUNCTION
```

## 5. Counselor review of screenings and chat risk flags

```text
FUNCTION processDASS21ScreeningReview(token, assessmentId, nextStatus):
    counselor <- getAuthenticatedUser(token, "COUNSELOR")
    IF assessmentId empty OR not a string:
        RETURN error
    allowed <- {PENDING: [REVIEWED, FOLLOW_UP],
                REVIEWED: [FOLLOW_UP, CLOSED],
                FOLLOW_UP: [CLOSED]}
    row <- SELECT assessments WHERE id=assessmentId AND type="DASS21"
    IF query failed OR no row:
        RETURN not-found error
    current <- row.review_status
    IF current NOT IN allowed OR nextStatus NOT IN allowed[current]:
        RETURN transition-not-allowed error
    updated <- UPDATE assessments SET review_status=nextStatus,
               reviewed_by=counselor.id, reviewed_at=NOW
               WHERE id=assessmentId AND review_status=current
    IF failed OR no row:
        RETURN save error
    flags <- UPDATE risk_flags SET status=nextStatus
             WHERE assessment_id=assessmentId
               AND trigger_type="SCREENING_THRESHOLD" AND status=current
    IF failed OR no row:
        RETURN error(partial=true)           # assessment already updated
    WRITE screening-reviewed audit event
    RETURN success(nextStatus)
END FUNCTION

FUNCTION processRiskFlagReview(token, flagId, nextStatus, expectedStatus):
    counselor <- getAuthenticatedUser(token, "COUNSELOR")
    expected <- expectedStatus OR "PENDING"
    allowed <- {PENDING: [REVIEWED, FOLLOW_UP, CLOSED],
                REVIEWED: [FOLLOW_UP, CLOSED],
                FOLLOW_UP: [CLOSED]}
    IF flagId invalid OR expected NOT IN allowed OR nextStatus NOT IN allowed[expected]:
        RETURN invalid-action error
    updated <- UPDATE risk_flags SET status=nextStatus
               WHERE id=flagId AND status=expected
    IF failed OR no row:
        RETURN error("may already have been reviewed")
    WRITE risk-flag-reviewed audit event
    RETURN success
END FUNCTION
```

## Traceability and test evidence

Source: `backend/Auth.gs`, `Student.gs`, `Chatbot.gs`, `Counselor.gs`,
`Assessment.gs`, `RiskDetection.gs`, `GuidanceRetrieval.gs`, and `Database.gs`.
A previous revision of this documentation reported that `tests/dass21.test.js`
covers scoring boundaries, answer validation, submission gating/duplicate
protection, and counselor status transitions. The `tests/` folder was **not in
the archive reviewed for this revision**, so that statement is carried forward
and not re-verified. Local tests would not exercise a live Apps Script project
or real database.
