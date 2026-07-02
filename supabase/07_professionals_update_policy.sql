-- Layer 7: Update Policy for Professionals
-- Staff Management needs to let a pharmacist correct a professional's consultation duration
-- after registration (e.g. a duration picked incorrectly at creation time). professionals
-- had RLS enabled with SELECT/INSERT policies but no UPDATE policy, so Postgres denies it by
-- default. Restricted to pharmacists only, consistent with the holiday_overrides RBAC model.

DROP POLICY IF EXISTS "Enable update for pharmacists only" ON professionals;

CREATE POLICY "Enable update for pharmacists only"
ON professionals FOR UPDATE TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');
