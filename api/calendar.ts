import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Retrieve secure environment variables directly from Vercel's server runtime
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Fatal Infrastructure Error: Supabase credentials missing in serverless environment.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Utility to enforce the strict ISO 8601 string format required by the iCalendar RFC 5545 specification
const formatIcsDate = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const token = req.query.token as string;

    if (!token) {
        return res.status(401).send('Security Error: Synchronization token is strictly required.');
    }

    try {
        // 1. Validate the cryptographic token against the database whitelist
        const { data: syncData, error: syncError } = await supabase
            .from('calendar_sync_settings')
            .select('professional_id, sync_enabled')
            .eq('secure_token', token)
            .single();

        // 2. Halting execution if sync is disabled or token was revoked
        // Returning HTTP 403 Forbidden forces Apple/Google to halt synchronization gracefully
        if (syncError || !syncData || !syncData.sync_enabled) {
            return res.status(403).send('Security Error: Calendar synchronization is currently disabled by the user or token revoked.');
        }

        const professionalId = syncData.professional_id;

        // Capture the exact current timestamp in strict UTC format
        const nowUtc = new Date().toISOString();

        // 3. Fetch valid appointments from the database
        // Filtering strictly by end_time_utc to exclude any finished appointments from the HTTP request
        const { data: appointments, error: apptError } = await supabase
            .from('appointments')
            .select('id, client_name, client_phone, start_time_utc, end_time_utc, internal_notes, room_number')
            .eq('professional_id', professionalId)
            .eq('status', 'confirmed')
            .gte('end_time_utc', nowUtc)
            .order('start_time_utc', { ascending: true });

        if (apptError) {
            throw apptError;
        }

        // 4. Construct the WebCal stream using the RFC 5545 protocol
        const icsLines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//William Pharmacy//Booking System//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:William Pharmacy Schedule',
            'X-WR-TIMEZONE:Europe/Malta',
            'REFRESH-INTERVAL;VALUE=DURATION:PT15M'
        ];

        if (appointments && appointments.length > 0) {
            // Generate the current DTSTAMP required by iCalendar standards
            const now = formatIcsDate(nowUtc);

            for (const appt of appointments) {
                const dtStart = formatIcsDate(appt.start_time_utc);
                const dtEnd = formatIcsDate(appt.end_time_utc);
                
                const summary = `Medical Appt: ${appt.client_name}`;
                
                // Escape commas and newlines per iCalendar specifications to prevent parsing failures
                const description = `Patient: ${appt.client_name}\\nPhone: ${appt.client_phone}\\nRoom: ${appt.room_number}\\nNotes: ${appt.internal_notes || 'None'}`.replace(/,/g, '\\,');

                icsLines.push(
                    'BEGIN:VEVENT',
                    `UID:booking-${appt.id}@williams-pharmacy.com`,
                    `DTSTAMP:${now}`,
                    `DTSTART:${dtStart}`,
                    `DTEND:${dtEnd}`,
                    `SUMMARY:${summary}`,
                    `DESCRIPTION:${description}`,
                    `LOCATION:William Pharmacy\\, Clinic Room ${appt.room_number}`,
                    'STATUS:CONFIRMED',
                    'END:VEVENT'
                );
            }
        }

        icsLines.push('END:VCALENDAR');

        const icsContent = icsLines.join('\r\n');

        // 5. Inject HTTP Headers for safe delivery and Edge Caching
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="pharmacy_schedule.ics"');
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); 

        return res.status(200).send(icsContent);

    } catch (error) {
        console.error('Serverless execution failure generating WebCal feed:', error);
        return res.status(500).send('Infrastructure Error: Failed to compile iCalendar payload.');
    }
}