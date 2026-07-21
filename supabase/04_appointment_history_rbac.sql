-- Layer 4: Role-scoped read access for appointment history
-- The original "Enable read access for authenticated users" policy on appointments allows ANY
-- authenticated user (including doctors) to SELECT every appointment in the system, regardless of
-- which professional it belongs to. The new Appointment History screen is available to both
-- pharmacists and doctors, and doctors must only ever see appointments for patients they personally
-- attended. This replaces the blanket policy with the same RBAC pattern already used on doctor_leaves.

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON appointments;
DROP POLICY IF EXISTS "Enable read access based on RBAC" ON appointments;

CREATE POLICY "Enable read access based on RBAC"
ON appointments FOR SELECT TO authenticated USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist'
    OR (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor'
        AND professional_id = (SELECT id FROM professionals WHERE full_name ILIKE '%' || split_part(auth.jwt() -> 'app_metadata' ->> 'username', '-', 2) || '%' LIMIT 1)
    )
);
