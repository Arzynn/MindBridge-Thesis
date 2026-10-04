const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'backend', 'Assessment.gs'),
  'utf8'
);
const policy = {
  depression: { mild: 10, moderate: 14, severe: 21, extremelySevere: 28 },
  anxiety: { mild: 8, moderate: 10, severe: 15, extremelySevere: 20 },
  stress: { mild: 15, moderate: 19, severe: 26, extremelySevere: 34 }
};

function makeAnswers(value) {
  return Object.fromEntries(Array.from({ length: 21 }, (_, index) => [String(index + 1), value]));
}

function loadAssessment(overrides) {
  const context = Object.assign({
    CONFIG: { DASS21_REVIEW_POLICY: policy },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: name => name === 'DASS21_CONSENT_TEXT' ? 'Approved consent' : 'true'
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
    },
    Logger: { log: () => {} },
    getCurrentRollingScreeningWindow_: () => ({
      start: new Date(Date.now() - 7 * 86400000),
      end: new Date()
    }),
    getAuthenticatedUser_: (token, role) => {
      if (token !== 'student-token' || role !== 'STUDENT') throw new Error('Unauthorized');
      return { id: 'student-user-id', role: 'STUDENT' };
    },
    Database: {
      select: (table, query) => {
        if (table === 'student_profiles') return { success: true, data: [{ id: 'student-profile-id' }] };
        if (table === 'assessments') return { success: true, data: [] };
        throw new Error('Unexpected select: ' + table + ' ' + query);
      },
      insert: (table, payload) => ({
        success: true,
        data: table === 'assessments' ? [{ id: 'assessment-id', created_at: new Date().toISOString() }] :
          payload.map(() => ({ id: 'answer-id' }))
      }),
      delete: () => ({ success: true, data: [] })
    },
    AuditLog: { record: () => {} }
  }, overrides || {});
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.Assessment;
}

test('DASS-21 item mappings score each assigned subscale independently', () => {
  const assessment = loadAssessment();
  for (const [subscale, questions] of Object.entries({
    depression: [3, 5, 10, 13, 16, 17, 21],
    anxiety: [2, 4, 7, 9, 15, 19, 20],
    stress: [1, 6, 8, 11, 12, 14, 18]
  })) {
    for (const question of questions) {
      const answers = makeAnswers(0);
      answers[String(question)] = 1;
      const result = assessment.calculateDASS21(answers);
      assert.equal(result.subscales[subscale].rawScore, 1);
      assert.equal(result.subscales[subscale].score, 2);
      for (const other of Object.keys(result.subscales)) {
        if (other !== subscale) assert.equal(result.subscales[other].score, 0);
      }
    }
  }
});

test('DASS-21 standardized score and priority classification use each subscale', () => {
  const assessment = loadAssessment();
  const result = assessment.calculateDASS21(makeAnswers(3));
  assert.deepEqual(JSON.parse(JSON.stringify(result.subscales)), {
    depression: { rawScore: 21, score: 42, severity: 'EXTREMELY SEVERE' },
    anxiety: { rawScore: 21, score: 42, severity: 'EXTREMELY SEVERE' },
    stress: { rawScore: 21, score: 42, severity: 'EXTREMELY SEVERE' }
  });
  assert.equal(result.priority, 'PRIORITY');
  assert.equal(result.requiresReview, true);
  assert.equal(assessment.calculateDASS21(makeAnswers(0)).priority, null);
});

test('mild and moderate bands queue routine review, while severe queues priority', () => {
  const assessment = loadAssessment();
  const routineAnswers = makeAnswers(0);
  [3, 5, 10].forEach(question => { routineAnswers[String(question)] = question === 10 ? 1 : 2; });
  const routine = assessment.calculateDASS21(routineAnswers);
  assert.equal(routine.subscales.depression.score, 10);
  assert.equal(routine.subscales.depression.severity, 'MILD');
  assert.equal(routine.priority, 'ROUTINE');

  const moderateAnswers = makeAnswers(0);
  [2, 4, 7, 9, 15].forEach(question => { moderateAnswers[String(question)] = 1; });
  const moderate = assessment.calculateDASS21(moderateAnswers);
  assert.equal(moderate.subscales.anxiety.score, 10);
  assert.equal(moderate.subscales.anxiety.severity, 'MODERATE');
  assert.equal(moderate.priority, 'ROUTINE');

  const priorityAnswers = makeAnswers(0);
  [3, 5, 10, 13, 16, 17, 21].forEach((question, index) => {
    priorityAnswers[String(question)] = index < 4 ? 2 : index === 4 ? 1 : 0;
  });
  const priority = assessment.calculateDASS21(priorityAnswers);
  assert.equal(priority.subscales.depression.score, 18);
  assert.equal(priority.priority, 'ROUTINE');
  priorityAnswers['21'] = 3;
  assert.equal(assessment.calculateDASS21(priorityAnswers).priority, 'PRIORITY');
});

test('all severity cutoffs classify the boundary and adjacent scores correctly', () => {
  const assessment = loadAssessment();
  const expected = {
    depression: [
      [0, 'NORMAL'], [9, 'NORMAL'], [10, 'MILD'], [13, 'MILD'],
      [14, 'MODERATE'], [20, 'MODERATE'], [21, 'SEVERE'], [27, 'SEVERE'],
      [28, 'EXTREMELY SEVERE'], [42, 'EXTREMELY SEVERE']
    ],
    anxiety: [
      [0, 'NORMAL'], [7, 'NORMAL'], [8, 'MILD'], [9, 'MILD'],
      [10, 'MODERATE'], [14, 'MODERATE'], [15, 'SEVERE'], [19, 'SEVERE'],
      [20, 'EXTREMELY SEVERE'], [42, 'EXTREMELY SEVERE']
    ],
    stress: [
      [0, 'NORMAL'], [14, 'NORMAL'], [15, 'MILD'], [18, 'MILD'],
      [19, 'MODERATE'], [25, 'MODERATE'], [26, 'SEVERE'], [33, 'SEVERE'],
      [34, 'EXTREMELY SEVERE'], [42, 'EXTREMELY SEVERE']
    ]
  };
  for (const [subscale, boundaries] of Object.entries(expected)) {
    for (const [score, band] of boundaries) {
      assert.equal(assessment.classifyDASS21Score(subscale, score), band, subscale + ' ' + score);
    }
  }
});

test('DASS-21 rejects incomplete, malformed, out-of-range, and non-integer answers', () => {
  const assessment = loadAssessment();
  const missing = makeAnswers(0);
  delete missing['21'];
  assert.throws(() => assessment.calculateDASS21(missing), /all 21/);
  assert.throws(() => assessment.calculateDASS21(Object.assign(makeAnswers(0), { '22': 0 })), /all 21|question numbers/);
  for (const value of [-1, 4, 1.5, '1', null]) {
    const invalid = makeAnswers(0);
    invalid['1'] = value;
    assert.throws(() => assessment.calculateDASS21(invalid), /integer from 0 to 3/);
  }
  assert.throws(() => assessment.calculateDASS21([]), /all 21/);
});

test('server submission saves 21 answers and separate subscale scores without an aggregate score', () => {
  const writes = [];
  const assessment = loadAssessment({
    Database: {
      select: table => table === 'student_profiles'
        ? { success: true, data: [{ id: 'student-profile-id' }] }
        : { success: true, data: [] },
      insert: (table, payload) => {
        writes.push({ table, payload });
        if (table === 'assessments') return { success: true, data: [{ id: 'assessment-id', created_at: new Date().toISOString() }] };
        if (table === 'assessment_answers') return { success: true, data: payload.map(() => ({ id: 'answer-id' })) };
        throw new Error('Unexpected insert: ' + table);
      },
      delete: () => ({ success: true, data: [] })
    }
  });
  const answers = makeAnswers(0);
  const result = assessment.submitDASS21('student-token', answers, true);
  assert.equal(result.success, true);
  const assessmentWrite = writes.find(write => write.table === 'assessments').payload;
  assert.equal(assessmentWrite.total_score, 0);
  assert.equal(assessmentWrite.severity, 'NOT_AGGREGATED');
  assert.equal(assessmentWrite.depression_score, 0);
  assert.equal(assessmentWrite.anxiety_score, 0);
  assert.equal(assessmentWrite.stress_score, 0);
  const answerWrite = writes.find(write => write.table === 'assessment_answers').payload;
  assert.equal(answerWrite.length, 21);
  assert.equal(answerWrite[20].question_number, 21);
});

test('submission refuses unapproved consent, duplicate window, and unauthorized callers', () => {
  let writes = 0;
  const assessment = loadAssessment({
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: name => name === 'DASS21_CONSENT_TEXT' ? '' : 'false' })
    },
    Database: {
      select: table => table === 'student_profiles'
        ? { success: true, data: [{ id: 'student-profile-id' }] }
        : { success: true, data: [{ id: 'recent-assessment' }] },
      insert: () => { writes++; return { success: true, data: [] }; }
    }
  });
  assert.equal(assessment.submitDASS21('student-token', makeAnswers(0), true).success, false);
  assert.equal(writes, 0);

  const duplicateAssessment = loadAssessment({
    Database: {
      select: table => table === 'student_profiles'
        ? { success: true, data: [{ id: 'student-profile-id' }] }
        : { success: true, data: [{ id: 'recent-assessment' }] },
      insert: () => { writes++; return { success: true, data: [] }; }
    }
  });
  assert.match(duplicateAssessment.submitDASS21('student-token', makeAnswers(0), true).error, /last seven days/);
  assert.equal(writes, 0);
  assert.throws(() => duplicateAssessment.submitDASS21('counselor-token', makeAnswers(0), true), /Unauthorized/);
});

test('counselor review transitions update the screening and linked notification', () => {
  const updates = [];
  const context = {
    CONFIG: { DASS21_REVIEW_POLICY: policy },
    getAuthenticatedUser_: (token, role) => {
      if (token === 'counselor-token' && role === 'COUNSELOR') return { id: 'counselor-id', role: 'COUNSELOR' };
      throw new Error('Unauthorized');
    },
    Database: {
      select: () => ({ success: true, data: [{ id: 'assessment-id', review_status: 'PENDING' }] }),
      update: (table, filter, payload) => {
        updates.push({ table, filter, payload });
        return { success: true, data: [{ id: 'updated-id' }] };
      }
    },
    AuditLog: { record: () => {} },
    Session: { getScriptTimeZone: () => 'Asia/Singapore' },
    Utilities: { formatDate: () => '+0800' },
    Database_unused: null
  };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');
  vm.runInContext(code, context);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.processDASS21ScreeningReview('counselor-token', 'assessment-id', 'REVIEWED'))),
    { success: true, status: 'REVIEWED' }
  );
  assert.equal(updates.length, 2);
  assert.equal(updates[0].table, 'assessments');
  assert.equal(updates[1].table, 'risk_flags');
  assert.match(updates[1].filter, /assessment_id=eq\.assessment-id/);
  assert.throws(() => context.processDASS21ScreeningReview('student-token', 'assessment-id', 'CLOSED'), /Unauthorized/);
});
