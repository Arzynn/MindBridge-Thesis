var CONFIG = {
  AI_PROVIDER: 'GEMINI',
  AI_MODEL: 'gemini-1.5-flash',
  MAX_OUTPUT_TOKENS: 350,
  APP_TITLE: 'MindBridge Student Wellness Support',
  OUT_OF_SCOPE_FALLBACK: 'MindBridge is designed specifically to support student mental wellness concerns. For academic, technical, or administrative questions, please consult your department office or student advisor.',
  RISK_THRESHOLD_CONFIG: {
    PHQ9_SEVERE: 15,
    GAD7_SEVERE: 15
  },
  DASS21_REVIEW_POLICY: {
    depression: { mild: 10, moderate: 14, severe: 21, extremelySevere: 28 },
    anxiety: { mild: 8, moderate: 10, severe: 15, extremelySevere: 20 },
    stress: { mild: 15, moderate: 19, severe: 26, extremelySevere: 34 },
    reviewRequiredAbove: 'NORMAL',
    priorityAtOrAbove: 'SEVERE'
  },
  CRISIS_RESOURCES: {
    INSTITUTIONAL_HOTLINE: 'Guidance Office Hotline: Local 104 / 0917-000-0000',
    NATIONAL_CRISIS_LINE: 'National Center for Mental Health: 1553 (Toll-Free)',
    EMERGENCY_SERVICES: 'National Emergency Response: 911'
  }
};

function doGet(e) {
  var requestedPage = e && e.parameter ? String(e.parameter.page || '').trim() : '';
  var routes = {
    login: { file: 'StudentLogin', bodyClass: '' },
    student: { file: 'StudentDashboard', bodyClass: 'student-portal-page', student: true },
    'student-dashboard': { file: 'StudentDashboard', bodyClass: 'student-portal-page', student: true },
    screening: { file: 'StudentScreening', bodyClass: 'student-portal-page', student: true },
    progress: { file: 'StudentProgress', bodyClass: 'student-portal-page', student: true },
    resources: { file: 'StudentResources', bodyClass: 'student-portal-page', student: true },
    profile: { file: 'StudentProfile', bodyClass: 'student-portal-page', student: true },
    chatbot: { file: 'StudentChatbot', bodyClass: 'student-portal-page p-3', student: true },
    register: { file: 'StudentRegister', bodyClass: '' },
    counselor_login: { file: 'CounselorLogin', bodyClass: '' },
    counselor: { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-students': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-student': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-screenings': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-risks': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-followups': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-reports': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-resources': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-profile': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-settings': { file: 'CounselorPortal', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-reviews': { file: 'CounselorReviews', bodyClass: 'counselor-portal-page', counselor: true },
    'counselor-register': { file: 'CounselorRegister', bodyClass: '' }
  };
  var route = Object.prototype.hasOwnProperty.call(routes, requestedPage)
    ? routes[requestedPage]
    : routes.login;
  var template = HtmlService.createTemplateFromFile('Index');
  template.pageFile = route.file;
  template.pageBodyClass = route.bodyClass;
  template.pageKey = requestedPage || 'login';
  template.isStudentPage = route.student === true;
  template.isCounselorPage = route.counselor === true;
  template.webAppUrl = ScriptApp.getService().getUrl() || '';

  return template.evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getStudentPortalData(sessionToken, section) {
  var user = getAuthenticatedUser_(sessionToken, 'STUDENT');
  var validSections = ['dashboard', 'screening', 'progress', 'profile', 'resources'];
  if (validSections.indexOf(section) === -1) {
    return { success: false, error: 'The requested student page is not available.' };
  }

  var context = { id: user.id, role: 'STUDENT' };
  var profileResult = Database.select(
    'student_profiles',
    'user_id=eq.' + encodeURIComponent(user.id) +
      '&select=id,student_number,first_name,last_name,course,year_level&limit=1',
    context
  );
  if (!profileResult.success) {
    return { success: false, error: 'Unable to load your student profile.' };
  }
  if (!profileResult.data || profileResult.data.length !== 1) {
    return { success: false, error: 'Your student profile could not be found.' };
  }

  var profile = profileResult.data[0];
  var result = {
    success: true,
    section: section,
    profile: {
      name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || user.name || '',
      email: user.email,
      studentNumber: profile.student_number,
      course: profile.course,
      yearLevel: profile.year_level,
      role: user.role
    }
  };

  if (section === 'dashboard' || section === 'screening' || section === 'progress') {
    var assessmentResult = Database.select(
      'assessments',
      'student_id=eq.' + encodeURIComponent(String(profile.id)) +
        '&select=id,type,created_at&order=created_at.desc&limit=100',
      context
    );
    if (!assessmentResult.success) {
      return { success: false, error: 'Unable to load your screening history.' };
    }

    var assessments = assessmentResult.data || [];
    var now = new Date();
    var rollingWindowStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    var thisWeekCount = assessments.filter(function(assessment) {
      var createdAt = new Date(assessment.created_at).getTime();
      return assessment.type === 'DASS21' &&
        createdAt >= rollingWindowStart && createdAt <= now.getTime();
    }).length;

    result.assessments = assessments;
    result.thisWeekCount = thisWeekCount;
    result.assessmentLimit = 100;
  }

  if (section === 'resources') {
    var guidanceResult = Database.select(
      'approved_guidance',
      'status=eq.APPROVED&select=id,topic,content,created_at&order=created_at.desc&limit=50',
      context
    );
    if (!guidanceResult.success) {
      return { success: false, error: 'Unable to load counselor-approved resources.' };
    }
    result.resources = guidanceResult.data || [];
    result.crisisResources = CONFIG.CRISIS_RESOURCES;
  }

  return result;
}

function getDASS21ScreeningConfig(sessionToken) {
  getAuthenticatedUser_(sessionToken, 'STUDENT');
  var properties = PropertiesService.getScriptProperties();
  var consentText = properties.getProperty('DASS21_CONSENT_TEXT') || '';
  var policyApproved = properties.getProperty('DASS21_REVIEW_POLICY_APPROVED') === 'true';
  return {
    success: true,
    submissionEnabled: Boolean(consentText.trim()) && policyApproved,
    consentText: consentText,
    policyApproved: policyApproved,
    periodLabel: 'one screening per rolling seven-day period',
    message: !consentText.trim()
      ? 'Screening submission is not enabled because institution-approved consent text has not been configured.'
      : !policyApproved
        ? 'Screening submission is not enabled until the review rules are approved by the licensed counselor and research adviser.'
        : ''
  };
}

function getCurrentRollingScreeningWindow_() {
  var end = new Date();
  return {
    start: new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000),
    end: end
  };
}

function getProjectDateBoundary_(dateText, includeDayAfter) {
  var parts = dateText.split('-').map(Number);
  var dateAtUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]) +
    (includeDayAfter ? 86400000 : 0);
  var timezone = Session.getScriptTimeZone();
  var offset = Utilities.formatDate(new Date(dateAtUtc), timezone, 'Z')
    .match(/^([+-])(\d{2})(\d{2})$/);
  var offsetMs = offset
    ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000
    : 0;
  return new Date(dateAtUtc - offsetMs).toISOString();
}

function getCounselorDashboardData(sessionToken) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var context = { id: user.id, role: 'COUNSELOR' };
  var week = getCurrentRollingScreeningWindow_();
  var counts = {
    students: Database.countRows('users', 'role=eq.STUDENT&status=eq.ACTIVE', context),
    screenedThisWeek: Database.countRows('assessments', 'type=eq.DASS21&created_at=gte.' + encodeURIComponent(week.start.toISOString()) + '&created_at=lt.' + encodeURIComponent(week.end.toISOString()), context),
    screeningReviews: Database.countRows('assessments', 'type=eq.DASS21&review_status=eq.PENDING', context),
    priorityScreeningReviews: Database.countRows('risk_flags', 'trigger_type=eq.SCREENING_THRESHOLD&priority=eq.PRIORITY&status=eq.PENDING', context),
    reviewedScreenings: Database.countRows('assessments', 'type=eq.DASS21&review_status=eq.REVIEWED', context),
    pendingRisks: Database.countRows('risk_flags', 'status=eq.PENDING', context),
    pendingAIReviews: Database.countRows('ai_responses', 'status=eq.PENDING', context),
    followUps: Database.countRows('assessments', 'type=eq.DASS21&review_status=eq.FOLLOW_UP', context)
  };
  var metricValues = {};
  Object.keys(counts).forEach(function(key) {
    if (!counts[key].success) {
      throw new Error('Unable to load counselor dashboard metrics.');
    }
    metricValues[key] = counts[key].count;
  });

  var recent = Database.select(
    'risk_flags',
    'trigger_type=eq.SCREENING_THRESHOLD&status=in.(PENDING,FOLLOW_UP)&select=id,student_id,trigger_type,severity,status,priority,created_at&order=created_at.desc&limit=10',
    context
  );
  if (!recent.success) {
    throw new Error('Unable to load recent counselor alerts.');
  }
  return {
    success: true,
    counselor: { name: user.name || '', email: user.email || '', role: user.role },
    period: { start: week.start.toISOString(), end: week.end.toISOString(), label: 'Rolling seven days' },
    counts: metricValues,
    recentAlerts: recent.data || []
  };
}

function getCurrentMonitoringWeek_() {
  var timezone = Session.getScriptTimeZone();
  var localDate = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd').split('-').map(Number);
  var dateAtUtc = Date.UTC(localDate[0], localDate[1] - 1, localDate[2]);
  var weekday = new Date(dateAtUtc).getUTCDay();
  var mondayAtUtc = dateAtUtc - ((weekday + 6) % 7) * 86400000;
  var now = new Date();
  var offset = Utilities.formatDate(now, timezone, 'Z').match(/^([+-])(\d{2})(\d{2})$/);
  var offsetMs = offset
    ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000
    : 0;
  return {
    start: new Date(mondayAtUtc - offsetMs).toISOString(),
    end: new Date(mondayAtUtc + 7 * 86400000 - offsetMs).toISOString()
  };
}

function getCounselorStudents(sessionToken, searchText) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var context = { id: user.id, role: 'COUNSELOR' };
  var query = 'select=id,user_id,student_number,first_name,last_name,course,year_level&order=last_name.asc&limit=500';
  if (searchText !== undefined && searchText !== null && String(searchText).trim()) {
    var search = String(searchText).trim().slice(0, 80).replace(/[^a-zA-Z0-9 _.-]/g, ' ');
    query += '&or=' + encodeURIComponent(
      '(student_number.ilike.*' + search + '*,first_name.ilike.*' + search + '*,last_name.ilike.*' + search + '*,course.ilike.*' + search + '*)'
    );
  }
  var result = Database.select('student_profiles', query, context);
  if (!result.success) {
    return { success: false, error: 'Unable to load student records.' };
  }
  var profiles = result.data || [];
  var userIds = Array.from(new Set(profiles.map(function(profile) { return profile.user_id; }).filter(Boolean)));
  if (!userIds.length) return { success: true, data: [], limit: 500 };
  var accounts = Database.select(
    'users',
    'id=in.(' + userIds.map(encodeURIComponent).join(',') + ')&select=id,role,status',
    context
  );
  if (!accounts.success) return { success: false, error: 'Unable to load student account statuses.' };
  var accountMap = {};
  (accounts.data || []).forEach(function(account) { accountMap[account.id] = account; });
  return {
    success: true,
    data: profiles.filter(function(profile) {
      return accountMap[profile.user_id] &&
        String(accountMap[profile.user_id].role || '').toUpperCase() === 'STUDENT';
    }).map(function(profile) {
      profile.accountStatus = accountMap[profile.user_id].status || '';
      return profile;
    }),
    limit: 500
  };
}

function getCounselorStudentRecord(sessionToken, studentProfileId) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  if (!studentProfileId || typeof studentProfileId !== 'string') {
    return { success: false, error: 'A valid student record is required.' };
  }
  var context = { id: user.id, role: 'COUNSELOR' };
  var profileResult = Database.select(
    'student_profiles',
    'id=eq.' + encodeURIComponent(studentProfileId) + '&select=id,user_id,student_number,first_name,last_name,course,year_level&limit=1',
    context
  );
  if (!profileResult.success || !profileResult.data || profileResult.data.length !== 1) {
    return { success: false, error: 'Unable to find that student record.' };
  }
  var profile = profileResult.data[0];
  var accountResult = Database.select(
    'users',
    'id=eq.' + encodeURIComponent(profile.user_id) + '&select=id,email,status,role,created_at&limit=1',
    context
  );
  var assessments = Database.select(
    'assessments',
    'student_id=eq.' + encodeURIComponent(profile.id) + '&select=id,type,total_score,severity,created_at,depression_score,anxiety_score,stress_score,depression_severity,anxiety_severity,stress_severity,review_status&order=created_at.desc&limit=100',
    context
  );
  var risks = Database.select(
    'risk_flags',
    'student_id=eq.' + encodeURIComponent(profile.id) + '&select=id,trigger_type,severity,status,created_at&order=created_at.desc&limit=100',
    context
  );
  if (!accountResult.success || !assessments.success || !risks.success) {
    return { success: false, error: 'Unable to load this student record.' };
  }
  if (!accountResult.data || accountResult.data.length !== 1 ||
      String(accountResult.data[0].role || '').toUpperCase() !== 'STUDENT') {
    return { success: false, error: 'The requested profile is not linked to a student account.' };
  }
  return {
    success: true,
    profile: profile,
    account: accountResult.data[0],
    assessments: (assessments.data || []).map(function(assessment) {
      if (assessment.type === 'DASS21') {
        assessment.subscales = {
          depression: { score: assessment.depression_score, severity: assessment.depression_severity },
          anxiety: { score: assessment.anxiety_score, severity: assessment.anxiety_severity },
          stress: { score: assessment.stress_score, severity: assessment.stress_severity }
        };
      }
      return assessment;
    }),
    riskFlags: risks.data || []
  };
}

function getCounselorScreenings(sessionToken, filters) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var context = { id: user.id, role: 'COUNSELOR' };
  filters = filters && typeof filters === 'object' ? filters : {};
  var allowedStatuses = ['POLICY_PENDING', 'PENDING', 'REVIEWED', 'FOLLOW_UP', 'CLOSED', 'NOT_REQUIRED'];
  if (filters.reviewStatus && allowedStatuses.indexOf(filters.reviewStatus) === -1) {
    return { success: false, error: 'The screening review status filter is invalid.' };
  }
  if (filters.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(filters.fromDate)) {
    return { success: false, error: 'The screening start date is invalid.' };
  }
  if (filters.toDate && !/^\d{4}-\d{2}-\d{2}$/.test(filters.toDate)) {
    return { success: false, error: 'The screening end date is invalid.' };
  }
  if (filters.priority && ['NONE', 'ROUTINE', 'PRIORITY'].indexOf(filters.priority) === -1) {
    return { success: false, error: 'The screening priority filter is invalid.' };
  }
  var assessmentQuery = 'type=eq.DASS21&select=id,student_id,type,created_at,depression_score,anxiety_score,stress_score,depression_severity,anxiety_severity,stress_severity,review_status,reviewed_at,reviewed_by&order=created_at.desc&limit=200';
  if (filters.reviewStatus) assessmentQuery = 'review_status=eq.' + encodeURIComponent(filters.reviewStatus) + '&' + assessmentQuery;
  if (filters.fromDate) assessmentQuery = 'created_at=gte.' + encodeURIComponent(getProjectDateBoundary_(filters.fromDate, false)) + '&' + assessmentQuery;
  if (filters.toDate) assessmentQuery = 'created_at=lt.' + encodeURIComponent(getProjectDateBoundary_(filters.toDate, true)) + '&' + assessmentQuery;
  var assessments = Database.select(
    'assessments',
    assessmentQuery,
    context
  );
  if (!assessments.success) {
    return { success: false, error: 'Unable to load screening records.' };
  }
  var rows = assessments.data || [];
  rows.forEach(function(row) {
    var scores = [
      row.depression_score,
      row.anxiety_score,
      row.stress_score
    ];
    var bands = [
      row.depression_severity,
      row.anxiety_severity,
      row.stress_severity
    ];
    row.priority = bands.some(function(band) {
      return band === 'SEVERE' || band === 'EXTREMELY SEVERE';
    }) ? 'PRIORITY' : bands.some(function(band) {
      return band && band !== 'NORMAL';
    }) ? 'ROUTINE' : 'NONE';
    row.subscales = {
      depression: { score: scores[0], severity: bands[0] },
      anxiety: { score: scores[1], severity: bands[1] },
      stress: { score: scores[2], severity: bands[2] }
    };
  });
  if (filters.priority) {
    rows = rows.filter(function(row) { return row.priority === filters.priority; });
  }
  var profileIds = Array.from(new Set(rows.map(function(row) { return row.student_id; }).filter(Boolean)));
  var profileMap = {};
  if (profileIds.length) {
    var profiles = Database.select(
      'student_profiles',
      'id=in.(' + profileIds.map(encodeURIComponent).join(',') + ')&select=id,student_number,first_name,last_name',
      context
    );
    if (!profiles.success) {
      return { success: false, error: 'Unable to load screening student identifiers.' };
    }
    (profiles.data || []).forEach(function(profile) { profileMap[profile.id] = profile; });
  }
  var assessmentIds = rows.map(function(row) { return row.id; }).filter(Boolean);
  var answerMap = {};
  if (assessmentIds.length) {
    var answers = Database.select(
      'assessment_answers',
      'assessment_id=in.(' + assessmentIds.map(encodeURIComponent).join(',') + ')&select=id,assessment_id,question_number,answer,score&order=question_number.asc',
      context
    );
    if (!answers.success) return { success: false, error: 'Unable to load screening responses.' };
    (answers.data || []).forEach(function(answer) {
      if (!answerMap[answer.assessment_id]) answerMap[answer.assessment_id] = [];
      answerMap[answer.assessment_id].push({
        questionNumber: answer.question_number,
        answer: answer.answer,
        score: answer.score
      });
    });
  }
  return {
    success: true,
    data: rows.map(function(row) {
      row.student = profileMap[row.student_id] || null;
      row.answers = answerMap[row.id] || [];
      return row;
    }),
    limit: 200,
    reviewTrackingAvailable: true
  };
}

function processDASS21ScreeningReview(sessionToken, assessmentId, nextStatus) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  if (!assessmentId || typeof assessmentId !== 'string') {
    return { success: false, error: 'A valid screening record is required.' };
  }
  var transitions = {
    PENDING: ['REVIEWED', 'FOLLOW_UP'],
    REVIEWED: ['FOLLOW_UP', 'CLOSED'],
    FOLLOW_UP: ['CLOSED']
  };
  var context = { id: user.id, role: 'COUNSELOR' };
  var existing = Database.select(
    'assessments',
    'id=eq.' + encodeURIComponent(assessmentId) + '&type=eq.DASS21&select=id,review_status&limit=1',
    context
  );
  if (!existing.success || !existing.data || existing.data.length !== 1) {
    return { success: false, error: 'DASS-21 screening record not found.' };
  }
  var currentStatus = existing.data[0].review_status;
  if (!transitions[currentStatus] || transitions[currentStatus].indexOf(nextStatus) === -1) {
    return { success: false, error: 'This screening review transition is not allowed.' };
  }
  var updated = Database.update(
    'assessments',
    'id=eq.' + encodeURIComponent(assessmentId) +
      '&review_status=eq.' + encodeURIComponent(currentStatus),
    {
      review_status: nextStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString()
    },
    context
  );
  if (!updated.success || !updated.data || !updated.data.length) {
    return { success: false, error: 'Unable to save screening review status.' };
  }
  var flags = Database.update(
    'risk_flags',
    'assessment_id=eq.' + encodeURIComponent(assessmentId) +
      '&trigger_type=eq.SCREENING_THRESHOLD&status=eq.' + encodeURIComponent(currentStatus),
    { status: nextStatus },
    context
  );
  if (!flags.success || !flags.data || !flags.data.length) {
    return {
      success: false,
      partial: true,
      error: 'Screening review status was saved, but its counselor queue notification could not be synchronized. Contact the project administrator.'
    };
  }
  AuditLog.record(user.id, 'DASS21_SCREENING_REVIEWED', 'assessments', assessmentId, {
    from: currentStatus,
    to: nextStatus
  });
  return { success: true, status: nextStatus };
}

function getCounselorRiskFlags(sessionToken, status) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var validStatuses = ['PENDING', 'REVIEWED', 'FOLLOW_UP', 'CLOSED'];
  if (status && validStatuses.indexOf(status) === -1) {
    return { success: false, error: 'The risk status filter is invalid.' };
  }
  var context = { id: user.id, role: 'COUNSELOR' };
  var query = 'select=id,student_id,session_id,assessment_id,trigger_type,trigger_value,severity,priority,status,created_at&order=created_at.desc&limit=200';
  if (status) query = 'status=eq.' + encodeURIComponent(status) + '&' + query;
  var flags = Database.select('risk_flags', query, context);
  if (!flags.success) {
    return { success: false, error: 'Unable to load risk notifications.' };
  }
  var rows = flags.data || [];
  var profileIds = Array.from(new Set(rows.map(function(row) { return row.student_id; }).filter(Boolean)));
  if (profileIds.length) {
    var profiles = Database.select(
      'student_profiles',
      'id=in.(' + profileIds.map(encodeURIComponent).join(',') + ')&select=id,student_number,first_name,last_name',
      context
    );
    if (!profiles.success) {
      return { success: false, error: 'Unable to load risk notification student identifiers.' };
    }
    var profileMap = {};
    (profiles.data || []).forEach(function(profile) { profileMap[profile.id] = profile; });
    rows.forEach(function(row) { row.student = profileMap[row.student_id] || null; });
  }
  return { success: true, data: rows, limit: 200 };
}

function getCounselorResources(sessionToken) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var result = Database.select(
    'approved_guidance',
    'status=eq.APPROVED&select=id,topic,content,created_at&order=created_at.desc&limit=100',
    { id: user.id, role: 'COUNSELOR' }
  );
  if (!result.success) return { success: false, error: 'Unable to load approved wellness resources.' };
  return { success: true, data: result.data || [] };
}

function getCounselorReports(sessionToken) {
  var dashboard = getCounselorDashboardData(sessionToken);
  if (!dashboard.success) return dashboard;
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var context = { id: user.id, role: 'COUNSELOR' };
  var start = encodeURIComponent(dashboard.period.start);
  var end = encodeURIComponent(dashboard.period.end);
  var counts = {
    dassSubmissionsLastSevenDays: Database.countRows('assessments', 'type=eq.DASS21&created_at=gte.' + start + '&created_at=lte.' + end, context),
    pendingScreeningReviews: Database.countRows('assessments', 'type=eq.DASS21&review_status=eq.PENDING', context),
    priorityScreeningReviews: Database.countRows('risk_flags', 'trigger_type=eq.SCREENING_THRESHOLD&priority=eq.PRIORITY&status=eq.PENDING', context),
    reviewedScreenings: Database.countRows('assessments', 'type=eq.DASS21&review_status=eq.REVIEWED', context),
    pendingResponses: Database.countRows('ai_responses', 'status=eq.PENDING', context),
    completedResponses: Database.countRows('ai_responses', 'status=in.(APPROVED,EDITED)', context),
    rejectedResponses: Database.countRows('ai_responses', 'status=eq.REJECTED', context),
    pendingRisks: Database.countRows('risk_flags', 'status=eq.PENDING', context),
    followUps: Database.countRows('assessments', 'type=eq.DASS21&review_status=eq.FOLLOW_UP', context),
    completedFollowUps: Database.countRows('risk_flags', 'status=eq.CLOSED', context)
  };
  var values = {};
  Object.keys(counts).forEach(function(key) {
    if (!counts[key].success) throw new Error('Unable to load counselor report counts.');
    values[key] = counts[key].count;
  });
  var recentReviews = Database.select(
    'counselor_reviews',
    'counselor_id=eq.' + encodeURIComponent(user.id) + '&select=id,counselor_id,ai_response_id,action,created_at&order=created_at.desc&limit=100',
    context
  );
  if (!recentReviews.success) return { success: false, error: 'Unable to load counselor review history.' };
  var timezone = Session.getScriptTimeZone();
  var currentWeek = getCurrentMonitoringWeek_();
  var trendStart = new Date(new Date(currentWeek.start).getTime() - 7 * 7 * 86400000);
  var trendRows = Database.select(
    'assessments',
    'type=eq.DASS21&created_at=gte.' + encodeURIComponent(trendStart.toISOString()) +
      '&created_at=lt.' + encodeURIComponent(currentWeek.end) +
      '&select=created_at&order=created_at.asc&limit=5000',
    context
  );
  if (!trendRows.success) return { success: false, error: 'Unable to load weekly screening trends.' };
  var trend = [];
  for (var weekIndex = 7; weekIndex >= 0; weekIndex--) {
    var start = new Date(new Date(currentWeek.start).getTime() - weekIndex * 7 * 86400000);
    trend.push({
      weekStart: Utilities.formatDate(start, timezone, 'yyyy-MM-dd'),
      label: Utilities.formatDate(start, timezone, 'MMM d'),
      count: 0
    });
  }
  (trendRows.data || []).forEach(function(row) {
    var localDate = Utilities.formatDate(new Date(row.created_at), timezone, 'yyyy-MM-dd').split('-').map(Number);
    var localDateUtc = Date.UTC(localDate[0], localDate[1] - 1, localDate[2]);
    var weekday = new Date(localDateUtc).getUTCDay();
    var monday = new Date(localDateUtc - ((weekday + 6) % 7) * 86400000);
    var weekKey = monday.toISOString().slice(0, 10);
    var bucket = trend.find(function(item) { return item.weekStart === weekKey; });
    if (bucket) bucket.count++;
  });
  return {
    success: true,
    period: dashboard.period,
    counts: values,
    recentReviews: recentReviews.data || [],
    weeklyScreeningTrend: trend,
    screeningTrendTruncated: (trendRows.data || []).length === 5000
  };
}

function getCounselorProfile(sessionToken) {
  var user = getAuthenticatedUser_(sessionToken, 'COUNSELOR');
  var result = Database.select(
    'users',
    'id=eq.' + encodeURIComponent(user.id) + '&select=id,email,full_name,role,status,created_at&limit=1',
    { id: user.id, role: 'COUNSELOR' }
  );
  if (!result.success || !result.data || result.data.length !== 1) {
    return { success: false, error: 'Unable to load counselor profile.' };
  }
  return { success: true, profile: result.data[0] };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getRequiredScriptProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error('Missing required Apps Script property: ' + name);
  }
  return value;
}

function checkSupabaseConnection() {
  try {
    var result = Database.checkConnection();
    if (!result.success) {
      var failure = {
        success: false,
        status: result.status || null,
        code: result.code || null,
        error: result.error || 'Supabase request failed.'
      };
      Logger.log(JSON.stringify(failure));
      return failure;
    }
    var success = {
      success: true,
      status: result.status,
      message: 'Supabase connection succeeded.'
    };
    Logger.log(JSON.stringify(success));
    return success;
  } catch (error) {
    Logger.log('Supabase connection check could not run.');
    var failure = {
      success: false,
      status: null,
      error: 'Check the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY Script Properties.'
    };
    Logger.log(JSON.stringify(failure));
    return failure;
  }
}
