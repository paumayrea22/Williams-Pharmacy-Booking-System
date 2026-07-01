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

-- Clean up previous policies to avoid naming collisions on re-run
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON holiday_overrides;
DROP POLICY IF EXISTS "Enable insert for pharmacists only" ON holiday_overrides;
DROP POLICY IF EXISTS "Enable delete for pharmacists only" ON holiday_overrides;

-- READ: All authenticated staff (doctors and pharmacists) need to know whether the pharmacy is open
CREATE POLICY "Enable read access for authenticated users"
ON holiday_overrides FOR SELECT TO authenticated USING (true);

-- WRITE: Only staff sealed with the 'pharmacist' role in app_metadata can create exceptions.
-- app_metadata is only writable server-side (see 05_app_metadata_rbac.sql), unlike user_metadata
-- which the client SDK can freely rewrite, so it is the only trustworthy source for RLS checks.
CREATE POLICY "Enable insert for pharmacists only"
ON holiday_overrides FOR INSERT TO authenticated
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');

-- DELETE: Only staff sealed with the 'pharmacist' role in app_metadata can remove exceptions
CREATE POLICY "Enable delete for pharmacists only"
ON holiday_overrides FOR DELETE TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');