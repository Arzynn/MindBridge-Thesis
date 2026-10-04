ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE counselor_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_guidance ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_app_user_role() RETURNS TEXT AS $$
    SELECT current_setting('app.current_user_role', true);
$$ LANGUAGE sql STABLE;

CREATE POLICY users_own_access ON users
    FOR ALL USING (
        id = current_app_user_id()
        OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY student_profiles_access ON student_profiles
    FOR ALL USING (
        user_id = current_app_user_id()
        OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY assessments_access ON assessments
    FOR ALL USING (
        student_id IN (SELECT id FROM student_profiles WHERE user_id = current_app_user_id())
        OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY assessment_answers_access ON assessment_answers
    FOR ALL USING (
        assessment_id IN (
            SELECT a.id FROM assessments a
            JOIN student_profiles sp ON a.student_id = sp.id
            WHERE sp.user_id = current_app_user_id()
        ) OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY chat_sessions_access ON chat_sessions
    FOR ALL USING (
        student_id IN (SELECT id FROM student_profiles WHERE user_id = current_app_user_id())
        OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY chat_messages_access ON chat_messages
    FOR ALL USING (
        session_id IN (
            SELECT cs.id FROM chat_sessions cs
            JOIN student_profiles sp ON cs.student_id = sp.id
            WHERE sp.user_id = current_app_user_id()
        ) OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY ai_responses_access ON ai_responses
    FOR ALL USING (
        session_id IN (
            SELECT cs.id FROM chat_sessions cs
            JOIN student_profiles sp ON cs.student_id = sp.id
            WHERE sp.user_id = current_app_user_id()
        ) OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY counselor_reviews_access ON counselor_reviews
    FOR ALL USING (
        counselor_id = current_app_user_id()
        OR current_app_user_role() IN ('ADMIN')
    );

CREATE POLICY risk_flags_access ON risk_flags
    FOR ALL USING (
        student_id IN (SELECT id FROM student_profiles WHERE user_id = current_app_user_id())
        OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );

CREATE POLICY approved_guidance_access ON approved_guidance
    FOR ALL USING (status = 'APPROVED' OR current_app_user_role() IN ('COUNSELOR', 'ADMIN'));

CREATE POLICY audit_logs_access ON audit_logs
    FOR ALL USING (
        user_id = current_app_user_id()
        OR current_app_user_role() IN ('COUNSELOR', 'ADMIN')
    );