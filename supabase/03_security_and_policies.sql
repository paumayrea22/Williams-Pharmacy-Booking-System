-- Layer 3: Security Firewall and Access Policies (RLS)

-- 1. Enable RLS on all operational tables
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE availabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_leaves ENABLE ROW LEVEL SECURITY;

-- 2. Clear all previous policies to avoid duplication errors
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON rooms;
DROP POLICY IF EXISTS "Enable insert for pharmacists only" ON rooms;
DROP POLICY IF EXISTS "Enable delete for pharmacists only" ON rooms;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON professionals;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON professionals;
DROP POLICY IF EXISTS "Enable update for pharmacists only" ON professionals;
DROP POLICY IF EXISTS "Enable delete for pharmacists only" ON professionals;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON availabilities;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON availabilities;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON availabilities;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON appointments;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON appointments;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON appointments;
DROP POLICY IF EXISTS "Enable select for staff based on RBAC" ON doctor_leaves;
DROP POLICY IF EXISTS "Enable insert for staff based on RBAC" ON doctor_leaves;
DROP POLICY IF EXISTS "Enable delete for staff based on RBAC" ON doctor_leaves;

-- 3. Rooms Policies
CREATE POLICY "Enable read access for authenticated users" ON rooms FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for pharmacists only" ON rooms FOR INSERT TO authenticated WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');
CREATE POLICY "Enable delete for pharmacists only" ON rooms FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');

-- 4. Professionals Policies
CREATE POLICY "Enable read access for authenticated users" ON professionals FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users only" ON professionals FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for pharmacists only" ON professionals FOR UPDATE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist') WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');
CREATE POLICY "Enable delete for pharmacists only" ON professionals FOR DELETE TO authenticated USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');

-- 5. Availabilities Policies
CREATE POLICY "Enable read access for authenticated users" ON availabilities FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users only" ON availabilities FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable delete for authenticated users only" ON availabilities FOR DELETE TO authenticated USING (auth.role() = 'authenticated');

-- 6. Appointments Policies
CREATE POLICY "Enable read access for authenticated users" ON appointments FOR SELECT TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "Enable insert for authenticated users only" ON appointments FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users only" ON appointments FOR UPDATE TO authenticated USING (auth.role() = 'authenticated');

-- 7. Doctor Leaves Policies (Cross-referenced securely using app_metadata.username)
CREATE POLICY "Enable select for staff based on RBAC" ON doctor_leaves FOR SELECT TO authenticated USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist'
    OR (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor'
        AND professional_id = (SELECT id FROM professionals WHERE full_name ILIKE '%' || split_part(auth.jwt() -> 'app_metadata' ->> 'username', '-', 2) || '%' LIMIT 1)
    )
);

CREATE POLICY "Enable insert for staff based on RBAC" ON doctor_leaves FOR INSERT TO authenticated WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist'
    OR (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor'
        AND professional_id = (SELECT id FROM professionals WHERE full_name ILIKE '%' || split_part(auth.jwt() -> 'app_metadata' ->> 'username', '-', 2) || '%' LIMIT 1)
    )
);

CREATE POLICY "Enable delete for staff based on RBAC" ON doctor_leaves FOR DELETE TO authenticated USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist'
    OR (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor'
        AND professional_id = (SELECT id FROM professionals WHERE full_name ILIKE '%' || split_part(auth.jwt() -> 'app_metadata' ->> 'username', '-', 2) || '%' LIMIT 1)
    )
);