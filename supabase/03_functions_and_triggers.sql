-- Layer 3: Stored Procedures (RPC) and Realtime Streams

-- Idempotent Realtime publication block
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'appointments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
    END IF;
END
$$;

-- OR REPLACE ensures the function updates cleanly without needing to be dropped
CREATE OR REPLACE FUNCTION book_appointment_secure(
    p_professional_id BIGINT,
    p_room_number SMALLINT,
    p_client_name VARCHAR(150),
    p_client_phone VARCHAR(30),
    p_start_time_utc TIMESTAMPTZ,
    p_end_time_utc TIMESTAMPTZ,
    p_staff_username VARCHAR(50)
) RETURNS VOID AS $$
DECLARE
    v_day_of_week SMALLINT;
    v_start_time TIME;
    v_end_time TIME;
    v_is_available BOOLEAN := FALSE;
    v_doctor_booked INT;
    v_room_booked INT;
BEGIN
    -- 1. Pessimistic Locking: Freeze the professional's row to serialize concurrent requests
    PERFORM id FROM professionals WHERE id = p_professional_id FOR UPDATE;

    -- Normalize timestamps to Malta timezone to validate weekly schedules
    v_day_of_week := EXTRACT(DOW FROM p_start_time_utc AT TIME ZONE 'Europe/Malta');
    v_start_time := (p_start_time_utc AT TIME ZONE 'Europe/Malta')::TIME;
    v_end_time := (p_end_time_utc AT TIME ZONE 'Europe/Malta')::TIME;

    -- 2. Operational Constraint: Validate working hours
    SELECT EXISTS (
        SELECT 1 FROM availabilities
        WHERE professional_id = p_professional_id
          AND day_of_week = v_day_of_week
          AND start_time <= v_start_time
          AND end_time >= v_end_time
    ) INTO v_is_available;

    IF NOT v_is_available THEN
        RAISE EXCEPTION 'Operational Error: The selected time falls outside the professional working hours.';
    END IF;

    -- 3. Concurrency Constraint: Prevent double booking of the same doctor (Race Condition)
    SELECT COUNT(*) INTO v_doctor_booked
    FROM appointments
    WHERE professional_id = p_professional_id
      AND status = 'confirmed'
      AND (
        (start_time_utc <= p_start_time_utc AND end_time_utc > p_start_time_utc) OR
        (start_time_utc < p_end_time_utc AND end_time_utc >= p_end_time_utc) OR
        (start_time_utc >= p_start_time_utc AND end_time_utc <= p_end_time_utc)
      );

    IF v_doctor_booked > 0 THEN
        RAISE EXCEPTION 'Conflict Error: This professional already has a confirmed appointment at this time.';
    END IF;

    -- 4. Hardware Constraint: Validate physical room collision
    SELECT COUNT(*) INTO v_room_booked
    FROM appointments
    WHERE room_number = p_room_number
      AND status = 'confirmed'
      AND (
        (start_time_utc <= p_start_time_utc AND end_time_utc > p_start_time_utc) OR
        (start_time_utc < p_end_time_utc AND end_time_utc >= p_end_time_utc) OR
        (start_time_utc >= p_start_time_utc AND end_time_utc <= p_end_time_utc)
      );

    IF v_room_booked > 0 THEN
        RAISE EXCEPTION 'Hardware Error: Clinic Room % is already occupied by another patient at this time.', p_room_number;
    END IF;

    -- 5. Secure Atomic Insertion: Commit the record if all defenses pass
    INSERT INTO appointments (
        professional_id, room_number, client_name, client_phone,
        start_time_utc, end_time_utc, status, created_by_username
    ) VALUES (
        p_professional_id, p_room_number, p_client_name, p_client_phone,
        p_start_time_utc, p_end_time_utc, 'confirmed', p_staff_username
    );
END;
$$ LANGUAGE plpgsql;