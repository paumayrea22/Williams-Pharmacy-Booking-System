-- Layer 6: Missing Write Policies and Execution Privileges
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

-- Revoke public access to the RBAC trigger function. Only the Postgres engine should execute it.
REVOKE EXECUTE ON FUNCTION public.sync_role_to_app_metadata() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_role_to_app_metadata() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_role_to_app_metadata() FROM authenticated;

-- Revoke public access to the appointment booking RPC to prevent unauthenticated double-booking attacks.
REVOKE EXECUTE ON FUNCTION public.book_appointment_secure FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.book_appointment_secure FROM anon;

-- Explicitly grant execution rights only to signed-in staff
GRANT EXECUTE ON FUNCTION public.book_appointment_secure TO authenticated;