-- Layer 1: Data Definition Language (DDL) and Table Structures
-- Utilizing IF NOT EXISTS to prevent accidental overwrites in production

CREATE TABLE IF NOT EXISTS professionals (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    default_duration_minutes SMALLINT NOT NULL DEFAULT 15,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dynamic patch to enforce UNIQUE constraint on older live tables safely
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con 
        JOIN pg_class rel ON rel.oid = con.conrelid 
        WHERE rel.relname = 'professionals' AND con.contype = 'u'
    ) THEN
        ALTER TABLE professionals ADD CONSTRAINT professionals_full_name_key UNIQUE (full_name);
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS availabilities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    professional_id BIGINT REFERENCES professionals(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), 
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS appointments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    professional_id BIGINT REFERENCES professionals(id) ON DELETE RESTRICT,
    room_number SMALLINT NOT NULL CHECK (room_number IN (1, 2)),
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30) NOT NULL,
    start_time_utc TIMESTAMPTZ NOT NULL,
    end_time_utc TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed' 
        CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
    internal_notes TEXT,
    created_by_username VARCHAR(50) NOT NULL, 
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (start_time_utc < end_time_utc)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_availabilities_prof_day ON availabilities(professional_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time_utc);
CREATE INDEX IF NOT EXISTS idx_appointments_room ON appointments(room_number);
CREATE INDEX IF NOT EXISTS idx_appointments_professional ON appointments(professional_id);

-- Idempotent Seed Data
INSERT INTO professionals (full_name, specialty, default_duration_minutes) VALUES 
('Dr. Fsadni', 'General Medicine', 15),
('Dr. Christopher Sciberras', 'Pediatrics', 15),
('Dra. Martha Spiteri', 'General Medicine', 15),
('Keith Pirotta', 'Educational Psychologist', 60),
('Anthea Borg', 'Podiatrist', 15),
('Dr. Sciberras', 'General Medicine', 15)
ON CONFLICT (full_name) DO NOTHING;