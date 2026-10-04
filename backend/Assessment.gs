var Assessment = (function() {
  var SUBSCALES = {
    depression: [3, 5, 10, 13, 16, 17, 21],
    anxiety: [2, 4, 7, 9, 15, 19, 20],
    stress: [1, 6, 8, 11, 12, 14, 18]
  };

  var SEVERITY_ORDER = ['NORMAL', 'MILD', 'MODERATE', 'SEVERE', 'EXTREMELY SEVERE'];

  function classifyScore(subscale, score) {
    var bands = CONFIG.DASS21_REVIEW_POLICY[subscale];
    if (!bands || !Number.isInteger(score) || score < 0 || score > 42) {
      throw new Error('Invalid DASS-21 subscale score.');
    }
    if (score >= bands.extremelySevere) return 'EXTREMELY SEVERE';
    if (score >= bands.severe) return 'SEVERE';
    if (score >= bands.moderate) return 'MODERATE';
    if (score >= bands.mild) return 'MILD';
    return 'NORMAL';
  }

  function validateAnswers(answers) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return { valid: false, error: 'Please answer all 21 questions.' };
    }
    var keys = Object.keys(answers);
    if (keys.length !== 21) return { valid: false, error: 'Please answer all 21 questions.' };
    for (var question = 1; question <= 21; question++) {
      var key = String(question);
      if (!Object.prototype.hasOwnProperty.call(answers, key) ||
          !Number.isInteger(answers[key]) || answers[key] < 0 || answers[key] > 3) {
        return { valid: false, error: 'Every response must be an integer from 0 to 3.' };
      }
    }
    if (keys.some(function(key) { return !/^(?:[1-9]|1[0-9]|2[01])$/.test(key); })) {
      return { valid: false, error: 'The submitted question numbers are invalid.' };
    }
    return { valid: true };
  }

  function calculateDASS21(answers) {
    var validation = validateAnswers(answers);
    if (!validation.valid) throw new Error(validation.error);
    var results = {};
    Object.keys(SUBSCALES).forEach(function(name) {
      var rawScore = SUBSCALES[name].reduce(function(total, question) {
        return total + answers[String(question)];
      }, 0);
      var standardizedScore = rawScore * 2;
      results[name] = {
        rawScore: rawScore,
        score: standardizedScore,
        severity: classifyScore(name, standardizedScore)
      };
    });
    var isPriority = Object.keys(results).some(function(name) {
      return SEVERITY_ORDER.indexOf(results[name].severity) >= SEVERITY_ORDER.indexOf('SEVERE');
    });
    var requiresReview = Object.keys(results).some(function(name) {
      return results[name].severity !== 'NORMAL';
    });
    return {
      subscales: results,
      priority: isPriority ? 'PRIORITY' : requiresReview ? 'ROUTINE' : null,
      requiresReview: requiresReview,
      triggerSummary: Object.keys(results).filter(function(name) {
        return results[name].severity !== 'NORMAL';
      }).map(function(name) {
        return name.charAt(0).toUpperCase() + name.slice(1) + ': ' + results[name].severity;
      }).join('; ')
    };
  }

  function getDASS21SubmissionApproval_() {
    var properties = PropertiesService.getScriptProperties();
    var consentText = properties.getProperty('DASS21_CONSENT_TEXT') || '';
    var policyApproved = properties.getProperty('DASS21_REVIEW_POLICY_APPROVED') === 'true';
    return {
      enabled: Boolean(consentText.trim()) && policyApproved,
      consentText: consentText,
      policyApproved: policyApproved
    };
  }

  function submitDASS21_(user, answers, consentAccepted) {
    var approval = getDASS21SubmissionApproval_();
    if (!approval.enabled) {
      return {
        success: false,
        error: !approval.consentText.trim()
          ? 'Screening submission is not enabled until institution-approved consent text is configured.'
          : 'Screening submission is not enabled until the review rules are approved by the licensed counselor and research adviser.'
      };
    }
    if (consentAccepted !== true) {
      return { success: false, error: 'Please review and accept the approved screening information before submitting.' };
    }

    var validation = validateAnswers(answers);
    if (!validation.valid) return { success: false, error: validation.error };

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      return { success: false, error: 'Screening submission is busy. Please wait and try again.' };
    }
    try {
      var context = { id: user.id, role: 'STUDENT' };
      var profileResult = Database.select(
        'student_profiles',
        'user_id=eq.' + encodeURIComponent(user.id) + '&select=id&limit=1',
        context
      );
      if (!profileResult.success || !profileResult.data || profileResult.data.length !== 1) {
        return { success: false, error: 'Unable to confirm your student profile.' };
      }
      var studentProfileId = profileResult.data[0].id;
      var window = getCurrentRollingScreeningWindow_();
      var recentResult = Database.select(
        'assessments',
        'student_id=eq.' + encodeURIComponent(studentProfileId) +
          '&type=eq.DASS21&created_at=gte.' + encodeURIComponent(window.start.toISOString()) +
          '&created_at=lt.' + encodeURIComponent(window.end.toISOString()) +
          '&select=id&limit=1',
        context
      );
      if (!recentResult.success) {
        return { success: false, error: 'Unable to check the previous screening period.' };
      }
      if (recentResult.data && recentResult.data.length) {
        return { success: false, error: 'A DASS-21 screening was already submitted within the last seven days.' };
      }

      var calculated = calculateDASS21(answers);
      var reviewStatus = !calculated.requiresReview
        ? 'NOT_REQUIRED'
        : calculated.priority && approval.policyApproved
          ? 'PENDING'
          : 'POLICY_PENDING';
      var subscale = calculated.subscales;
      var insertResult = Database.insert('assessments', {
        student_id: studentProfileId,
        type: 'DASS21',
        total_score: 0,
        severity: 'NOT_AGGREGATED',
        depression_score: subscale.depression.score,
        anxiety_score: subscale.anxiety.score,
        stress_score: subscale.stress.score,
        depression_severity: subscale.depression.severity,
        anxiety_severity: subscale.anxiety.severity,
        stress_severity: subscale.stress.severity,
        review_status: reviewStatus
      }, context);
      if (!insertResult.success || !insertResult.data || !insertResult.data.length || !insertResult.data[0].id) {
        return { success: false, error: 'Unable to save your screening.' };
      }
      var assessmentId = insertResult.data[0].id;

      var answerRows = [];
      for (var question = 1; question <= 21; question++) {
        answerRows.push({
          assessment_id: assessmentId,
          question_number: question,
          answer: String(answers[String(question)]),
          score: answers[String(question)]
        });
      }
      var answerResult = Database.insert('assessment_answers', answerRows, context);
      if (!answerResult.success || !answerResult.data || answerResult.data.length !== 21) {
        var rollback = Database.delete('assessments', 'id=eq.' + encodeURIComponent(assessmentId), context);
        return {
          success: false,
          saved: !rollback.success,
          error: rollback.success
            ? 'Unable to save all screening responses; the incomplete screening was removed. Please try again.'
            : 'The screening record was partially saved. Do not submit again; contact the Guidance Office.'
        };
      }

      var notificationCreated = false;
      if (calculated.requiresReview) {
        var flagResult = Database.insert('risk_flags', {
          student_id: studentProfileId,
          assessment_id: assessmentId,
          session_id: null,
          trigger_type: 'SCREENING_THRESHOLD',
          trigger_value: calculated.triggerSummary,
          severity: calculated.priority === 'PRIORITY' ? 'HIGH' : 'ROUTINE',
          priority: calculated.priority,
          status: 'PENDING'
        }, context);
        if (flagResult.success && flagResult.data && flagResult.data.length) {
          notificationCreated = true;
        } else {
          Logger.log('DASS-21 screening saved but counselor queue flag creation failed; no student response values were logged.');
          return {
            success: true,
            saved: true,
            notificationCreated: false,
            submittedAt: insertResult.data[0].created_at || new Date().toISOString(),
            message: 'Your screening was saved, but counselor queue creation failed. Please contact the Guidance Office.'
          };
        }
      }

      AuditLog.record(user.id, 'DASS21_SCREENING_COMPLETED', 'assessments', assessmentId, {
        reviewStatus: reviewStatus,
        priority: calculated.priority || 'NONE'
      });
      return {
        success: true,
        saved: true,
        notificationCreated: notificationCreated,
        submittedAt: insertResult.data[0].created_at || new Date().toISOString(),
        message: 'Your screening was saved. Your responses and scores are available only to authorized counselors.'
      };
    } finally {
      lock.releaseLock();
    }
  }

  return {
    calculateDASS21: calculateDASS21,
    classifyDASS21Score: classifyScore,
    submitDASS21: function(sessionToken, answers, consentAccepted) {
      var user = getAuthenticatedUser_(sessionToken, 'STUDENT');
      return submitDASS21_(user, answers, consentAccepted);
    },
    submitAssessment: function(sessionToken, type, rawAnswers, consentAccepted) {
      if (type !== 'DASS21') {
        return { success: false, error: 'DASS-21 is the only screening questionnaire enabled.' };
      }
      var user = getAuthenticatedUser_(sessionToken, 'STUDENT');
      return submitDASS21_(user, rawAnswers, consentAccepted);
    }
  };
})();

function submitStudentDASS21(sessionToken, answers, consentAccepted) {
  return Assessment.submitDASS21(sessionToken, answers, consentAccepted);
}
