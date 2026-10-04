# MindBridge test plan

## Local checks

- Run `node build-gas.js` after changes to `frontend/` or `backend/`.
- Check JavaScript syntax for the source and generated `.gs`/client scripts.
- Check that every `include()` and routed page name exists in `apps-script/`.
- Inspect the generated HTML/CSS and verify it still contains the source page
  markup, extracted styles, and expected client code.
- Never treat these static checks as proof of Apps Script, Supabase, or Gemini
  runtime behavior.

## Apps Script deployment checks

Use test accounts and non-production records:

- TC-01: Student login, account creation, session creation, standard wellness
  chat flow, and counselor response review.
- TC-02: Risk-detection trigger and display of configured crisis resources.
- TC-03: Out-of-scope fallback and input length validation.
- TC-04: Counselor login, review approval/edit/rejection, and pending queue
  reload.
- TC-05: Call student endpoints without a token, with an expired token, and
  with a counselor token; requests must fail.
- TC-06: Call counselor endpoints without a token, with an expired token, and
  with a student token; requests must fail.
- TC-07: Attempt to use a student's token with another student's chat session;
  the request must fail.
- TC-08: Verify no keys appear in browser source, logs, generated files, or
  archive contents. Verify rotated keys are only present in Apps Script Script
  Properties.
- TC-09: Verify every route and link, narrow/mobile viewport layout, database
  failures, missing configuration, and the deployed browser console.
- TC-10: A student can load only their own dashboard, profile, resources, and
  screening history; missing, expired, and counselor tokens are rejected.
- TC-11: A screening threshold or risk phrase creates a pending counselor risk
  flag, and counselor-only review actions update its status.
- TC-12: When Gemini is unavailable, the student message is saved and a pending
  counselor review record is created before the UI says it was queued.
- TC-13: Confirm Weekly Screening remains unavailable until approved questions,
  consent, scoring, and frequency rules are supplied; no invented items appear.
- TC-14: Counselor portal routes reject missing, expired, and student sessions;
  dashboard and report metrics match Supabase exact counts.
- TC-15: Counselor AI review items show the `chat_messages` row referenced by
  `ai_responses.message_id`; absent links are explicitly reported, never
  replaced with another message from the session.
- TC-16: Student search/detail, assessment response retrieval, risk status
  transitions, counselor profile, approved resources, and logout work from a
  deployed test project. Verify students cannot call counselor endpoints.
- TC-17: Review failures do not display a success confirmation. Check saved
  message, review row, response status, and session status after injected
  database failures; the current Supabase REST sequence is not transactional.
- TC-18: Gemini failures log only a coarse failure code/status, and each queued
  failure displays a manual-response prompt without claiming a draft exists.
  Verify missing configuration, HTTP error, empty response, and malformed
  response paths with test credentials only.
- TC-19: Run the local DASS-21 unit suite with `node --test tests\dass21.test.js`
  from `MindBridge/`. Verify all item mappings, separate raw and standardized
  scores, all severity boundaries, review priority, invalid answers, duplicate
  prevention, counselor-only review, and no aggregate score stored.
- TC-20: In Supabase test project only, apply
  `database/migrations/20261004_dass21_screening.sql`, configure approved
  consent and policy properties, submit synthetic responses, and verify 21
  answer rows, subscale-only scores, exactly one linked risk flag when
  required, student-safe history, counselor review updates, and seven-day
  resubmission rejection. Test queue/database failure paths.
- TC-21: With consent or policy approval absent, verify form submission stays
  disabled and direct `google.script.run` calls are rejected by the backend.

Authorization, service integrations, rendering, and responsive behavior require
manual testing in a deployed Apps Script project; they are not verifiable from
this local checkout alone.