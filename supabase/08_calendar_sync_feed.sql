-- Layer 8: Per-doctor calendar feed (Google Calendar / Apple Calendar subscriptions)
-- Calendar apps fetch /api/calendar?token=... anonymously: they carry no Supabase session, so every
-- query from that endpoint runs as the anon role. The RLS policies on appointments and
-- calendar_sync_settings only grant access TO authenticated, which made the feed silently return
-- zero rows (token lookup failed -> HTTP 403 for every doctor). Instead of opening those tables to
-- anon, the feed goes through a SECURITY DEFINER function that only ever returns the confirmed,
-- upcoming appointments of the single professional that owns the presented secret token.

CREATE TABLE IF NOT EXISTS calendar_sync_settings (
    professional_id BIGINT PRIMARY KEY REFERENCES professionals(id) ON DELETE CASCADE,
    sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    target_email VARCHAR(255),
    sync_google BOOLEAN NOT NULL DEFAULT FALSE,
    sync_apple BOOLEAN NOT NULL DEFAULT FALSE,
    secure_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calendar_sync_settings ENABLE ROW LEVEL SECURITY;

-- A doctor may only read and write the sync row of their own professional record (same D-/P- username
-- matching used by the appointments RBAC policy). Nobody else can read a doctor's secret token.
DROP POLICY IF EXISTS "Doctors manage own calendar sync" ON calendar_sync_settings;
CREATE POLICY "Doctors manage own calendar sync"
ON calendar_sync_settings FOR ALL TO authenticated
USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor'
    AND professional_id = (SELECT id FROM professionals WHERE full_name ILIKE '%' || split_part(auth.jwt() -> 'app_metadata' ->> 'username', '-', 2) || '%' LIMIT 1)
)
WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor'
    AND professional_id = (SELECT id FROM professionals WHERE full_name ILIKE '%' || split_part(auth.jwt() -> 'app_metadata' ->> 'username', '-', 2) || '%' LIMIT 1)
);

CREATE OR REPLACE FUNCTION public.get_calendar_feed(p_token TEXT)
RETURNS TABLE (
    id BIGINT,
    client_name TEXT,
    client_phone TEXT,
    start_time_utc TIMESTAMPTZ,
    end_time_utc TIMESTAMPTZ,
    internal_notes TEXT,
    room_number SMALLINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_professional_id BIGINT;
BEGIN
    -- Cast to text so the lookup works whether secure_token is stored as UUID or TEXT in the live table
    SELECT s.professional_id INTO v_professional_id
    FROM calendar_sync_settings s
    WHERE s.secure_token::TEXT = p_token
      AND s.sync_enabled;

    -- SQLSTATE 28000 lets the API tell "revoked/unknown token" (403) apart from real database failures (500)
    IF v_professional_id IS NULL THEN
        RAISE EXCEPTION 'Calendar feed token is invalid or synchronization is disabled' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY
    SELECT a.id, a.client_name::TEXT, a.client_phone::TEXT, a.start_time_utc, a.end_time_utc, a.internal_notes, a.room_number
    FROM appointments a
    WHERE a.professional_id = v_professional_id
      AND a.status = 'confirmed'
      AND a.end_time_utc >= NOW()
    ORDER BY a.start_time_utc;
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_feed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_calendar_feed(TEXT) TO anon, authenticated;
