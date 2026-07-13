import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { useAuth } from './context/AuthContext';
import { getErrorMessage } from './lib/errors';
import { formatDisplayPhone } from './lib/countryCodes';

interface Professional {
    id: number;
    full_name: string;
    specialty: string;
}

interface Appointment {
    id: number;
    professional_id: number;
    client_name: string;
    client_phone: string;
    start_time_utc: string;
    end_time_utc: string;
    status: string;
    room_number: number;
}

const STATUS_STYLES: Record<string, string> = {
    confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-50 text-red-600 border-red-200',
    completed: 'bg-pharmacy-cream-dark text-pharmacy-muted border-pharmacy-ink/10',
    no_show: 'bg-orange-50 text-orange-600 border-orange-200',
};

// Splits the stored "Client Name (Note)" convention back into its two parts for display
const extractNameAndNote = (fullName: string) => {
    const match = fullName.match(/^(.*?)(?:\s*\(([^)]+)\))?$/);
    return {
        name: match ? match[1].trim() : fullName,
        note: match && match[2] ? match[2].trim() : ''
    };
};

export default function AppointmentHistory() {
    const { role, username } = useAuth();

    const [professionals, setProfessionals] = useState<Professional[]>([]);
    const [ownProfessionalId, setOwnProfessionalId] = useState<number | null>(null);
    const [isResolvingOwnProfile, setIsResolvingOwnProfile] = useState(role === 'doctor');

    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const [professionalFilter, setProfessionalFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Load the roster once, resolving the doctor's own professional record by the D-/P- username convention
    useEffect(() => {
        const fetchProfessionals = async () => {
            try {
                const { data, error } = await supabase
                    .from('professionals')
                    .select('id, full_name, specialty')
                    .order('full_name', { ascending: true });

                if (error) throw new Error(error.message);
                setProfessionals(data || []);

                if (role === 'doctor' && username) {
                    const doctorNameSuffix = username.split('-')[1];
                    const ownProfile = (data || []).find(p => p.full_name.includes(doctorNameSuffix));
                    setOwnProfessionalId(ownProfile ? ownProfile.id : null);
                }
            } catch (error) {
                setErrorMessage('Infrastructure error loading professionals: ' + getErrorMessage(error));
            } finally {
                setIsResolvingOwnProfile(false);
            }
        };
        fetchProfessionals();
    }, [role, username]);

    // Server-side filters (professional, status, date range) drive the actual query;
    // doctors are always pinned to their own professional_id regardless of any filter state
    useEffect(() => {
        if (isResolvingOwnProfile) return;
        if (role === 'doctor' && !ownProfessionalId) return;

        const fetchHistory = async () => {
            setIsLoading(true);
            setErrorMessage('');
            try {
                let query = supabase
                    .from('appointments')
                    .select('id, professional_id, client_name, client_phone, start_time_utc, end_time_utc, status, room_number')
                    .order('start_time_utc', { ascending: false })
                    .limit(500);

                if (role === 'doctor') {
                    query = query.eq('professional_id', ownProfessionalId!);
                } else if (professionalFilter !== 'ALL') {
                    query = query.eq('professional_id', professionalFilter);
                }

                if (statusFilter !== 'all') {
                    query = query.eq('status', statusFilter);
                }

                if (dateFrom) {
                    const fromUtc = DateTime.fromISO(dateFrom, { zone: 'Europe/Malta' }).startOf('day').toUTC().toISO();
                    if (fromUtc) query = query.gte('start_time_utc', fromUtc);
                }

                if (dateTo) {
                    const toUtc = DateTime.fromISO(dateTo, { zone: 'Europe/Malta' }).endOf('day').toUTC().toISO();
                    if (toUtc) query = query.lte('start_time_utc', toUtc);
                }

                const { data, error } = await query;
                if (error) throw new Error(error.message);
                setAppointments(data || []);
            } catch (error) {
                setErrorMessage('Infrastructure error loading appointment history: ' + getErrorMessage(error));
            } finally {
                setIsLoading(false);
            }
        };
        fetchHistory();
    }, [role, ownProfessionalId, isResolvingOwnProfile, professionalFilter, statusFilter, dateFrom, dateTo]);

    // Patient name / phone search is applied client-side against the already-fetched, role-scoped batch
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const visibleAppointments = normalizedSearch
        ? appointments.filter(appt => {
            const parsed = extractNameAndNote(appt.client_name);
            return parsed.name.toLowerCase().includes(normalizedSearch)
                || appt.client_phone.toLowerCase().includes(normalizedSearch);
        })
        : appointments;

    const groupedByDate = visibleAppointments.reduce((acc, appt) => {
        const dateISO = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' }).toISODate()!;
        if (!acc[dateISO]) acc[dateISO] = [];
        acc[dateISO].push(appt);
        return acc;
    }, {} as Record<string, Appointment[]>);
    const sortedDates = Object.keys(groupedByDate).sort().reverse();

    return (
        <div className="p-4 sm:p-6 bg-pharmacy-cream h-full overflow-y-auto custom-scrollbar flex flex-col gap-6 pb-16">
            <div className="shrink-0">
                <p className="text-xs font-semibold tracking-[0.2em] text-pharmacy-gold-dark uppercase">Patient Records</p>
                <h1 className="font-display text-3xl text-pharmacy-ink">Appointment History</h1>
                {role === 'doctor' && (
                    <p className="text-xs text-pharmacy-muted mt-1">Showing only appointments you have personally attended.</p>
                )}
            </div>

            {errorMessage && (
                <div className="sticky top-0 z-10 bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm font-medium shadow-md shrink-0">
                    {errorMessage}
                </div>
            )}

            <div className="bg-white border border-pharmacy-ink/10 p-5 rounded-xl shadow-sm flex flex-col gap-4 shrink-0">
                <h2 className="font-display text-lg text-pharmacy-ink border-b pb-2 border-pharmacy-cream-dark">Filters</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="lg:col-span-2">
                        <label className="block text-xs font-bold text-pharmacy-muted mb-1">Search Patient</label>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Name or phone number..."
                            className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                        />
                    </div>

                    {role !== 'doctor' && (
                        <div>
                            <label className="block text-xs font-bold text-pharmacy-muted mb-1">Professional</label>
                            <select
                                value={professionalFilter}
                                onChange={(e) => setProfessionalFilter(e.target.value)}
                                className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                            >
                                <option value="ALL">All Professionals</option>
                                {professionals.map(p => (
                                    <option key={p.id} value={p.id}>{p.full_name} ({p.specialty})</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-pharmacy-muted mb-1">Status</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                        >
                            <option value="all">All Statuses</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="no_show">No Show</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-pharmacy-muted mb-1">From</label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-pharmacy-muted mb-1">To</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                        />
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-6">
                {isLoading ? (
                    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-pharmacy-ink/20 bg-white">
                        <p className="text-pharmacy-muted animate-pulse font-medium">Loading history...</p>
                    </div>
                ) : sortedDates.length === 0 ? (
                    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-pharmacy-ink/20 bg-white">
                        <p className="text-pharmacy-muted font-medium">No appointments match the current filters.</p>
                    </div>
                ) : sortedDates.map(dateISO => {
                    const dateObj = DateTime.fromISO(dateISO, { zone: 'Europe/Malta' });
                    const dayAppts = groupedByDate[dateISO];
                    return (
                        <div key={dateISO}>
                            <h3 className="font-display text-lg text-pharmacy-ink mb-3 border-b border-dotted border-pharmacy-ink/15 pb-2">
                                {dateObj.toFormat('EEEE, dd MMMM yyyy')}
                                <span className="ml-2 text-xs font-sans font-normal text-pharmacy-muted">{dayAppts.length} appointment{dayAppts.length !== 1 ? 's' : ''}</span>
                            </h3>
                            <ul className="space-y-3">
                                {dayAppts.map(appt => {
                                    const apptTime = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
                                    const prof = professionals.find(p => p.id === appt.professional_id);
                                    const parsed = extractNameAndNote(appt.client_name);

                                    return (
                                        <li key={appt.id} className={`text-sm bg-white p-4 rounded-xl border border-pharmacy-ink/10 shadow-sm flex justify-between items-start gap-3 ${appt.status === 'cancelled' ? 'opacity-60' : ''}`}>
                                            <div className="flex flex-col gap-0.5 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-pharmacy-ink text-base">{parsed.name}</span>
                                                    {parsed.note && <span className="text-[10px] font-bold uppercase tracking-wider text-pharmacy-gold-dark bg-pharmacy-gold/15 px-1.5 py-0.5 rounded">Note: {parsed.note}</span>}
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${STATUS_STYLES[appt.status] ?? ''}`}>{appt.status.replace('_', ' ')}</span>
                                                </div>
                                                <span className="text-xs font-mono text-pharmacy-muted">{formatDisplayPhone(appt.client_phone)}</span>
                                                <div className="text-xs text-pharmacy-muted mt-1">
                                                    {apptTime.toFormat('HH:mm')} · {prof ? `${prof.full_name} (${prof.specialty})` : 'Unknown professional'}
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-pharmacy-ink bg-pharmacy-cream-dark border border-pharmacy-ink/10 px-2.5 py-1.5 rounded-md shrink-0">Room {appt.room_number}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
