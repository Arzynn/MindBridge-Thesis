var RiskDetection = (function() {
  var RISK_KEYWORDS = [
    "suicide", "kill myself", "end my life", "want to die", "harm myself", 
    "self-harm", "slitting", "overdose", "hopeless, don't want to wake up",
    "better off dead", "cutting my"
  ];

  function evaluateLexicon(text) {
    if (!text) return { detected: false };
    var lower = text.toLowerCase();
    for (var i = 0; i < RISK_KEYWORDS.length; i++) {
      if (lower.indexOf(RISK_KEYWORDS[i]) !== -1) {
        return {
          detected: true,
          triggerType: 'RISK_LEXICON',
          matchedTerm: RISK_KEYWORDS[i]
        };
      }
    }
    return { detected: false };
  }

  function evaluatePHQ9Item9(item9Score) {
    var score = parseInt(item9Score, 10);
    if (!isNaN(score) && score >= 1) {
      return {
        detected: true,
        triggerType: 'PHQ9_ITEM9',
        score: score
      };
    }
    return { detected: false };
  }

  function evaluateScreeningThresholds(type, scoreMap) {
    var detected = false;
    var reason = "";

    if (type === 'PHQ9' && scoreMap.total >= CONFIG.RISK_THRESHOLD_CONFIG.PHQ9_SEVERE) {
      detected = true;
      reason = "PHQ-9 Severe Score (" + scoreMap.total + ")";
    } else if (type === 'GAD7' && scoreMap.total >= CONFIG.RISK_THRESHOLD_CONFIG.GAD7_SEVERE) {
      detected = true;
      reason = "GAD-7 Severe Score (" + scoreMap.total + ")";
    }

    return {
      detected: detected,
      triggerType: 'SCREENING_THRESHOLD',
      reason: reason
    };
  }

  function raiseRiskFlag(studentId, sessionId, triggerType, triggerValue, userContext) {
    var payload = {
      student_id: studentId,
      session_id: sessionId || null,
      trigger_type: triggerType,
      trigger_value: String(triggerValue),
      severity: 'HIGH',
      status: 'PENDING'
    };

    var res = Database.insert('risk_flags', payload, userContext);
    AuditLog.record(
      userContext ? userContext.id : null,
      'RISK_FLAG_RAISED',
      'risk_flags',
      res.success && res.data && res.data.length ? res.data[0].id : null,
      { triggerType: triggerType, severity: 'HIGH' }
    );
    
    if (sessionId && res.success) {
      Database.update('chat_sessions', 'id=eq.' + encodeURIComponent(String(sessionId)), { risk_flag: true }, userContext);
    }

    return res;
  }

  return {
    checkChatMessage: function(studentId, sessionId, messageText, userContext) {
      var lexResult = evaluateLexicon(messageText);
      if (lexResult.detected) {
        var flagResult = raiseRiskFlag(studentId, sessionId, lexResult.triggerType, lexResult.matchedTerm, userContext);
        return {
          riskDetected: true,
          queued: flagResult.success && flagResult.data && flagResult.data.length > 0,
          crisisResources: CONFIG.CRISIS_RESOURCES
        };
      }
      return { riskDetected: false };
    },
    checkAssessment: function(studentId, type, answers, scoreMap, userContext) {
      var riskTriggered = false;

      if (type === 'PHQ9' && answers['9'] !== undefined) {
        var item9Res = evaluatePHQ9Item9(answers['9']);
        if (item9Res.detected) {
          raiseRiskFlag(studentId, null, item9Res.triggerType, "Item 9 Score: " + item9Res.score, userContext);
          riskTriggered = true;
        }
      }

      var threshRes = evaluateScreeningThresholds(type, scoreMap);
      if (threshRes.detected) {
        raiseRiskFlag(studentId, null, threshRes.triggerType, threshRes.reason, userContext);
        riskTriggered = true;
      }

      return { riskDetected: riskTriggered, crisisResources: riskTriggered ? CONFIG.CRISIS_RESOURCES : null };
    }
  };
})();