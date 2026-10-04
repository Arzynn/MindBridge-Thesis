function getPendingAIReviews(sessionToken) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  return getPendingAIReviews_(user.id);
}

function getPendingAIReviews_(counselorUserId) {
  var context = { id: counselorUserId, role: 'COUNSELOR' };
  var res = Database.select(
    'ai_responses',
    'status=eq.PENDING&select=id,session_id,message_id,created_at,ai_response,model_name&order=created_at.asc&limit=100',
    context
  );

  if (!res.success) {
    return { success: false, error: res.error || 'Unable to load reviews.' };
  }

  var items = res.data || [];
  var messageIds = Array.from(new Set(items.map(function(item) { return item.message_id; }).filter(Boolean)));
  var sessionIds = Array.from(new Set(items.map(function(item) { return item.session_id; }).filter(Boolean)));
  var messageMap = {};
  var sessionMap = {};
  var profileMap = {};

  if (messageIds.length) {
    var messages = Database.select(
      'chat_messages',
      'id=in.(' + messageIds.map(encodeURIComponent).join(',') + ')&select=id,message,created_at',
      context
    );
    if (!messages.success) return { success: false, error: 'Unable to load student messages for review.' };
    (messages.data || []).forEach(function(message) { messageMap[message.id] = message; });
  }
  if (sessionIds.length) {
    var sessions = Database.select(
      'chat_sessions',
      'id=in.(' + sessionIds.map(encodeURIComponent).join(',') + ')&select=id,student_id',
      context
    );
    if (!sessions.success) return { success: false, error: 'Unable to load student identities for review.' };
    (sessions.data || []).forEach(function(session) { sessionMap[session.id] = session; });

    var profileIds = Array.from(new Set((sessions.data || []).map(function(session) { return session.student_id; }).filter(Boolean)));
    if (profileIds.length) {
      var profiles = Database.select(
        'student_profiles',
        'id=in.(' + profileIds.map(encodeURIComponent).join(',') + ')&select=id,student_number,first_name,last_name',
        context
      );
      if (!profiles.success) return { success: false, error: 'Unable to load student identifiers for review.' };
      (profiles.data || []).forEach(function(profile) { profileMap[profile.id] = profile; });
    }
  }

  return {
    success: true,
    data: items.map(function(item) {
      var session = sessionMap[item.session_id];
      item.student_message = messageMap[item.message_id] || null;
      item.student = session ? (profileMap[session.student_id] || null) : null;
      return item;
    }),
    limit: 100
  };
}

function getPendingRiskFlags(sessionToken) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var context = { id: user.id, role: 'COUNSELOR' };
  var result = Database.select(
    'risk_flags',
    'status=eq.PENDING&session_id=not.is.null&select=id,student_id,trigger_type,trigger_value,severity,priority,created_at,student_profiles(student_number)&order=created_at.desc&limit=100',
    context
  );
  if (!result.success) {
    return { success: false, error: 'Unable to load pending risk notifications.' };
  }
  return { success: true, data: result.data || [] };
}

function processRiskFlagReview(sessionToken, riskFlagId, status, expectedStatus) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  expectedStatus = expectedStatus || 'PENDING';
  var transitions = {
    PENDING: ['REVIEWED', 'FOLLOW_UP', 'CLOSED'],
    REVIEWED: ['FOLLOW_UP', 'CLOSED'],
    FOLLOW_UP: ['CLOSED']
  };
  if (typeof riskFlagId !== 'string' || !riskFlagId ||
      !transitions[expectedStatus] ||
      transitions[expectedStatus].indexOf(status) === -1) {
    return { success: false, error: 'The risk review action is invalid.' };
  }

  var context = { id: user.id, role: 'COUNSELOR' };
  var updateResult = Database.update(
    'risk_flags',
    'id=eq.' + encodeURIComponent(riskFlagId) + '&status=eq.' + encodeURIComponent(expectedStatus),
    { status: status },
    context
  );
  if (!updateResult.success || !updateResult.data || !updateResult.data.length) {
    return { success: false, error: 'Unable to update this risk notification. It may already have been reviewed.' };
  }
  AuditLog.record(user.id, 'RISK_FLAG_REVIEWED', 'risk_flags', riskFlagId, { status: status });
  return { success: true };
}

function processCounselorReview(sessionToken, aiResponseId, action, editedResponse, comment) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  return processCounselorReview_(user.id, aiResponseId, action, editedResponse, comment);
}

function processCounselorReview_(counselorUserId, aiResponseId, action, editedResponse, comment) {
  var allowedActions = ['APPROVED', 'EDITED', 'REJECTED'];
  if (!aiResponseId || typeof aiResponseId !== 'string' ||
      allowedActions.indexOf(action) === -1 ||
      (action === 'EDITED' && (typeof editedResponse !== 'string' || !editedResponse.trim() || editedResponse.length > 10000))) {
    return { success: false, error: 'The review action or response is invalid.' };
  }
  var context = { id: counselorUserId, role: 'COUNSELOR' };

  var aiRes = Database.select('ai_responses', 'id=eq.' + encodeURIComponent(aiResponseId) + '&status=eq.PENDING', context);
  if (!aiRes.success || !aiRes.data || aiRes.data.length === 0) {
    return { success: false, error: 'AI Response staging entry not found.' };
  }
  var draftRecord = aiRes.data[0];
  if (draftRecord.model_name === 'AI_UNAVAILABLE' && action === 'APPROVED') {
    return { success: false, error: 'No automated draft exists. Write a counselor response and choose Approve with Edits.' };
  }
  if ((action === 'APPROVED' || action === 'EDITED') && !draftRecord.message_id) {
    return { success: false, error: 'The original student message is not linked to this review. Sending a response is blocked until the record is repaired.' };
  }

  var reviewPayload = {
    ai_response_id: aiResponseId,
    counselor_id: counselorUserId,
    action: action,
    original_response: draftRecord.ai_response,
    edited_response: action === 'EDITED' ? editedResponse : null,
    review_comment: comment || null
  };
  var responseSaved = false;
  if (action === 'APPROVED' || action === 'EDITED') {
    var finalMessageText = (action === 'EDITED') ? editedResponse : draftRecord.ai_response;
    if (typeof finalMessageText !== 'string' || !finalMessageText.trim()) {
      return { success: false, error: 'A non-empty counselor response is required before sending.' };
    }

    var messageResult = Database.insert('chat_messages', {
      session_id: draftRecord.session_id,
      sender: 'COUNSELOR',
      message: finalMessageText
    }, context);
    if (!messageResult.success || !messageResult.data || !messageResult.data.length) {
      return { success: false, error: 'The counselor response could not be saved or delivered.' };
    }
    responseSaved = true;
  } else if (action === 'REJECTED') {
    var rejectionResult = Database.insert('chat_messages', {
      session_id: draftRecord.session_id,
      sender: 'SYSTEM',
      message: 'The guidance office has updated the status of your request. Please contact the Guidance Office directly if you still need support.'
    }, context);
    if (!rejectionResult.success || !rejectionResult.data || !rejectionResult.data.length) {
      return { success: false, error: 'The review was rejected, but the student could not be notified.' };
    }
    responseSaved = true;
  }

  var reviewResult = Database.insert('counselor_reviews', reviewPayload, context);
  if (!reviewResult.success || !reviewResult.data || !reviewResult.data.length) {
    return {
      success: false,
      delivered: responseSaved,
      error: responseSaved
        ? 'The response was saved to the conversation, but the review record could not be saved. Do not retry sending; refresh the queue and contact an administrator.'
        : 'Unable to save the counselor review.'
    };
  }

  var statusResult = Database.update('ai_responses', 'id=eq.' + encodeURIComponent(aiResponseId) + '&status=eq.PENDING', { status: action }, context);
  if (!statusResult.success || !statusResult.data || !statusResult.data.length) {
    return {
      success: false,
      delivered: responseSaved,
      error: responseSaved
        ? 'The response was saved to the conversation, but its review status could not be updated. Do not retry sending; refresh the queue and contact an administrator.'
        : 'Unable to update the review status.'
    };
  }

  if (action === 'APPROVED' || action === 'EDITED') {
    var sessionResult = Database.update('chat_sessions', 'id=eq.' + encodeURIComponent(draftRecord.session_id), { status: 'ACTIVE' }, context);
    if (!sessionResult.success || !sessionResult.data || !sessionResult.data.length) {
      return { success: false, error: 'The response was delivered, but the chat session could not be reopened.' };
    }
  }

  AuditLog.record(counselorUserId, 'COUNSELOR_REVIEW_COMPLETED', 'ai_responses', aiResponseId, { action: action });

  return { success: true, delivered: responseSaved };
}