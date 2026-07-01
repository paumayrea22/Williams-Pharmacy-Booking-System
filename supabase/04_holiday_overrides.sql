-- Layer 4: Malta Public Holiday Overrides
-- Malta's fixed national holidays (and the movable Good Friday) are computed
-- client-side (see src/holidays.ts). This table only stores explicit staff
-- overrides for holidays where the pharmacy decides to open and operate as a
-- normal working day. Presence of a row for a given date means "open as usual".

CREATE TABLE IF NOT EXISTS holiday_overrides (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    created_by_username VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE holiday_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON holiday_overrides;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON holiday_overrides;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON holiday_overrides;

CREATE POLICY "Enable read access for authenticated users"
ON holiday_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users only"
ON holiday_overrides FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for authenticated users only"
ON holiday_overrides FOR DELETE TO authenticated USING (true);
