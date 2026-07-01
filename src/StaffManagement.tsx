import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { DateTime } from 'luxon';
import { getMaltaHolidays } from './holidays';

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

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function StaffManagement() {
    const [professionals, setProfessionals] = useState<Professional[]>([]);
    const [selectedProfessional, setSelectedProfessional] = useState<string>('');
    const [availabilities, setAvailabilities] = useState<Availability[]>([]);
    
    // States for the new professional registration form
    const [newName, setNewName] = useState('');
    const [newSpecialty, setNewSpecialty] = useState('');
    const [newDuration, setNewDuration] = useState('15');
    
    // States for weekly availability assignment
    const [newDay, setNewDay] = useState('1'); 
    const [startTime, setStartTime] = useState('08:00');
    const [endTime, setEndTime] = useState('14:00');

    const [errorMessage, setErrorMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // States for Malta public holiday overrides
    const [openHolidayOverrides, setOpenHolidayOverrides] = useState<Set<string>>(new Set());
    const [holidayActionLoading, setHolidayActionLoading] = useState<string | null>(null);
    const [staffUsername, setStaffUsername] = useState('System');

    // Retrieves the complete list of clinic specialists
    const fetchProfessionals = async () => {
        try {
            const { data, error } = await supabase
                .from('professionals')
                .select('*')
                .order('id', { ascending: true });

            if (error) {
                throw new Error(error.message);
            }
            if (data) {
                setProfessionals(data);
                if (data.length > 0 && !selectedProfessional) {
                    setSelectedProfessional(data[0].id.toString());
                }
            }
        } catch (error: any) {
            setErrorMessage('Infrastructure error loading professionals: ' + error.message);
        }
    };

    // Retrieves the weekly schedule for the selected specialist
    const fetchAvailabilities = async () => {
        if (!selectedProfessional) return;
        try {
            const { data, error } = await supabase
                .from('availabilities')
                .select('*')
                .eq('professional_id', selectedProfessional)
                .order('day_of_week', { ascending: true })
                .order('start_time', { ascending: true });

            if (error) {
                throw new Error(error.message);
            }
            setAvailabilities(data || []);
        } catch (error: any) {
            setErrorMessage('Infrastructure error loading availabilities: ' + error.message);
        }
    };

    // Retrieves the dates the pharmacy explicitly opted to open despite being a Malta public holiday
    const fetchHolidayOverrides = async () => {
        try {
            const { data, error } = await supabase.from('holiday_overrides').select('holiday_date');
            if (error) throw new Error(error.message);
            setOpenHolidayOverrides(new Set((data || []).map(row => row.holiday_date)));
        } catch (error: any) {
            setErrorMessage('Infrastructure error loading holiday overrides: ' + error.message);
        }
    };

    useEffect(() => {
        fetchProfessionals();
        fetchHolidayOverrides();

        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setStaffUsername(user?.user_metadata?.username || 'System');
        };
        fetchUser();
    }, []);

    useEffect(() => {
        fetchAvailabilities();
    }, [selectedProfessional]);

    // Inserts a new medical record into the database
    const createProfessional = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        
        // Fail-fast validation
        if (!newName.trim() || !newSpecialty.trim()) {
            setErrorMessage('Validation Error: All professional fields are strictly required.');
            return;
        }

        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('professionals')
                .insert({
                    full_name: newName.trim(),
                    specialty: newSpecialty.trim(),
                    default_duration_minutes: parseInt(newDuration)
                });

            if (error) {
                throw new Error(error.message);
            }

            setNewName('');
            setNewSpecialty('');
            setNewDuration('15');
            await fetchProfessionals();
        } catch (error: any) {
            setErrorMessage('Error inserting professional: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Inserts a new working timeframe controlling Postgres time formats
    const addAvailability = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        
        // Fail-fast validation
        if (!selectedProfessional) return;

        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('availabilities')
                .insert({
                    professional_id: parseInt(selectedProfessional),
                    day_of_week: parseInt(newDay),
                    start_time: startTime + ':00',
                    end_time: endTime + ':00'
                });

            if (error) {
                throw new Error(error.message);
            }

            await fetchAvailabilities();
        } catch (error: any) {
            setErrorMessage('Error adding availability timeframe: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Purges a working shift, instantly freeing that slot in the predictive calendar
    const deleteAvailability = async (scheduleId: number) => {
        const confirmation = window.confirm('Are you strictly sure you want to permanently delete this working schedule?');
        if (!confirmation) return;

        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('availabilities')
                .delete()
                .eq('id', scheduleId);

            if (error) {
                throw new Error(error.message);
            }

            await fetchAvailabilities();
        } catch (error: any) {
            setErrorMessage('Error purging schedule: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Toggles a Malta public holiday between blocked (default) and open as a normal working day
    const toggleHolidayOverride = async (holidayDate: string, isCurrentlyOpen: boolean) => {
        setHolidayActionLoading(holidayDate);
        try {
            if (isCurrentlyOpen) {
                const { error } = await supabase.from('holiday_overrides').delete().eq('holiday_date', holidayDate);
                if (error) throw new Error(error.message);
            } else {
                const { error } = await supabase.from('holiday_overrides').insert({
                    holiday_date: holidayDate,
                    created_by_username: staffUsername
                });
                if (error) throw new Error(error.message);
            }
            await fetchHolidayOverrides();
        } catch (error: any) {
            setErrorMessage('Error updating holiday override: ' + error.message);
        } finally {
            setHolidayActionLoading(null);
        }
    };

    // Malta public holidays for the current and next year, from today onward
    const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');
    const upcomingHolidays = [
        ...getMaltaHolidays(today.year),
        ...getMaltaHolidays(today.year + 1)
    ].filter(h => DateTime.fromISO(h.date, { zone: 'Europe/Malta' }) >= today);

    return (
        <div className="p-6 bg-gray-50 min-h-full flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-800">Staff Management</h1>
                <p className="text-sm text-gray-500">Register specialists and dynamically reconfigure Malta schedules.</p>
            </div>

            {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm font-medium">
                    {errorMessage}
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                {/* Specialist Registration Panel */}
                <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                    <h2 className="text-lg font-bold text-gray-800 border-b pb-2 border-gray-100">Register New Doctor</h2>
                    <form onSubmit={createProfessional} className="flex flex-col gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name</label>
                            <input 
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="E.g. Dr. Martha Spiteri"
                                className="w-full border border-gray-300 rounded-lg p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Medical Specialty</label>
                            <input 
                                type="text"
                                value={newSpecialty}
                                onChange={(e) => setNewSpecialty(e.target.value)}
                                placeholder="E.g. Clinical Psychology"
                                className="w-full border border-gray-300 rounded-lg p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Consultation Duration</label>
                            <select
                                value={newDuration}
                                onChange={(e) => setNewDuration(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="15">15 minutes (General Medicine / Fast)</option>
                                <option value="30">30 minutes (Pediatrics / Dermatology)</option>
                                <option value="60">60 minutes (Psychology / Audits)</option>
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-blue-600 text-white rounded-lg p-2.5 text-sm font-bold shadow-md hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            {isLoading ? 'Processing insertion...' : 'Register Specialist'}
                        </button>
                    </form>
                </div>

                {/* Dynamic Schedule Configuration Panel */}
                <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                    <h2 className="text-lg font-bold text-gray-800 border-b pb-2 border-gray-100">Working Hours Configuration</h2>
                    
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Select Professional</label>
                        <select
                            value={selectedProfessional}
                            onChange={(e) => setSelectedProfessional(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            {professionals.map(p => (
                                <option key={p.id} value={p.id}>{p.full_name} ({p.specialty})</option>
                            ))}
                        </select>
                    </div>

                    <form onSubmit={addAvailability} className="grid grid-cols-4 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100 items-end">
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Day of Week</label>
                            <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="w-full border border-gray-300 rounded p-1 text-xs bg-white focus:outline-none">
                                <option value="1">Monday</option>
                                <option value="2">Tuesday</option>
                                <option value="3">Wednesday</option>
                                <option value="4">Thursday</option>
                                <option value="5">Friday</option>
                                <option value="6">Saturday</option>
                                <option value="0">Sunday</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Start Time</label>
                            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border border-gray-300 rounded p-1 text-xs bg-white focus:outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">End Time</label>
                            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full border border-gray-300 rounded p-1 text-xs bg-white focus:outline-none" />
                        </div>
                        <div>
                            <button type="submit" disabled={isLoading || !selectedProfessional} className="w-full bg-emerald-600 text-white rounded p-1.5 text-xs font-bold hover:bg-emerald-700 transition disabled:opacity-50">
                                Add
                            </button>
                        </div>
                    </form>

                    <div className="flex-1 overflow-y-auto max-h-60 border border-gray-100 rounded-lg">
                        {availabilities.length === 0 ? (
                            <p className="text-xs text-gray-400 p-4 text-center">No working hours assigned for this specialist.</p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {availabilities.map(d => (
                                    <li key={d.id} className="p-3 text-xs flex justify-between items-center hover:bg-gray-50">
                                        <div>
                                            <span className="font-bold text-gray-700 mr-2">{DAYS_OF_WEEK[d.day_of_week]}</span>
                                            <span className="text-gray-600 bg-gray-100 px-2 py-0.5 rounded font-mono">
                                                {d.start_time.substring(0, 5)} - {d.end_time.substring(0, 5)}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => deleteAvailability(d.id)}
                                            disabled={isLoading}
                                            className="text-red-600 font-bold hover:text-red-800 transition"
                                        >
                                            Delete
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {/* Malta Public Holidays Panel */}
            <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                <div className="border-b pb-2 border-gray-100">
                    <h2 className="text-lg font-bold text-gray-800">Malta Public Holidays</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Bookings are blocked on these dates by default. Mark a holiday as "Open" if the pharmacy will operate as usual that day.
                    </p>
                </div>

                <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg">
                    <ul className="divide-y divide-gray-100">
                        {upcomingHolidays.map(holiday => {
                            const isOpen = openHolidayOverrides.has(holiday.date);
                            const isActionLoading = holidayActionLoading === holiday.date;
                            return (
                                <li key={holiday.date} className="p-3 text-xs flex justify-between items-center hover:bg-gray-50">
                                    <div>
                                        <span className="font-bold text-gray-700 mr-2">
                                            {DateTime.fromISO(holiday.date).toFormat('dd/MM/yyyy')}
                                        </span>
                                        <span className="text-gray-600">{holiday.name}</span>
                                        <span className={`ml-2 px-2 py-0.5 rounded-full font-bold ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-600'}`}>
                                            {isOpen ? 'Open' : 'Holiday (Blocked)'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => toggleHolidayOverride(holiday.date, isOpen)}
                                        disabled={isActionLoading}
                                        className={`font-bold transition disabled:opacity-50 ${isOpen ? 'text-purple-600 hover:text-purple-800' : 'text-emerald-600 hover:text-emerald-800'}`}
                                    >
                                        {isActionLoading ? '...' : (isOpen ? 'Revert to Holiday' : 'Mark as Open')}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}