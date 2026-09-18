import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Retrieve secure environment variables directly from Vercel's server runtime
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Fatal Infrastructure Error: Supabase credentials missing in serverless environment.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Raised by get_calendar_feed when the token is unknown or the doctor turned synchronization off
const INVALID_TOKEN_SQLSTATE = '28000';

interface FeedAppointment {
    id: number;
    client_name: string;
    client_phone: string;
    start_time_utc: string;
    end_time_utc: string;
    internal_notes: string | null;
    room_number: number;
}

// Utility to enforce the strict ISO 8601 string format required by the iCalendar RFC 5545 specification
const formatIcsDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
};

// RFC 5545 TEXT escaping: an unescaped comma or semicolon in a patient name or note corrupts the event for Google
const escapeIcsText = (value: string): string =>
    value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const token = req.query.token as string;

    if (!token) {
        return res.status(401).send('Security Error: Synchronization token is strictly required.');
    }

    try {
        // Calendar apps call this endpoint without a Supabase session, so the query runs as anon.
        // The SECURITY DEFINER function validates the token and scopes the rows to its owning professional.
        const { data, error } = await supabase.rpc('get_calendar_feed', { p_token: token });

        // Returning HTTP 403 Forbidden forces Apple/Google to halt synchronization gracefully
        if (error?.code === INVALID_TOKEN_SQLSTATE) {
            return res.status(403).send('Security Error: Calendar synchronization is currently disabled by the user or token revoked.');
        }
        if (error) {
            throw error;
        }

        const appointments = (data ?? []) as FeedAppointment[];

        // Construct the WebCal stream using the RFC 5545 protocol
        const icsLines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//William Pharmacy//Booking System//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:William Pharmacy Schedule',
            'X-WR-TIMEZONE:Europe/Malta',
            'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
            'X-PUBLISHED-TTL:PT15M'
        ];

        // Generate the current DTSTAMP required by iCalendar standards
        const now = formatIcsDate(new Date().toISOString());

        for (const appt of appointments) {
            const description = [
                `Patient: ${appt.client_name}`,
                `Phone: ${appt.client_phone}`,
                `Room: ${appt.room_number}`,
                `Notes: ${appt.internal_notes || 'None'}`
            ].join('\n');

            icsLines.push(
                'BEGIN:VEVENT',
                `UID:booking-${appt.id}@williams-pharmacy.com`,
                `DTSTAMP:${now}`,
                `DTSTART:${formatIcsDate(appt.start_time_utc)}`,
                `DTEND:${formatIcsDate(appt.end_time_utc)}`,
                `SUMMARY:${escapeIcsText(`Medical Appt: ${appt.client_name}`)}`,
                `DESCRIPTION:${escapeIcsText(description)}`,
                `LOCATION:${escapeIcsText(`William Pharmacy, Clinic Room ${appt.room_number}`)}`,
                'STATUS:CONFIRMED',
                'END:VEVENT'
            );
        }

        icsLines.push('END:VCALENDAR');

        const icsContent = icsLines.join('\r\n');

        // Inject HTTP Headers for safe delivery and Edge Caching
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="pharmacy_schedule.ics"');
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

        return res.status(200).send(icsContent);

    } catch (error) {
        console.error('Serverless execution failure generating WebCal feed:', error);
        return res.status(500).send('Infrastructure Error: Failed to compile iCalendar payload.');
    }
}
