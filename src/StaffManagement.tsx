import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { getMaltaHolidays } from './holidays';
import { getErrorMessage } from './lib/errors';

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
    const [updatingDurationId, setUpdatingDurationId] = useState<number | null>(null);

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
        } catch (error) {
            setErrorMessage('Infrastructure error loading professionals: ' + getErrorMessage(error));
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
        } catch (error) {
            setErrorMessage('Infrastructure error loading availabilities: ' + getErrorMessage(error));
        }
    };

    useEffect(() => {
        fetchProfessionals();
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
        } catch (error) {
            setErrorMessage('Error inserting professional: ' + getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    };

    // Corrects a professional's consultation duration after registration (drives the Calendar grid's slot granularity)
    const updateProfessionalDuration = async (professionalId: number, newDurationMinutes: number) => {
        setErrorMessage('');
        setUpdatingDurationId(professionalId);
        try {
            const { error } = await supabase
                .from('professionals')
                .update({ default_duration_minutes: newDurationMinutes })
                .eq('id', professionalId);

            if (error) {
                throw new Error(error.message);
            }

            await fetchProfessionals();
        } catch (error) {
            setErrorMessage('Error updating consultation duration: ' + getErrorMessage(error));
        } finally {
            setUpdatingDurationId(null);
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
        } catch (error) {
            setErrorMessage('Error adding availability timeframe: ' + getErrorMessage(error));
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
        } catch (error) {
            setErrorMessage('Error purging schedule: ' + getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    };

    // Malta public holidays for the current and next year, from today onward
    const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');
    const upcomingHolidays = [
        ...getMaltaHolidays(today.year),
        ...getMaltaHolidays(today.year + 1)
    ].filter(h => DateTime.fromISO(h.date, { zone: 'Europe/Malta' }) >= today);

    return (
        <div className="p-6 bg-pharmacy-cream min-h-full flex flex-col gap-6">
            <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-pharmacy-gold-dark uppercase">Staff Management</p>
                <h1 className="font-display text-3xl text-pharmacy-ink">Register specialists and schedules</h1>
            </div>

            {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm font-medium">
                    {errorMessage}
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                {/* Specialist Registration Panel */}
                <div className="bg-white border border-pharmacy-ink/10 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                    <h2 className="font-display text-lg text-pharmacy-ink border-b pb-2 border-pharmacy-cream-dark">Register New Doctor</h2>
                    <form onSubmit={createProfessional} className="flex flex-col gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Full Name</label>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="E.g. Dr. Martha Spiteri"
                                className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Medical Specialty</label>
                            <input
                                type="text"
                                value={newSpecialty}
                                onChange={(e) => setNewSpecialty(e.target.value)}
                                placeholder="E.g. Clinical Psychology"
                                className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Consultation Duration</label>
                            <select
                                value={newDuration}
                                onChange={(e) => setNewDuration(e.target.value)}
                                className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                            >
                                <option value="15">15 minutes (General Medicine / Fast)</option>
                                <option value="30">30 minutes (Pediatrics / Dermatology)</option>
                                <option value="60">60 minutes (Psychology / Audits)</option>
                            </select>
                        </div>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-pharmacy-gold text-pharmacy-green rounded-full p-2.5 text-sm font-bold shadow-md hover:bg-pharmacy-gold-dark hover:text-white transition disabled:opacity-50"
                        >
                            {isLoading ? 'Processing insertion...' : 'Register Specialist'}
                        </button>
                    </form>

                    <div className="border-t border-pharmacy-cream-dark pt-4">
                        <h3 className="text-xs font-bold text-pharmacy-muted uppercase tracking-wider mb-2">Registered Specialists</h3>
                        {professionals.length === 0 ? (
                            <p className="text-xs text-pharmacy-muted">No specialists registered yet.</p>
                        ) : (
                            <ul className="flex flex-col gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                {professionals.map((p) => (
                                    <li key={p.id} className="flex items-center justify-between gap-2 text-xs bg-pharmacy-cream p-2 rounded-lg border border-pharmacy-ink/10">
                                        <div className="min-w-0">
                                            <span className="font-bold text-pharmacy-ink block truncate">{p.full_name}</span>
                                            <span className="text-pharmacy-muted">{p.specialty}</span>
                                        </div>
                                        <select
                                            value={p.default_duration_minutes}
                                            onChange={(e) => updateProfessionalDuration(p.id, parseInt(e.target.value))}
                                            disabled={updatingDurationId === p.id}
                                            aria-label={`Consultation duration for ${p.full_name}`}
                                            className="shrink-0 border border-pharmacy-ink/20 rounded p-1 text-xs bg-white focus:outline-none disabled:opacity-50"
                                        >
                                            <option value="15">15 min</option>
                                            <option value="30">30 min</option>
                                            <option value="60">60 min</option>
                                        </select>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Dynamic Schedule Configuration Panel */}
                <div className="bg-white border border-pharmacy-ink/10 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                    <h2 className="font-display text-lg text-pharmacy-ink border-b pb-2 border-pharmacy-cream-dark">Working Hours Configuration</h2>

                    <div>
                        <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Select Professional</label>
                        <select
                            value={selectedProfessional}
                            onChange={(e) => setSelectedProfessional(e.target.value)}
                            className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                        >
                            {professionals.map(p => (
                                <option key={p.id} value={p.id}>{p.full_name} ({p.specialty})</option>
                            ))}
                        </select>
                    </div>

                    <form onSubmit={addAvailability} className="grid grid-cols-4 gap-2 bg-pharmacy-cream p-3 rounded-lg border border-pharmacy-ink/10 items-end">
                        <div>
                            <label className="block text-xs font-bold text-pharmacy-muted mb-1">Day of Week</label>
                            <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="w-full border border-pharmacy-ink/20 rounded p-1 text-xs bg-white focus:outline-none">
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
                            <label className="block text-xs font-bold text-pharmacy-muted mb-1">Start Time</label>
                            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border border-pharmacy-ink/20 rounded p-1 text-xs bg-white focus:outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-pharmacy-muted mb-1">End Time</label>
                            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full border border-pharmacy-ink/20 rounded p-1 text-xs bg-white focus:outline-none" />
                        </div>
                        <div>
                            <button type="submit" disabled={isLoading || !selectedProfessional} className="w-full bg-pharmacy-green text-white rounded p-1.5 text-xs font-bold hover:bg-pharmacy-green-light transition disabled:opacity-50">
                                Add
                            </button>
                        </div>
                    </form>

                    <div className="flex-1 overflow-y-auto max-h-60 border border-pharmacy-ink/10 rounded-lg custom-scrollbar">
                        {availabilities.length === 0 ? (
                            <p className="text-xs text-pharmacy-muted p-4 text-center">No working hours assigned for this specialist.</p>
                        ) : (
                            <ul className="divide-y divide-pharmacy-cream-dark">
                                {availabilities.map(d => (
                                    <li key={d.id} className="p-3 text-xs flex justify-between items-center hover:bg-pharmacy-cream">
                                        <div>
                                            <span className="font-bold text-pharmacy-ink mr-2">{DAYS_OF_WEEK[d.day_of_week]}</span>
                                            <span className="text-pharmacy-muted bg-pharmacy-cream px-2 py-0.5 rounded font-mono">
                                                {d.start_time.substring(0, 5)} - {d.end_time.substring(0, 5)}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => deleteAvailability(d.id)}
                                            disabled={isLoading}
                                            className="text-red-700/80 font-bold hover:text-red-700 transition"
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
            <div className="bg-white border border-pharmacy-ink/10 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                <div className="border-b pb-2 border-pharmacy-cream-dark">
                    <h2 className="font-display text-lg text-pharmacy-ink">Malta Public Holidays</h2>
                    <p className="text-xs text-pharmacy-muted mt-0.5">
                        Bookings are strictly blocked on these dates. The pharmacy permanently remains closed on Malta public holidays.
                    </p>
                </div>

                <div className="max-h-72 overflow-y-auto border border-pharmacy-ink/10 rounded-lg custom-scrollbar pr-1">
                    <ul className="divide-y divide-pharmacy-cream-dark">
                        {upcomingHolidays.map(holiday => {
                            return (
                                <li key={holiday.date} className="p-3 text-xs flex justify-between items-center hover:bg-pharmacy-cream">
                                    <div>
                                        <span className="font-bold text-pharmacy-ink mr-2">
                                            {DateTime.fromISO(holiday.date).toFormat('dd/MM/yyyy')}
                                        </span>
                                        <span className="text-pharmacy-muted">{holiday.name}</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}