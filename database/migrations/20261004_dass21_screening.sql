-- Additive migration for DASS-21 screening and counselor review.
-- Existing assessment total_score/severity fields are retained for legacy
-- records. DASS-21 writes total_score=0 and severity='NOT_AGGREGATED' so its
-- three subscales are never combined into a diagnostic-style total.

ALTER TABLE public.assessments
    ADD COLUMN IF NOT EXISTS depression_score INTEGER,
    ADD COLUMN IF NOT EXISTS anxiety_score INTEGER,
    ADD COLUMN IF NOT EXISTS stress_score INTEGER,
    ADD COLUMN IF NOT EXISTS depression_severity VARCHAR(30),
    ADD COLUMN IF NOT EXISTS anxiety_severity VARCHAR(30),
    ADD COLUMN IF NOT EXISTS stress_severity VARCHAR(30),
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assessments_depression_score_range'
    ) THEN
        ALTER TABLE public.assessments ADD CONSTRAINT assessments_depression_score_range
            CHECK (depression_score IS NULL OR depression_score BETWEEN 0 AND 42);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assessments_anxiety_score_range'
    ) THEN
        ALTER TABLE public.assessments ADD CONSTRAINT assessments_anxiety_score_range
            CHECK (anxiety_score IS NULL OR anxiety_score BETWEEN 0 AND 42);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assessments_stress_score_range'
    ) THEN
        ALTER TABLE public.assessments ADD CONSTRAINT assessments_stress_score_range
            CHECK (stress_score IS NULL OR stress_score BETWEEN 0 AND 42);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assessments_dass_review_status'
    ) THEN
        ALTER TABLE public.assessments ADD CONSTRAINT assessments_dass_review_status
            CHECK (review_status IN ('NOT_REQUIRED', 'POLICY_PENDING', 'PENDING', 'REVIEWED', 'FOLLOW_UP', 'CLOSED'));
    END IF;
END $$;

ALTER TABLE public.risk_flags
    ADD COLUMN IF NOT EXISTS assessment_id UUID REFERENCES public.assessments(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'PRIORITY';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'risk_flags_priority_values'
    ) THEN
        ALTER TABLE public.risk_flags ADD CONSTRAINT risk_flags_priority_values
            CHECK (priority IN ('ROUTINE', 'PRIORITY'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_flags_assessment_type_unique
    ON public.risk_flags(assessment_id, trigger_type)
    WHERE assessment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_dass_review
    ON public.assessments(type, review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_flags_dass_priority
    ON public.risk_flags(priority, status, created_at DESC)
    WHERE trigger_type = 'SCREENING_THRESHOLD';
