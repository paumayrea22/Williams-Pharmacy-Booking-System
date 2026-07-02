import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import AppointmentModal from './AppointmentModal';
import { useAuth } from './context/AuthContext';
import { getMaltaHolidayName } from './holidays';
import { getErrorMessage } from './lib/errors';
import { formatDisplayPhone } from './lib/countryCodes';

interface WindowWithWebkitAudio extends Window {
    webkitAudioContext?: typeof AudioContext;
}

const getAudioContextConstructor = (): typeof AudioContext => {
    return window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext || AudioContext;
};

let sharedAudioContext: AudioContext | null = null;

const unlockAudioEngine = () => {
    try {
        if (!sharedAudioContext) {
            sharedAudioContext = new (getAudioContextConstructor())();
        }
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume();
        }
    } catch (e) {
        console.error('Failed to unlock audio engine:', e);
    }
};

interface Professional {
    id: number;
    full_name: string;
    specialty: string;
    default_duration_minutes: number;
}

interface Availability {
    id: number;
    professional_id: number;
    day_of_week: number;
    start_time: string;
    end_time: string;
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

interface IncomingAlert {
    id: number;
    clientName: string;
    startTime: string;
}

interface SlotDetails {
    status: 'Booked' | 'Available' | 'Unavailable' | 'Holiday';
    appointment?: Appointment;
    label?: string;
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Extract note metadata directly inside the calendar to display it
const extractNameAndNote = (fullName: string) => {
    const match = fullName.match(/^(.*?)(?:\s*\(([^)]+)\))?$/);
    return {
        name: match ? match[1].trim() : fullName,
        note: match && match[2] ? match[2].trim() : ''
    };
};

// Starts precisely at 07:30 instead of 08:00
const MORNING_SLOTS: { hour: number; minute: number }[] = [];
for (let hour = 7; hour < 14; hour++) {
    for (const minute of [0, 15, 30, 45]) {
        if (hour === 7 && minute < 30) continue;
        MORNING_SLOTS.push({ hour, minute });
    }
}

const AFTERNOON_SLOTS: { hour: number; minute: number }[] = [];
for (let hour = 14; hour <= 19; hour++) {
    for (const minute of [0, 15, 30, 45]) {
        AFTERNOON_SLOTS.push({ hour, minute });
    }
}

const FULL_DAY_SLOTS: { hour: number; minute: number }[] = [...MORNING_SLOTS, ...AFTERNOON_SLOTS];

// Builds continuous slots honoring the professional's default duration
const buildTimeSlots = (startHour: number, endHour: number, stepMinutes: number): { hour: number; minute: number }[] => {
    const slots: { hour: number; minute: number }[] = [];
    let startMin = startHour * 60;
    if (startHour === 7) startMin = 7 * 60 + 30; // Force 07:30 start

    for (let totalMinutes = startMin; totalMinutes < endHour * 60; totalMinutes += stepMinutes) {
        slots.push({ hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 });
    }
    return slots;
};

export default function Calendar() {
    const { role, username } = useAuth();
    const [professionals, setProfessionals] = useState<Professional[]>([]);
    const [selectedProfessional, setSelectedProfessional] = useState<string>('');
    const [isStaffLoading, setIsStaffLoading] = useState(true);

    const [availabilities, setAvailabilities] = useState<Availability[]>([]);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [isDataLoading, setIsDataLoading] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

    const [doctorProfId, setDoctorProfId] = useState<number | null>(null);
    const [isDoctor, setIsDoctor] = useState(false);
    const [activeNotification, setActiveNotification] = useState<IncomingAlert | null>(null);

    const [currentWeekStart, setCurrentWeekStart] = useState<DateTime>(() => DateTime.local({ zone: 'Europe/Malta' }).startOf('week'));
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    
    // Unified Temporal Filter (-1 represents "All Week" for List view)
    const [selectedDayIndex, setSelectedDayIndex] = useState<number>(-1);
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [appointmentToEdit, setAppointmentToEdit] = useState<Appointment | null>(null);
    const [prefilledDate, setPrefilledDate] = useState<DateTime | null>(null);
    const [prefilledTime, setPrefilledTime] = useState<string[]>([]);
    const [prefilledRoom, setPrefilledRoom] = useState<string>('');
    
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        document.addEventListener('click', unlockAudioEngine, { once: true });
        document.addEventListener('keydown', unlockAudioEngine, { once: true });
        return () => {
            document.removeEventListener('click', unlockAudioEngine);
            document.removeEventListener('keydown', unlockAudioEngine);
        };
    }, []);

    const playAlertSound = () => {
        try {
            if (!sharedAudioContext) sharedAudioContext = new (getAudioContextConstructor())();
            if (sharedAudioContext.state === 'suspended') sharedAudioContext.resume();
            
            const oscillator = sharedAudioContext.createOscillator();
            const gainNode = sharedAudioContext.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(587.33, sharedAudioContext.currentTime);
            
            gainNode.gain.setValueAtTime(0.12, sharedAudioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, sharedAudioContext.currentTime + 0.4);
            
            oscillator.connect(gainNode);
            gainNode.connect(sharedAudioContext.destination);
            
            oscillator.start();
            oscillator.stop(sharedAudioContext.currentTime + 0.4);
        } catch (e) {
            console.error('Audio engine failed to emit pulse:', e);
        }
    };

    useEffect(() => {
        const fetchProfessionals = async () => {
            const { data, error } = await supabase.from('professionals').select('*').order('id', { ascending: true });

            if (!error && data && data.length > 0) {
                setProfessionals(data);

                let lockedToOwnProfile = false;
                if (role === 'doctor' && username) {
                    const doctorNameSuffix = username.split('-')[1];
                    const matchingDoctor = data.find(p => p.full_name.includes(doctorNameSuffix));
                    if (matchingDoctor) {
                        setDoctorProfId(matchingDoctor.id);
                        setIsDoctor(true);
                        setSelectedProfessional(matchingDoctor.id.toString());
                        lockedToOwnProfile = true;
                    }
                }

                if (!lockedToOwnProfile) setSelectedProfessional('ALL');
            }
            setIsStaffLoading(false);
        };
        fetchProfessionals();
    }, [role, username]);

    useEffect(() => {
        if (!selectedProfessional) return;

        const fetchProfessionalData = async () => {
            setIsDataLoading(true);
            const startUtc = currentWeekStart.startOf('week').toUTC().toISO();
            const endUtc = currentWeekStart.endOf('week').toUTC().toISO();

            let availQuery = supabase.from('availabilities').select('*');
            let apptQuery = supabase.from('appointments')
                .select('*')
                .gte('start_time_utc', startUtc)
                .lte('start_time_utc', endUtc)
                .order('start_time_utc', { ascending: true });

            if (selectedProfessional !== 'ALL') {
                availQuery = availQuery.eq('professional_id', selectedProfessional);
                apptQuery = apptQuery.eq('professional_id', selectedProfessional);
            }

            const [availabilitiesResponse, appointmentsResponse] = await Promise.all([availQuery, apptQuery]);

            setAvailabilities(availabilitiesResponse.data || []);
            setAppointments(appointmentsResponse.data || []);
            setIsDataLoading(false);
        };
        fetchProfessionalData();
    }, [selectedProfessional, currentWeekStart, refreshKey]);

    useEffect(() => {
        const realtimeChannel = supabase
            .channel('pharmacy-timeline-stream')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, (payload) => {
                setRefreshKey(prev => prev + 1);
                if (payload.eventType === 'INSERT') {
                    const incomingRecord = payload.new as Appointment;
                    if (doctorProfId && incomingRecord.professional_id === doctorProfId) {
                        const localTimeStr = DateTime.fromISO(incomingRecord.start_time_utc, { zone: 'Europe/Malta' }).toFormat('HH:mm');
                        setActiveNotification({ id: incomingRecord.id, clientName: incomingRecord.client_name, startTime: localTimeStr });
                        playAlertSound();
                    }
                }
            }).subscribe();

        return () => { supabase.removeChannel(realtimeChannel); };
    }, [doctorProfId]);

    const handleCancelAppointment = async (appointmentId: number) => {
        const confirmation = window.confirm('Are you strictly sure you want to cancel this appointment?');
        if (!confirmation) return;

        setActionLoadingId(appointmentId);
        try {
            const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appointmentId);
            if (error) throw new Error(error.message);
            setRefreshKey(prev => prev + 1);
        } catch (error) {
            alert('System Error: Infrastructure failed to cancel the appointment. Details: ' + getErrorMessage(error));
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleReschedule = (appt: Appointment) => {
        setAppointmentToEdit(appt);
        setIsModalOpen(true);
    };

    const handleEmptySlotClick = (dateObj: DateTime, timeStr: string, defaultRoom?: string) => {
        setPrefilledDate(dateObj);
        setPrefilledTime([timeStr]);
        if (defaultRoom) setPrefilledRoom(defaultRoom);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setAppointmentToEdit(null);
        setPrefilledDate(null);
        setPrefilledTime([]);
        setPrefilledRoom('');
    };

    const handleViewModeChange = (mode: 'list' | 'grid') => {
        if (mode === 'grid' && selectedDayIndex === -1) {
            const todayWeekday = DateTime.local({ zone: 'Europe/Malta' }).weekday;
            setSelectedDayIndex(todayWeekday === 7 ? 6 : todayWeekday - 1);
        }
        setViewMode(mode);
    };

    const formatTime = (timeStr: string) => timeStr.substring(0, 5);

    const getSlotDetails = (dayIndex: number, hour: number, minute: number, targetRoom?: number): SlotDetails => {
        const slotDate = currentWeekStart.plus({ days: dayIndex }).set({ hour, minute });
        const sqlDayIndex = slotDate.weekday === 7 ? 0 : slotDate.weekday;

        const holidayName = getMaltaHolidayName(slotDate.toISODate()!);
        if (holidayName) return { status: 'Holiday', label: holidayName };

        const bookedAppt = appointments.find(appt => {
            const apptStart = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
            const apptEnd = DateTime.fromISO(appt.end_time_utc, { zone: 'Europe/Malta' });
            const matchesRoom = targetRoom ? appt.room_number === targetRoom : true;
            return appt.status !== 'cancelled' && matchesRoom && slotDate >= apptStart && slotDate < apptEnd;
        });

        if (bookedAppt) return { status: 'Booked', appointment: bookedAppt };

        const slotMinutes = hour * 60 + minute;
        const isAvailable = availabilities.some(avail => {
            const [startHour, startMinute] = avail.start_time.split(':').map(Number);
            const [endHour, endMinute] = avail.end_time.split(':').map(Number);
            const startMins = startHour * 60 + startMinute;
            const endMins = endHour * 60 + endMinute;
            return avail.day_of_week === sqlDayIndex && slotMinutes >= startMins && slotMinutes < endMins;
        });

        if (isAvailable) return { status: 'Available' };
        return { status: 'Unavailable' };
    };

    const renderAppointmentCard = (appt: Appointment) => {
        const apptTime = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
        const uiDayIndex = apptTime.weekday === 7 ? 6 : apptTime.weekday - 1;
        const prof = professionals.find(p => p.id === appt.professional_id);
        const parsed = extractNameAndNote(appt.client_name);

        return (
            <li key={appt.id} className="text-sm bg-white p-4 rounded-xl border border-pharmacy-ink/10 shadow-sm flex flex-col gap-2">
                <div className="flex justify-between items-start gap-3">
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-pharmacy-ink text-base">{parsed.name}</span>
                            {parsed.note && <span className="text-[10px] font-bold uppercase tracking-wider text-pharmacy-gold-dark bg-pharmacy-gold/15 px-1.5 py-0.5 rounded">Note: {parsed.note}</span>}
                        </div>
                        <span className="text-xs font-mono text-pharmacy-muted">{formatDisplayPhone(appt.client_phone)}</span>
                        <div className="text-xs text-pharmacy-muted mt-1">
                            {selectedProfessional === 'ALL' && prof ? <span className="font-bold text-pharmacy-gold-dark mr-1">{prof.full_name} ·</span> : null}
                            {DAYS_OF_WEEK[uiDayIndex]} · {apptTime.toFormat('HH:mm')}
                        </div>
                    </div>
                    {selectedProfessional !== 'ALL' && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-pharmacy-ink bg-pharmacy-cream-dark border border-pharmacy-ink/10 px-2.5 py-1.5 rounded-md shrink-0">Room {appt.room_number}</span>
                    )}
                </div>
                <div className="flex gap-4 mt-2 pt-3 border-t border-dashed border-pharmacy-ink/10">
                    <button
                        onClick={() => handleReschedule(appt)}
                        disabled={actionLoadingId === appt.id}
                        className="text-xs font-bold text-pharmacy-gold-dark hover:text-pharmacy-gold transition-colors disabled:opacity-50 uppercase tracking-wide"
                    >
                        Reschedule
                    </button>
                    <button
                        onClick={() => handleCancelAppointment(appt.id)}
                        disabled={actionLoadingId === appt.id}
                        className="text-xs font-bold text-red-700/80 hover:text-red-700 transition-colors disabled:opacity-50 uppercase tracking-wide"
                    >
                        {actionLoadingId === appt.id ? '...' : 'Cancel'}
                    </button>
                </div>
            </li>
        );
    };

    const renderEmptyPlaceholder = (timeUtc: string, room: number) => {
        const time = DateTime.fromISO(timeUtc, { zone: 'Europe/Malta' });
        const uiDayIndex = time.weekday === 7 ? 6 : time.weekday - 1;
        return (
            <li key={`empty-${room}-${timeUtc}`} className="text-sm bg-pharmacy-cream/30 p-4 rounded-xl border border-dashed border-pharmacy-ink/20 flex flex-col justify-between min-h-[110px] opacity-70">
                <div className="flex justify-between items-start gap-3">
                    <div>
                        <span className="font-bold text-pharmacy-muted text-base italic">No Appointment</span>
                        <div className="text-xs text-pharmacy-muted mt-1">
                            {DAYS_OF_WEEK[uiDayIndex]} · {time.toFormat('HH:mm')}
                        </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-pharmacy-muted bg-pharmacy-cream border border-pharmacy-ink/5 px-2.5 py-1.5 rounded-md shrink-0">Room {room}</span>
                </div>
            </li>
        );
    };

    // Apply the Day Filter to the payload
    const filteredAppointments = selectedDayIndex === -1 
        ? appointments 
        : appointments.filter(a => {
            const day = DateTime.fromISO(a.start_time_utc, { zone: 'Europe/Malta' }).weekday;
            const idx = day === 7 ? 6 : day - 1;
            return idx === selectedDayIndex;
        });

    const activeFilteredAppts = filteredAppointments.filter(a => a.status !== 'cancelled');
    const uniqueTimesForGeneral = Array.from(new Set(activeFilteredAppts.map(a => a.start_time_utc))).sort();

    const groupedAvailabilities = availabilities.reduce((acc, curr) => {
        if (!acc[curr.day_of_week]) acc[curr.day_of_week] = [];
        acc[curr.day_of_week].push(curr);
        return acc;
    }, {} as Record<number, Availability[]>);

    const gridStepMinutes = professionals.find(p => p.id.toString() === selectedProfessional)?.default_duration_minutes ?? 15;
    const morningSlots = buildTimeSlots(7, 14, gridStepMinutes); // Starts at 7:30 explicitly now
    const afternoonSlots = buildTimeSlots(14, 20, gridStepMinutes);

    return (
        <div className="flex h-full flex-col bg-pharmacy-cream relative">
            {activeNotification && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md bg-pharmacy-green text-white p-4 rounded-xl shadow-2xl border border-pharmacy-green-light flex flex-col gap-2 animate-fadeIn">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-pharmacy-gold animate-ping"></span>
                            <h4 className="font-black text-sm tracking-wide text-pharmacy-gold uppercase">New Appointment</h4>
                        </div>
                        <button onClick={() => setActiveNotification(null)} className="text-pharmacy-cream/70 hover:text-white font-bold text-xs bg-pharmacy-green-light p-1 px-2 rounded">Dismiss</button>
                    </div>
                    <p className="text-sm font-semibold">Patient <span className="text-pharmacy-gold">{activeNotification.clientName}</span> scheduled at <span className="text-pharmacy-gold">{activeNotification.startTime}</span>.</p>
                </div>
            )}

            <header className="flex flex-col gap-4 border-b border-pharmacy-cream-dark p-6 sm:flex-row sm:items-end sm:justify-between shrink-0">
                <div>
                    <p className="text-xs font-semibold tracking-[0.2em] text-pharmacy-gold-dark uppercase mb-1">Appointment Management</p>
                    <h1 className="font-display text-3xl text-pharmacy-ink">
                        {currentWeekStart.hasSame(DateTime.local(), 'week') ? 'The week ahead' : `Week of ${currentWeekStart.toFormat('MMMM d')}`}
                    </h1>
                </div>
                <div className="flex items-center gap-4">
                    {isDoctor ? (
                        <div className="rounded-full border border-pharmacy-ink/20 bg-white px-4 py-2 text-pharmacy-ink shadow-sm font-medium text-sm">
                            {isStaffLoading ? 'Loading staff...' : (() => {
                                const own = professionals.find(p => p.id.toString() === selectedProfessional);
                                return own ? `${own.full_name} (${own.specialty})` : 'Unknown professional';
                            })()}
                        </div>
                    ) : (
                        <select
                            value={selectedProfessional}
                            onChange={(e) => setSelectedProfessional(e.target.value)}
                            disabled={isStaffLoading || isDataLoading}
                            className="rounded-full border border-pharmacy-ink/20 bg-white px-4 py-2 text-sm text-pharmacy-ink shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold disabled:opacity-50 font-medium"
                        >
                            <option value="ALL">General (All Rooms & Doctors)</option>
                            {isStaffLoading ? <option disabled>Loading staff...</option> : professionals.map((prof) => (
                                <option key={prof.id} value={prof.id}>{prof.full_name} ({prof.specialty})</option>
                            ))}
                        </select>
                    )}
                    <button onClick={() => setIsModalOpen(true)} className="rounded-full bg-pharmacy-gold px-5 py-2.5 text-sm font-semibold text-pharmacy-green shadow-md hover:bg-pharmacy-gold-dark hover:text-white transition-all">+ New appointment</button>
                </div>
            </header>

            <div className="flex-1 overflow-auto bg-pharmacy-cream p-6">
                {isDataLoading ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed border-pharmacy-ink/20 bg-white">
                        <p className="text-pharmacy-muted animate-pulse font-medium">Syncing Malta databases...</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 h-full">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-pharmacy-cream-dark pb-3 gap-4 shrink-0">
                            <div className="flex items-center gap-6">
                                <h2 className="font-display text-xl text-pharmacy-ink">{selectedProfessional === 'ALL' ? 'General Clinic Schedule' : 'Weekly availability'}</h2>
                                
                                <div className="flex items-center bg-white rounded-lg border border-pharmacy-ink/20 shadow-sm overflow-hidden h-8">
                                    <button onClick={() => setCurrentWeekStart(prev => prev.minus({ weeks: 1 }))} className="px-3 hover:bg-pharmacy-cream transition text-pharmacy-ink text-xs font-bold h-full flex items-center gap-1">
                                        <span>←</span> Prev Week
                                    </button>
                                    <button onClick={() => setCurrentWeekStart(DateTime.local({ zone: 'Europe/Malta' }).startOf('week'))} className="px-3 hover:bg-pharmacy-cream transition border-x border-pharmacy-ink/10 text-[10px] font-bold text-pharmacy-muted uppercase tracking-wider h-full">
                                        Today
                                    </button>
                                    <button onClick={() => setCurrentWeekStart(prev => prev.plus({ weeks: 1 }))} className="px-3 hover:bg-pharmacy-cream transition text-pharmacy-ink text-xs font-bold h-full flex items-center gap-1">
                                        Next Week <span>→</span>
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm font-medium">
                                <div className="flex items-center gap-2 mr-2">
                                    <label className="text-sm font-medium text-pharmacy-muted">Day:</label>
                                    <select
                                        value={selectedDayIndex}
                                        onChange={(e) => setSelectedDayIndex(Number(e.target.value))}
                                        className="rounded-full border border-pharmacy-ink/20 bg-white px-3 py-1.5 text-sm font-medium text-pharmacy-ink shadow-sm focus:border-pharmacy-gold focus:outline-none"
                                    >
                                        {viewMode === 'list' && <option value={-1}>All Week</option>}
                                        {DAYS_OF_WEEK.map((day, idx) => {
                                            const date = currentWeekStart.plus({ days: idx });
                                            return (
                                                <option key={idx} value={idx}>
                                                    {day} ({date.toFormat('dd/MM')})
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                                <button
                                    onClick={() => handleViewModeChange('list')}
                                    className={`pb-1 border-b-2 transition-colors ${viewMode === 'list' ? 'border-pharmacy-gold text-pharmacy-ink' : 'border-transparent text-pharmacy-muted hover:text-pharmacy-ink'}`}
                                >
                                    List
                                </button>
                                <button
                                    onClick={() => handleViewModeChange('grid')}
                                    className={`pb-1 border-b-2 transition-colors ${viewMode === 'grid' ? 'border-pharmacy-gold text-pharmacy-ink' : 'border-transparent text-pharmacy-muted hover:text-pharmacy-ink'}`}
                                >
                                    Grid
                                </button>
                            </div>
                        </div>

                        {viewMode === 'list' ? (
                            selectedProfessional === 'ALL' ? (
                                <div className="flex flex-col md:flex-row gap-8 pb-8">
                                    <div className="flex-1 md:border-r border-dashed border-pharmacy-ink/20 md:pr-8">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-display text-lg text-pharmacy-ink">Room 1 Appointments</h3>
                                            <span className="text-xs font-semibold text-pharmacy-muted bg-pharmacy-cream-dark px-2 py-1 rounded">{activeFilteredAppts.filter(a => a.room_number === 1).length} active</span>
                                        </div>
                                        <ul className="space-y-3">
                                            {uniqueTimesForGeneral.length === 0 
                                                ? <p className="text-sm text-pharmacy-muted">No appointments booked in Room 1.</p> 
                                                : uniqueTimesForGeneral.map(timeUtc => {
                                                    const appt = activeFilteredAppts.find(a => a.start_time_utc === timeUtc && a.room_number === 1);
                                                    if (appt) return renderAppointmentCard(appt);
                                                    return renderEmptyPlaceholder(timeUtc, 1);
                                                })
                                            }
                                        </ul>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-display text-lg text-pharmacy-ink">Room 2 Appointments</h3>
                                            <span className="text-xs font-semibold text-pharmacy-muted bg-pharmacy-cream-dark px-2 py-1 rounded">{activeFilteredAppts.filter(a => a.room_number === 2).length} active</span>
                                        </div>
                                        <ul className="space-y-3">
                                            {uniqueTimesForGeneral.length === 0 
                                                ? <p className="text-sm text-pharmacy-muted">No appointments booked in Room 2.</p> 
                                                : uniqueTimesForGeneral.map(timeUtc => {
                                                    const appt = activeFilteredAppts.find(a => a.start_time_utc === timeUtc && a.room_number === 2);
                                                    if (appt) return renderAppointmentCard(appt);
                                                    return renderEmptyPlaceholder(timeUtc, 2);
                                                })
                                            }
                                        </ul>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col md:flex-row gap-8 pb-8">
                                    <div className="flex-1 md:border-r border-dashed border-pharmacy-ink/20 md:pr-8">
                                        {Object.keys(groupedAvailabilities).length === 0 ? (
                                            <p className="text-sm text-pharmacy-muted">No schedules configured for this professional.</p>
                                        ) : (
                                            <div className="space-y-6">
                                                {Object.keys(groupedAvailabilities).map(Number).sort().filter(sqlDay => {
                                                    const sqlDayFilter = selectedDayIndex === -1 ? -1 : (selectedDayIndex === 6 ? 0 : selectedDayIndex + 1);
                                                    return sqlDayFilter === -1 || sqlDay === sqlDayFilter;
                                                }).map((sqlDayIndex) => {
                                                    const uiDayIndex = sqlDayIndex === 0 ? 6 : sqlDayIndex - 1;
                                                    const targetDateObj = currentWeekStart.plus({ days: uiDayIndex });
                                                    return (
                                                        <div key={sqlDayIndex} className="border-b border-dotted border-pharmacy-ink/15 last:border-0 pb-6 last:pb-0">
                                                            <h3 className="font-display text-lg text-pharmacy-ink mb-3">{DAYS_OF_WEEK[uiDayIndex]} <span className="font-sans text-sm text-pharmacy-muted font-normal ml-1">({targetDateObj.toFormat('dd/MM/yyyy')})</span></h3>
                                                            <div className="flex flex-col gap-3">
                                                                {groupedAvailabilities[sqlDayIndex].map((avail) => {
                                                                    const startH = parseInt(avail.start_time.split(':')[0], 10);
                                                                    const isMorning = startH < 14;
                                                                    return (
                                                                        <div key={avail.id} className="flex items-center">
                                                                            <span className={`w-24 text-[10px] font-bold uppercase tracking-[0.15em] ${isMorning ? 'text-emerald-600' : 'text-pharmacy-gold-dark'}`}>
                                                                                {isMorning ? 'Morning' : 'Afternoon'}
                                                                            </span>
                                                                            <span className="text-sm font-medium text-pharmacy-ink">
                                                                                {formatTime(avail.start_time)} - {formatTime(avail.end_time)}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 rounded-lg bg-transparent h-fit">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="font-display text-lg text-pharmacy-ink">Booked appointments</h3>
                                            <span className="text-xs font-semibold text-pharmacy-muted">{activeFilteredAppts.length} active</span>
                                        </div>
                                        {activeFilteredAppts.length === 0 ? (
                                            <p className="text-sm text-pharmacy-muted">No active appointments booked for this view.</p>
                                        ) : (
                                            <ul className="space-y-3">
                                                {activeFilteredAppts.map(renderAppointmentCard)}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="flex flex-col gap-3 pb-8 h-full">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
                                    {selectedProfessional === 'ALL' ? (
                                        [
                                            { label: 'Room 1', roomNumber: 1, slots: FULL_DAY_SLOTS },
                                            { label: 'Room 2', roomNumber: 2, slots: FULL_DAY_SLOTS },
                                        ].map(({ label, roomNumber, slots }) => {
                                            const currentDate = currentWeekStart.plus({ days: selectedDayIndex });
                                            
                                            return (
                                                <div key={label} className="overflow-x-auto rounded-lg border border-pharmacy-ink/10 bg-white shadow-sm flex flex-col h-[60vh] lg:h-auto">
                                                    <table className="w-full text-sm text-left border-collapse flex-1">
                                                        <thead className="bg-pharmacy-cream-dark text-pharmacy-ink sticky top-0 z-10 shadow-sm">
                                                            <tr>
                                                                <th className="border-b border-r border-pharmacy-ink/10 px-4 py-3 font-semibold text-center w-24 shrink-0">Time</th>
                                                                <th className="border-b border-pharmacy-ink/10 px-4 py-3 font-semibold text-center">
                                                                    {DAYS_OF_WEEK[selectedDayIndex]} - {label}
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {slots.map(({ hour, minute }) => {
                                                                const details = getSlotDetails(selectedDayIndex, hour, minute, roomNumber);
                                                                const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                                                                
                                                                let cellClass = '';
                                                                let cellContent: React.ReactNode = null;
                                                                let interactionProps = {};

                                                                if (details.status === 'Booked') {
                                                                    const prof = professionals.find(p => p.id === details.appointment!.professional_id);
                                                                    const parsed = extractNameAndNote(details.appointment!.client_name);
                                                                    cellClass = 'bg-emerald-50 border-emerald-200 text-emerald-800';
                                                                    cellContent = (
                                                                        <div className="flex items-center justify-between w-full px-2">
                                                                            <div className="flex items-center gap-2 truncate">
                                                                                <span className="font-bold text-[11px] text-emerald-900 truncate">{parsed.name}</span>
                                                                                {parsed.note && <span className="text-[10px] text-emerald-700 italic truncate">({parsed.note})</span>}
                                                                                <span className="font-mono text-[10px] text-emerald-700/80">{formatDisplayPhone(details.appointment!.client_phone)}</span>
                                                                                {prof && <span className="font-bold text-[9px] uppercase tracking-wider text-pharmacy-gold-dark">{prof.full_name}</span>}
                                                                            </div>
                                                                            <span className="font-bold text-[9px] uppercase tracking-wider text-emerald-900 bg-white/60 px-1.5 py-0.5 rounded shrink-0 ml-2">Rm {details.appointment!.room_number}</span>
                                                                        </div>
                                                                    );
                                                                    interactionProps = { className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}` };
                                                                } else if (details.status === 'Holiday') {
                                                                    cellClass = 'bg-purple-50 border-purple-200 text-purple-600 opacity-90';
                                                                    cellContent = <span className="font-bold text-xs tracking-[0.1em] uppercase">{details.label}</span>;
                                                                    interactionProps = { className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}` };
                                                                } else if (details.status === 'Available') {
                                                                    cellClass = 'bg-white border-emerald-100 text-emerald-700 hover:bg-pharmacy-gold/15 cursor-pointer';
                                                                    interactionProps = { 
                                                                        className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}`,
                                                                        onClick: () => handleEmptySlotClick(currentDate, timeString, roomNumber.toString())
                                                                    };
                                                                } else {
                                                                    cellClass = 'bg-pharmacy-cream border-pharmacy-ink/5 text-pharmacy-muted';
                                                                    interactionProps = { 
                                                                        className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}`
                                                                    };
                                                                }

                                                                return (
                                                                    <tr key={`${hour}-${minute}`}>
                                                                        <td className="border-b border-r border-pharmacy-ink/10 px-4 py-2 text-center text-pharmacy-muted font-medium bg-pharmacy-cream/40">
                                                                            {timeString}
                                                                        </td>
                                                                        <td {...interactionProps}>
                                                                            <div className="w-full flex items-center justify-center h-full min-h-[36px]">
                                                                                {cellContent}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        [
                                            { label: 'Morning', slots: morningSlots },
                                            { label: 'Afternoon', slots: afternoonSlots },
                                        ].map(({ label, slots }) => {
                                            const currentDate = currentWeekStart.plus({ days: selectedDayIndex });
                                            
                                            return (
                                                <div key={label} className="overflow-x-auto rounded-lg border border-pharmacy-ink/10 bg-white shadow-sm flex flex-col h-[50vh] lg:h-auto">
                                                    <table className="w-full text-sm text-left border-collapse flex-1">
                                                        <thead className="bg-pharmacy-cream-dark text-pharmacy-ink sticky top-0 z-10 shadow-sm">
                                                            <tr>
                                                                <th className="border-b border-r border-pharmacy-ink/10 px-4 py-3 font-semibold text-center w-24 shrink-0">Time</th>
                                                                <th className="border-b border-pharmacy-ink/10 px-4 py-3 font-semibold text-center">
                                                                    {DAYS_OF_WEEK[selectedDayIndex]} - {label}
                                                                    <span className="ml-2 font-normal text-pharmacy-muted">({currentDate.toFormat('dd/MM/yyyy')})</span>
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {slots.map(({ hour, minute }) => {
                                                                const details = getSlotDetails(selectedDayIndex, hour, minute);
                                                                const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                                                                
                                                                let cellClass = '';
                                                                let cellContent: React.ReactNode = null;
                                                                let interactionProps = {};

                                                                if (details.status === 'Booked') {
                                                                    const prof = professionals.find(p => p.id === details.appointment!.professional_id);
                                                                    const parsed = extractNameAndNote(details.appointment!.client_name);
                                                                    cellClass = 'bg-emerald-50 border-emerald-200 text-emerald-800';
                                                                    cellContent = (
                                                                        <div className="flex items-center justify-between w-full px-2">
                                                                            <div className="flex items-center gap-2 truncate">
                                                                                <span className="font-bold text-[11px] text-emerald-900 truncate">{parsed.name}</span>
                                                                                {parsed.note && <span className="text-[10px] text-emerald-700 italic truncate">({parsed.note})</span>}
                                                                                <span className="font-mono text-[10px] text-emerald-700/80">{formatDisplayPhone(details.appointment!.client_phone)}</span>
                                                                                {prof && <span className="font-bold text-[9px] uppercase tracking-wider text-pharmacy-gold-dark">{prof.full_name}</span>}
                                                                            </div>
                                                                            <span className="font-bold text-[9px] uppercase tracking-wider text-emerald-900 bg-white/60 px-1.5 py-0.5 rounded shrink-0 ml-2">Rm {details.appointment!.room_number}</span>
                                                                        </div>
                                                                    );
                                                                    interactionProps = { className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}` };
                                                                } else if (details.status === 'Holiday') {
                                                                    cellClass = 'bg-purple-50 border-purple-200 text-purple-600 opacity-90';
                                                                    cellContent = <span className="font-bold text-xs tracking-[0.1em] uppercase">{details.label}</span>;
                                                                    interactionProps = { className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}` };
                                                                } else if (details.status === 'Available') {
                                                                    cellClass = 'bg-white border-emerald-100 text-emerald-700 hover:bg-pharmacy-gold/15 cursor-pointer';
                                                                    interactionProps = { 
                                                                        className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}`,
                                                                        onClick: () => handleEmptySlotClick(currentDate, timeString)
                                                                    };
                                                                } else {
                                                                    cellClass = 'bg-pharmacy-cream border-pharmacy-ink/5 text-pharmacy-muted';
                                                                    interactionProps = { 
                                                                        className: `border-b px-2 py-0 transition-colors text-xs ${cellClass}`
                                                                    };
                                                                }

                                                                return (
                                                                    <tr key={`${hour}-${minute}`}>
                                                                        <td className="border-b border-r border-pharmacy-ink/10 px-4 py-2 text-center text-pharmacy-muted font-medium bg-pharmacy-cream/40">
                                                                            {timeString}
                                                                        </td>
                                                                        <td {...interactionProps}>
                                                                            <div className="w-full flex items-center justify-center h-full min-h-[36px]">
                                                                                {cellContent}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <AppointmentModal 
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSuccess={() => setRefreshKey(prev => prev + 1)}
                selectedProfessionalId={selectedProfessional}
                professionals={professionals}
                appointmentToEdit={appointmentToEdit}
                initialDate={prefilledDate}
                initialTime={prefilledTime}
                initialRoom={prefilledRoom}
            />
        </div>
    );
}