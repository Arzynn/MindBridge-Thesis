-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM ('STUDENT', 'COUNSELOR', 'ADMIN');
CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE assessment_type AS ENUM ('DASS21', 'PHQ9', 'GAD7', 'PSS10');
CREATE TYPE chat_status AS ENUM ('ACTIVE', 'WAITING_COUNSELOR', 'RESOLVED');
CREATE TYPE message_sender AS ENUM ('STUDENT', 'AI', 'COUNSELOR', 'SYSTEM');
CREATE TYPE ai_response_status AS ENUM ('PENDING', 'APPROVED', 'EDITED', 'REJECTED');
CREATE TYPE review_action AS ENUM ('APPROVED', 'EDITED', 'REJECTED');
CREATE TYPE trigger_type AS ENUM ('PHQ9_ITEM9', 'SCREENING_THRESHOLD', 'RISK_LEXICON');
CREATE TYPE risk_status AS ENUM ('PENDING', 'REVIEWED', 'FOLLOW_UP', 'CLOSED');
CREATE TYPE guidance_status AS ENUM ('DRAFT', 'APPROVED', 'DEACTIVATED');

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'STUDENT',
    status user_status NOT NULL DEFAULT 'ACTIVE',
    full_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE student_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    student_number VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    course VARCHAR(255) NOT NULL,
    year_level SMALLINT NOT NULL CHECK (year_level BETWEEN 1 AND 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    type assessment_type NOT NULL,
    total_score INTEGER NOT NULL DEFAULT 0,
    severity VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    depression_score INTEGER CHECK (depression_score BETWEEN 0 AND 42),
    anxiety_score INTEGER CHECK (anxiety_score BETWEEN 0 AND 42),
    stress_score INTEGER CHECK (stress_score BETWEEN 0 AND 42),
    depression_severity VARCHAR(30),
    anxiety_severity VARCHAR(30),
    stress_severity VARCHAR(30),
    review_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED'
        CHECK (review_status IN ('NOT_REQUIRED', 'POLICY_PENDING', 'PENDING', 'REVIEWED', 'FOLLOW_UP', 'CLOSED')),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE assessment_answers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    question_number INTEGER NOT NULL,
    answer TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    status chat_status NOT NULL DEFAULT 'ACTIVE',
    risk_flag BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender message_sender NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    ai_response TEXT NOT NULL,
    model_name VARCHAR(255),
    status ai_response_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE counselor_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ai_response_id UUID NOT NULL REFERENCES ai_responses(id) ON DELETE CASCADE,
    counselor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action review_action NOT NULL,
    original_response TEXT,
    edited_response TEXT,
    review_comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE risk_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
    trigger_type trigger_type NOT NULL,
    trigger_value TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'HIGH',
    priority VARCHAR(20) NOT NULL DEFAULT 'PRIORITY' CHECK (priority IN ('ROUTINE', 'PRIORITY')),
    status risk_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approved_guidance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status guidance_status NOT NULL DEFAULT 'APPROVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(255),
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_student_profiles_user_id ON student_profiles(user_id);
CREATE INDEX idx_assessments_student_id ON assessments(student_id);
CREATE INDEX idx_chat_sessions_student_id ON chat_sessions(student_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_ai_responses_session_id ON ai_responses(session_id);
CREATE INDEX idx_ai_responses_status ON ai_responses(status);
CREATE INDEX idx_risk_flags_student_id ON risk_flags(student_id);
CREATE UNIQUE INDEX idx_risk_flags_assessment_type_unique
    ON risk_flags(assessment_id, trigger_type)
    WHERE assessment_id IS NOT NULL;
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);