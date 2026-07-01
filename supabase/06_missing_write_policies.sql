-- Layer 6: Missing Write Policies for Staff Management
-- professionals and availabilities have RLS enabled (see 02_security_and_policies.sql) but were
-- only ever given a SELECT policy. With RLS enabled and no matching policy, Postgres denies the
-- command by default, so "Register Specialist", "Add" and "Delete" in Staff Management have been
-- silently rejected by the database. These policies close that gap.

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON professionals;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON availabilities;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON availabilities;

CREATE POLICY "Enable insert for authenticated users only"
ON professionals FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users only"
ON availabilities FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for authenticated users only"
ON availabilities FOR DELETE TO authenticated USING (true);
