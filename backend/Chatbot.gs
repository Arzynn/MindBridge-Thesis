function getOrCreateActiveSession(sessionToken) {
  var user = getAuthenticatedUser_(sessionToken, 'STUDENT');
  return getOrCreateActiveSession_(user.id);
}

function getOrCreateActiveSession_(studentUserId) {
  var context = { id: studentUserId, role: 'STUDENT' };

  var profileRes = Database.select('student_profiles', 'user_id=eq.' + studentUserId + '&select=*', context);
  if (!profileRes.success || !profileRes.data || profileRes.data.length === 0) {
    return { success: false, error: 'Student profile not found.' };
  }

  var studentProfileId = profileRes.data[0].id;
  var existingSession = Database.select(
    'chat_sessions',
    'student_id=eq.' + studentProfileId + '&status=eq.ACTIVE&select=*&order=started_at.desc&limit=1',
    context
  );

  if (!existingSession.success) {
    return { success: false, error: 'Unable to load your active chat session.' };
  }

  if (existingSession.success && existingSession.data && existingSession.data.length > 0) {
    return { success: true, sessionId: existingSession.data[0].id, studentUserId: studentUserId };
  }

  var createdSession = Database.insert('chat_sessions', {
    student_id: studentProfileId,
    status: 'ACTIVE',
    risk_flag: false
  }, context);

  if (!createdSession.success || !createdSession.data || createdSession.data.length === 0) {
    return { success: false, error: 'Unable to create an active chat session.' };
  }

  return { success: true, sessionId: createdSession.data[0].id, studentUserId: studentUserId };
}

function processStudentMessage(sessionToken, sessionId, messageText) {
  var user = getAuthenticatedUser_(sessionToken, 'STUDENT');
  return processStudentMessage_(user.id, sessionId, messageText);
}

function processStudentMessage_(studentUserId, sessionId, messageText) {
  var userContext = { id: studentUserId, role: 'STUDENT' };
  var message = typeof messageText === 'string' ? messageText.trim() : '';
  if (!message || message.length > 2000 || !sessionId) {
    return { status: 'ERROR', message: 'Please enter a message of no more than 2,000 characters.' };
  }

  if (!ScopeControl.isWithinScope(message)) {
    return {
      status: 'OUT_OF_SCOPE',
      message: ScopeControl.getFallbackResponse()
    };
  }

  var profRes = Database.select('student_profiles', 'user_id=eq.' + studentUserId, userContext);
  if (!profRes.success || profRes.data.length === 0) {
    return { status: 'ERROR', message: 'Student profile not found.' };
  }
  var studentProfileId = profRes.data[0].id;

  var sessionRes = Database.select(
    'chat_sessions',
    'id=eq.' + encodeURIComponent(String(sessionId)) + '&student_id=eq.' + encodeURIComponent(String(studentProfileId)) + '&select=id',
    userContext
  );
  if (!sessionRes.success || !sessionRes.data || sessionRes.data.length === 0) {
    return { status: 'ERROR', message: 'The requested chat session is not available.' };
  }

  var msgPayload = {
    session_id: sessionId,
    sender: 'STUDENT',
    message: message
  };
  var savedMsg = Database.insert('chat_messages', msgPayload, userContext);
  if (!savedMsg.success || !savedMsg.data || savedMsg.data.length === 0) {
    return { status: 'ERROR', message: 'Unable to save student message.' };
  }
  var messageId = savedMsg.data[0].id;

  var riskResult = RiskDetection.checkChatMessage(studentProfileId, sessionId, message, userContext);
  if (riskResult.riskDetected) {
    if (!riskResult.queued) {
      return {
        status: 'ERROR',
        crisisResources: riskResult.crisisResources,
        message: 'A risk indicator was detected, but the counselor notification could not be saved. Please contact the Guidance Office directly. If you are in immediate danger, contact local emergency services.'
      };
    }
    var riskSessionUpdate = Database.update('chat_sessions', 'id=eq.' + encodeURIComponent(String(sessionId)), { status: 'WAITING_COUNSELOR' }, userContext);
    if (!riskSessionUpdate.success) {
      return {
        status: 'ERROR',
        crisisResources: riskResult.crisisResources,
        message: 'A risk notification was saved for counselor review, but the chat session could not be updated. Please contact the Guidance Office directly.'
      };
    }
    return {
      status: 'RISK_DETECTED',
      crisisResources: riskResult.crisisResources,
      message: 'A risk notification was added to the counselor review queue. Below are support contacts; this online queue is not an emergency service.'
    };
  }

  var guidanceContext = GuidanceRetrieval.getRelevantGuidance(message, userContext);

  var aiResult = AIService.generateDraft(message, guidanceContext);
  if (!aiResult.success) {
    var fallbackQueue = Database.insert('ai_responses', {
      session_id: sessionId,
      message_id: messageId,
      ai_response: '',
      model_name: 'AI_UNAVAILABLE',
      status: 'PENDING'
    }, userContext);
    if (!fallbackQueue.success || !fallbackQueue.data || fallbackQueue.data.length === 0) {
      return {
        status: 'ERROR',
        message: 'Your message was saved, but the counselor review queue is unavailable. Please contact the Guidance Office directly.'
      };
    }
    var fallbackSessionUpdate = Database.update('chat_sessions', 'id=eq.' + encodeURIComponent(String(sessionId)), { status: 'WAITING_COUNSELOR' }, userContext);
    if (!fallbackSessionUpdate.success) {
      return {
        status: 'ERROR',
        message: 'Your message is in the counselor review queue, but the chat status could not be updated. Please contact the Guidance Office if you need immediate assistance.'
      };
    }
    Logger.log('AI draft unavailable; queued for counselor review. Failure code: ' + (aiResult.code || 'UNSPECIFIED') + '.');
    AuditLog.record(studentUserId, 'AI_UNAVAILABLE_QUEUED', 'ai_responses', fallbackQueue.data[0].id, {
      failureCode: aiResult.code || 'UNSPECIFIED'
    });
    return {
      status: 'WAITING_FOR_REVIEW',
      message: 'Automated response is temporarily unavailable. Your message has been saved and placed in the counselor review queue.'
    };
  }

  var aiResponsePayload = {
    session_id: sessionId,
    message_id: messageId,
    ai_response: aiResult.draft,
    model_name: aiResult.model,
    status: 'PENDING'
  };
  var stagedResponse = Database.insert('ai_responses', aiResponsePayload, userContext);
  if (!stagedResponse.success || !stagedResponse.data || stagedResponse.data.length === 0) {
    return { status: 'ERROR', message: 'Your message was saved, but the counselor review could not be queued. Please contact the guidance office directly.' };
  }

  var sessionUpdate = Database.update('chat_sessions', 'id=eq.' + encodeURIComponent(String(sessionId)), { status: 'WAITING_COUNSELOR' }, userContext);
  if (!sessionUpdate.success) {
    return { status: 'ERROR', message: 'Your message was saved, but the counselor queue could not be updated. Please contact the guidance office directly.' };
  }

  AuditLog.record(studentUserId, 'AI_DRAFT_STAGED', 'ai_responses', stagedResponse.data[0].id, {});

  return {
    status: 'WAITING_FOR_REVIEW',
    message: "Thank you for reaching out. Your counselor is reviewing the response and will connect with you shortly."
  };
}