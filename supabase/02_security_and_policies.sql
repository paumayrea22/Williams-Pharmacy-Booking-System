-- Layer 2: Security Firewall and Access Policies (RLS)

-- 1. Enable RLS on all operational tables
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE availabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- 2. Clean up existing policies to avoid naming collisions
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON professionals;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON availabilities;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON appointments;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON appointments;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON appointments;

-- 3. Declare idempotent policies
CREATE POLICY "Enable read access for authenticated users" 
ON professionals FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" 
ON availabilities FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable read access for authenticated users" 
ON appointments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users only" 
ON appointments FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users only" 
ON appointments FOR UPDATE TO authenticated USING (true);