import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import AppointmentModal from './AppointmentModal';

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

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WORKING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

export default function Calendar() {
    // Core state tracking
    const [professionals, setProfessionals] = useState<Professional[]>([]);
    const [selectedProfessional, setSelectedProfessional] = useState<string>('');
    const [isStaffLoading, setIsStaffLoading] = useState(true);

    // Database reactive context
    const [availabilities, setAvailabilities] = useState<Availability[]>([]);
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [isDataLoading, setIsDataLoading] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

    // Interface visualization configuration
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // Synchronization sequencer to force state reload
    const [refreshKey, setRefreshKey] = useState(0);

    // Initial effect: Retrieve staff layout mapping
    useEffect(() => {
        const fetchProfessionals = async () => {
            const { data, error } = await supabase
                .from('professionals')
                .select('*')
                .order('id', { ascending: true });

            if (error) {
                console.error('Error fetching professionals:', error.message);
            } else if (data && data.length > 0) {
                setProfessionals(data);
                setSelectedProfessional(data[0].id.toString());
            }
            setIsStaffLoading(false);
        };

        fetchProfessionals();
    }, []);

    // Reactive effect: Downloads schedules and records
    useEffect(() => {
        if (!selectedProfessional) return;

        const fetchProfessionalData = async () => {
            setIsDataLoading(true);

            const [availabilitiesResponse, appointmentsResponse] = await Promise.all([
                supabase
                    .from('availabilities')
                    .select('*')
                    .eq('professional_id', selectedProfessional),
                
                supabase
                    .from('appointments')
                    .select('*')
                    .eq('professional_id', selectedProfessional)
                    .order('start_time_utc', { ascending: true })
            ]);

            if (availabilitiesResponse.error) {
                console.error('Error fetching availabilities:', availabilitiesResponse.error.message);
            } else {
                setAvailabilities(availabilitiesResponse.data || []);
            }

            if (appointmentsResponse.error) {
                console.error('Error fetching appointments:', appointmentsResponse.error.message);
            } else {
                setAppointments(appointmentsResponse.data || []);
            }

            setIsDataLoading(false);
        };

        fetchProfessionalData();
    }, [selectedProfessional, refreshKey]);

    // Data Mutation: Traditional execution flow to update status to cancelled
    const handleCancelAppointment = async (appointmentId: number) => {
        const confirmation = window.confirm('Are you strictly sure you want to cancel this appointment?');
        if (!confirmation) return;

        setActionLoadingId(appointmentId);
        try {
            const { error } = await supabase
                .from('appointments')
                .update({ status: 'cancelled' })
                .eq('id', appointmentId);

            if (error) {
                throw new Error(error.message);
            }

            // Trigger the sequencer to update the visual grid instantly
            setRefreshKey(prev => prev + 1);
        } catch (error) {
            alert('System Error: Infrastructure failed to cancel the appointment.');
        } finally {
            setActionLoadingId(null);
        }
    };

    const formatTime = (timeStr: string) => timeStr.substring(0, 5);

    const groupedAvailabilities = availabilities.reduce((acc, curr) => {
        if (!acc[curr.day_of_week]) acc[curr.day_of_week] = [];
        acc[curr.day_of_week].push(curr);
        return acc;
    }, {} as Record<number, Availability[]>);

    const getCellStatus = (dayIndex: number, hour: number) => {
        const hasAppointment = appointments.some(appt => {
            const apptDate = new Date(appt.start_time_utc);
            return apptDate.getDay() === dayIndex && apptDate.getHours() === hour && appt.status !== 'cancelled';
        });
        
        if (hasAppointment) return 'bg-green-200 border-green-300 text-green-800 font-medium';

        const isAvailable = availabilities.some(avail => {
            const startHour = parseInt(avail.start_time.split(':')[0]);
            const endHour = parseInt(avail.end_time.split(':')[0]);
            return avail.day_of_week === dayIndex && hour >= startHour && hour < endHour;
        });

        if (isAvailable) return 'bg-white border-gray-200';
        
        return 'bg-gray-200 border-gray-300';
    };

    return (
        <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
            <header className="flex flex-col gap-4 border-b border-gray-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Appointment Management</h1>
                    <p className="text-sm text-gray-500">Select a professional to view their availability</p>
                </div>
                
                <div className="flex items-center gap-4">
                    <select 
                        value={selectedProfessional}
                        onChange={(e) => setSelectedProfessional(e.target.value)}
                        disabled={isStaffLoading || isDataLoading}
                        className="rounded-md border border-gray-300 bg-gray-50 p-2 text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {isStaffLoading ? (
                            <option>Loading staff...</option>
                        ) : (
                            professionals.map((prof) => (
                                <option key={prof.id} value={prof.id}>
                                    {prof.full_name} ({prof.specialty})
                                </option>
                            ))
                        )}
                    </select>

                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700"
                    >
                        + New Appointment
                    </button>
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
                                <button 
                                    onClick={() => setViewMode('list')}
                                    className={`px-4 py-2 text-sm font-medium border border-gray-300 rounded-l-md ${viewMode === 'list' ? 'bg-blue-50 text-blue-600 z-10' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                >
                                    List View
                                </button>
                                <button 
                                    onClick={() => setViewMode('grid')}
                                    className={`px-4 py-2 text-sm font-medium border border-gray-300 border-l-0 rounded-r-md ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600 z-10' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                >
                                    Grid View
                                </button>
                            </div>
                        </div>

                        {viewMode === 'list' ? (
                            <div className="grid gap-6 md:grid-cols-2">
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                    {Object.keys(groupedAvailabilities).length === 0 ? (
                                        <p className="text-sm text-gray-500">No schedules configured for this professional.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {Object.keys(groupedAvailabilities).sort().map((dayStr) => {
                                                const dayIndex = parseInt(dayStr);
                                                return (
                                                    <div key={dayIndex} className="border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                                                        <h3 className="font-semibold text-gray-800 mb-1">{DAYS_OF_WEEK[dayIndex]}</h3>
                                                        <ul className="space-y-1">
                                                            {groupedAvailabilities[dayIndex].map((avail) => (
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
                                                const date = new Date(appt.start_time_utc);
                                                return (
                                                    <li key={appt.id} className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 flex items-center justify-between">
                                                        <div>
                                                            <div className="font-bold text-gray-800">{appt.client_name}</div>
                                                            <div className="text-xs text-gray-500 mt-0.5">
                                                                {DAYS_OF_WEEK[date.getDay()]} | {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </div>
                                                            <div className="text-xs font-semibold text-blue-600 mt-1">Room {appt.room_number}</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleCancelAppointment(appt.id)}
                                                            disabled={actionLoadingId === appt.id}
                                                            className="text-xs bg-red-50 text-red-600 border border-red-200 px-2.5 py-1.5 rounded-md font-bold hover:bg-red-600 hover:text-white hover:border-red-600 transition-all disabled:opacity-50"
                                                        >
                                                            {actionLoadingId === appt.id ? '...' : 'Cancel'}
                                                        </button>
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
                                            {[1, 2, 3, 4, 5, 6].map(dayIndex => (
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
                                                {[1, 2, 3, 4, 5, 6].map(dayIndex => {
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
                onClose={() => setIsModalOpen(false)}
                onSuccess={() => setRefreshKey(prev => prev + 1)}
                selectedProfessionalId={selectedProfessional}
                professionals={professionals}
            />
        </div>
    );
}