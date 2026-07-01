import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { DateTime } from 'luxon';
import AppointmentModal from './AppointmentModal';

// Shared global audio engine instance to bypass strict browser autoplay policies
let sharedAudioContext: AudioContext | null = null;

const unlockAudioEngine = () => {
    try {
        if (!sharedAudioContext) {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            sharedAudioContext = new AudioCtx();
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

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WORKING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

export default function Calendar() {
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

    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [appointmentToEdit, setAppointmentToEdit] = useState<Appointment | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    // 1. Hardware unlock mechanism binding
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
            if (!sharedAudioContext) {
                const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                sharedAudioContext = new AudioCtx();
            }
            
            if (sharedAudioContext.state === 'suspended') {
                sharedAudioContext.resume();
            }

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
            const { data: { user } } = await supabase.auth.getUser();
            const username = user?.user_metadata?.username || 'System';

            if (!error && data && data.length > 0) {
                setProfessionals(data);

                let lockedToOwnProfile = false;
                if (username.startsWith('D-')) {
                    const doctorNameSuffix = username.split('-')[1];
                    const matchingDoctor = data.find(p => p.full_name.includes(doctorNameSuffix));
                    if (matchingDoctor) {
                        setDoctorProfId(matchingDoctor.id);
                        setIsDoctor(true);
                        setSelectedProfessional(matchingDoctor.id.toString());
                        lockedToOwnProfile = true;
                    }
                }

                if (!lockedToOwnProfile) setSelectedProfessional(data[0].id.toString());
            }
            setIsStaffLoading(false);
        };
        fetchProfessionals();
    }, []);

    useEffect(() => {
        if (!selectedProfessional) return;

        const fetchProfessionalData = async () => {
            setIsDataLoading(true);
            const [availabilitiesResponse, appointmentsResponse] = await Promise.all([
                supabase.from('availabilities').select('*').eq('professional_id', selectedProfessional),
                supabase.from('appointments').select('*').eq('professional_id', selectedProfessional).order('start_time_utc', { ascending: true })
            ]);

            setAvailabilities(availabilitiesResponse.data || []);
            setAppointments(appointmentsResponse.data || []);
            setIsDataLoading(false);
        };
        fetchProfessionalData();
    }, [selectedProfessional, refreshKey]);

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
            alert('System Error: Infrastructure failed to cancel the appointment.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const handleReschedule = (appt: Appointment) => {
        setAppointmentToEdit(appt);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setAppointmentToEdit(null);
    };

    const formatTime = (timeStr: string) => timeStr.substring(0, 5);

    const groupedAvailabilities = availabilities.reduce((acc, curr) => {
        if (!acc[curr.day_of_week]) acc[curr.day_of_week] = [];
        acc[curr.day_of_week].push(curr);
        return acc;
    }, {} as Record<number, Availability[]>);

    const getCellStatus = (dayIndex: number, hour: number) => {
        const sqlDayIndex = dayIndex === 6 ? 0 : dayIndex + 1;
        
        const hasAppointment = appointments.some(appt => {
            const apptTime = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
            const apptSqlDay = apptTime.weekday === 7 ? 0 : apptTime.weekday;
            return apptSqlDay === sqlDayIndex && apptTime.hour === hour && appt.status !== 'cancelled';
        });
        
        if (hasAppointment) return 'bg-green-200 border-green-300 text-green-800 font-medium';

        const isAvailable = availabilities.some(avail => {
            const startHour = parseInt(avail.start_time.split(':')[0]);
            const endHour = parseInt(avail.end_time.split(':')[0]);
            return avail.day_of_week === sqlDayIndex && hour >= startHour && hour < endHour;
        });

        if (isAvailable) return 'bg-white border-gray-200';
        return 'bg-gray-200 border-gray-300';
    };

    return (
        <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm relative">
            
            {activeNotification && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md bg-slate-900 text-white p-4 rounded-xl shadow-2xl border border-slate-700 flex flex-col gap-2 animate-fadeIn">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                            <h4 className="font-black text-sm tracking-wide text-emerald-400 uppercase">New Appointment</h4>
                        </div>
                        <button onClick={() => setActiveNotification(null)} className="text-gray-400 hover:text-white font-bold text-xs bg-slate-800 p-1 px-2 rounded">Dismiss</button>
                    </div>
                    <p className="text-sm font-semibold">Patient <span className="text-blue-300">{activeNotification.clientName}</span> scheduled at <span className="text-blue-300">{activeNotification.startTime}</span>.</p>
                </div>
            )}

            <header className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Appointment Management</h1>
                    <p className="text-sm text-gray-500">Select a professional to view their availability</p>
                </div>
                <div className="flex items-center gap-4">
                    {isDoctor ? (
                        <div className="rounded-md border border-gray-300 bg-gray-50 p-2 text-gray-800 shadow-sm font-medium">
                            {isStaffLoading
                                ? 'Loading staff...'
                                : (() => {
                                    const own = professionals.find(p => p.id.toString() === selectedProfessional);
                                    return own ? `${own.full_name} (${own.specialty})` : 'Unknown professional';
                                })()}
                        </div>
                    ) : (
                        <select
                            value={selectedProfessional}
                            onChange={(e) => setSelectedProfessional(e.target.value)}
                            disabled={isStaffLoading || isDataLoading}
                            className="rounded-md border border-gray-300 bg-gray-50 p-2 text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        >
                            {isStaffLoading ? <option>Loading staff...</option> : professionals.map((prof) => (
                                <option key={prof.id} value={prof.id}>{prof.full_name} ({prof.specialty})</option>
                            ))}
                        </select>
                    )}
                    <button onClick={() => setIsModalOpen(true)} className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">+ New Appointment</button>
                </div>
            </header>
            
            <div className="flex-1 overflow-auto bg-gray-50 p-6">
                {isDataLoading ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white">
                        <p className="text-gray-500 animate-pulse">Syncing Malta databases...</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                            <h2 className="text-lg font-semibold text-gray-800">Weekly Schedule</h2>
                            <div className="flex rounded-md shadow-sm">
                                <button onClick={() => setViewMode('list')} className={`px-4 py-2 text-sm font-medium border border-gray-300 rounded-l-md ${viewMode === 'list' ? 'bg-blue-50 text-blue-600 z-10' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>List View</button>
                                <button onClick={() => setViewMode('grid')} className={`px-4 py-2 text-sm font-medium border border-gray-300 border-l-0 rounded-r-md ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600 z-10' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>Grid View</button>
                            </div>
                        </div>

                        {viewMode === 'list' ? (
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                    {Object.keys(groupedAvailabilities).length === 0 ? (
                                        <p className="text-sm text-gray-500">No schedules configured for this professional.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {Object.keys(groupedAvailabilities).map(Number).sort().map((sqlDayIndex) => {
                                                const uiDayIndex = sqlDayIndex === 0 ? 6 : sqlDayIndex - 1;
                                                return (
                                                    <div key={sqlDayIndex} className="border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                                                        <h3 className="font-semibold text-gray-800 mb-1">{DAYS_OF_WEEK[uiDayIndex]}</h3>
                                                        <ul className="space-y-1">
                                                            {groupedAvailabilities[sqlDayIndex].map((avail) => (
                                                                <li key={avail.id} className="text-sm text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 flex items-center">
                                                                    <span className="w-2 h-2 rounded-full bg-blue-400 mr-2"></span>
                                                                    {formatTime(avail.start_time)} - {formatTime(avail.end_time)}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm h-fit">
                                    <h3 className="font-semibold text-gray-800 mb-2">Booked Appointments</h3>
                                    {appointments.filter(a => a.status !== 'cancelled').length === 0 ? (
                                        <p className="text-sm text-gray-500">No active appointments booked yet.</p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {appointments.filter(a => a.status !== 'cancelled').map((appt) => {
                                                const apptTime = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
                                                const uiDayIndex = apptTime.weekday === 7 ? 6 : apptTime.weekday - 1;

                                                return (
                                                    <li key={appt.id} className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 flex flex-col gap-2">
                                                        <div className="flex justify-between items-start">
                                                            <div>
                                                                <div className="font-bold text-gray-800">{appt.client_name}</div>
                                                                <div className="text-xs text-gray-500 mt-0.5">
                                                                    {DAYS_OF_WEEK[uiDayIndex]} | {apptTime.toFormat('HH:mm')}
                                                                </div>
                                                                <div className="text-xs font-semibold text-blue-600 mt-1">Room {appt.room_number}</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2 justify-end mt-1 pt-2 border-t border-gray-200 border-dashed">
                                                            <button
                                                                onClick={() => handleReschedule(appt)}
                                                                disabled={actionLoadingId === appt.id}
                                                                className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-md font-bold hover:bg-blue-600 hover:text-white transition-all disabled:opacity-50"
                                                            >
                                                                Reschedule
                                                            </button>
                                                            <button
                                                                onClick={() => handleCancelAppointment(appt.id)}
                                                                disabled={actionLoadingId === appt.id}
                                                                className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-md font-bold hover:bg-red-600 hover:text-white transition-all disabled:opacity-50"
                                                            >
                                                                {actionLoadingId === appt.id ? '...' : 'Cancel'}
                                                            </button>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                <table className="w-full text-sm text-left border-collapse">
                                    <thead className="bg-gray-50 text-gray-700">
                                        <tr>
                                            <th className="border border-gray-200 px-4 py-3 font-semibold text-center w-24">Time</th>
                                            {[0, 1, 2, 3, 4, 5, 6].map(dayIndex => (
                                                <th key={dayIndex} className="border border-gray-200 px-4 py-3 font-semibold text-center">
                                                    {DAYS_OF_WEEK[dayIndex]}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {WORKING_HOURS.map(hour => (
                                            <tr key={hour}>
                                                <td className="border border-gray-200 px-4 py-2 text-center text-gray-600 font-medium bg-gray-50">
                                                    {hour.toString().padStart(2, '0')}:00
                                                </td>
                                                {[0, 1, 2, 3, 4, 5, 6].map(dayIndex => {
                                                    const cellClass = getCellStatus(dayIndex, hour);
                                                    return (
                                                        <td key={`${dayIndex}-${hour}`} className={`border px-2 py-4 text-center transition-colors text-xs ${cellClass}`}>
                                                            {cellClass.includes('green') ? 'Booked' : ''}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
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
            />
        </div>
    );
}