-- Layer 5: Role-Based Access Control via app_metadata
-- user_metadata is writable by the client SDK (supabase.auth.updateUser), so it must never be
-- trusted for authorization: a pharmacist could self-promote to doctor by rewriting it. This
-- trigger seals the derived role into app_metadata, which is only writable server-side, so RLS
-- policies and the frontend AuthContext can trust it unconditionally.

CREATE OR REPLACE FUNCTION sync_role_to_app_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_username TEXT;
    v_role TEXT;
BEGIN
    v_username := NEW.raw_user_meta_data ->> 'username';

    IF v_username LIKE 'D-%' THEN
        v_role := 'doctor';
    ELSIF v_username LIKE 'P-%' THEN
        v_role := 'pharmacist';
    ELSE
        v_role := NULL;
    END IF;

    NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_role_to_app_metadata ON auth.users;

-- BEFORE trigger so it can mutate NEW directly without a recursive UPDATE statement
CREATE TRIGGER trg_sync_role_to_app_metadata
BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION sync_role_to_app_metadata();

-- Backfill: seal the role for staff accounts registered before this trigger existed.
-- Note: any of these users with an already-issued JWT must sign out and back in for the
-- updated app_metadata claim to appear in a fresh token.
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'role',
    CASE
        WHEN raw_user_meta_data ->> 'username' LIKE 'D-%' THEN 'doctor'
        WHEN raw_user_meta_data ->> 'username' LIKE 'P-%' THEN 'pharmacist'
        ELSE NULL
    END
)
WHERE raw_user_meta_data ->> 'username' IS NOT NULL;