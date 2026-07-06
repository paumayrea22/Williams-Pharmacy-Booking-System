import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { useAuth } from './context/AuthContext';
import { getErrorMessage } from './lib/errors';

interface Professional {
    id: number;
    full_name: string;
    specialty: string;
}

interface DoctorLeave {
    id: number;
    professional_id: number;
    leave_date: string;
}

interface Availability {
    id: number;
    professional_id: number;
    day_of_week: number;
    start_time: string;
    end_time: string;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function DoctorLeaveManagement() {
    const { role, username } = useAuth();
    const staffUsername = username ?? 'System';

    const [professionals, setProfessionals] = useState<Professional[]>([]);
    const [selectedProfessional, setSelectedProfessional] = useState<string>('');
    const [leaves, setLeaves] = useState<DoctorLeave[]>([]);
    const [availabilities, setAvailabilities] = useState<Availability[]>([]);
    
    const [selectedDates, setSelectedDates] = useState<string[]>([]);
    const [manualDateInput, setManualDateInput] = useState<string>('');
    const [currentMonth, setCurrentMonth] = useState<DateTime>(DateTime.local({ zone: 'Europe/Malta' }));

    const [errorMessage, setErrorMessage] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const fetchProfessionals = async () => {
        try {
            const { data, error } = await supabase
                .from('professionals')
                .select('id, full_name, specialty')
                .order('id', { ascending: true });

            if (error) throw new Error(error.message);
            
            if (data && data.length > 0) {
                setProfessionals(data);
                if (role === 'doctor' && username) {
                    const doctorNameSuffix = username.split('-')[1];
                    const ownProfile = data.find(p => p.full_name.includes(doctorNameSuffix));
                    if (ownProfile) {
                        setSelectedProfessional(ownProfile.id.toString());
                        return;
                    }
                }
                setSelectedProfessional(data[0].id.toString());
            }
        } catch (error) {
            setErrorMessage('Infrastructure error loading doctors: ' + getErrorMessage(error));
        }
    };

    const fetchDoctorLeaves = async () => {
        if (!selectedProfessional) return;
        try {
            const { data, error } = await supabase
                .from('doctor_leaves')
                .select('*')
                .eq('professional_id', selectedProfessional)
                .order('leave_date', { ascending: true });

            if (error) throw new Error(error.message);
            setLeaves(data || []);
        } catch (error) {
            setErrorMessage('Infrastructure error loading leaves: ' + getErrorMessage(error));
        }
    };

    const fetchProfessionalSchedule = async () => {
        if (!selectedProfessional) return;
        try {
            const { data, error } = await supabase
                .from('availabilities')
                .select('*')
                .eq('professional_id', selectedProfessional)
                .order('day_of_week', { ascending: true })
                .order('start_time', { ascending: true });

            if (error) throw new Error(error.message);
            setAvailabilities(data || []);
        } catch (error) {
            setErrorMessage('Infrastructure error loading schedule: ' + getErrorMessage(error));
        }
    };

    useEffect(() => {
        fetchProfessionals();
    }, [role, username]);

    useEffect(() => {
        fetchDoctorLeaves();
        fetchProfessionalSchedule();
        setSelectedDates([]);
    }, [selectedProfessional]);

    const handleDateToggle = (dateISO: string) => {
        if (selectedDates.includes(dateISO)) {
            setSelectedDates(selectedDates.filter(d => d !== dateISO));
        } else {
            setSelectedDates([...selectedDates, dateISO].sort());
        }
    };

    const handleManualAdd = (e: React.MouseEvent) => {
        e.preventDefault();
        setErrorMessage('');

        if (!manualDateInput.trim()) return;

        let parsed = DateTime.fromFormat(manualDateInput.trim(), 'dd/MM/yyyy', { zone: 'Europe/Malta' });
        if (!parsed.isValid) {
            parsed = DateTime.fromFormat(manualDateInput.trim(), 'yyyy-MM-dd', { zone: 'Europe/Malta' });
        }

        if (!parsed.isValid) {
            setErrorMessage('Validation Error: Use a valid date format (DD/MM/YYYY or YYYY-MM-DD).');
            return;
        }

        const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');
        if (parsed < today) {
            setErrorMessage('Validation Error: Cannot declare vacation time in the past.');
            return;
        }

        if (parsed.weekday === 7) {
            setErrorMessage('Validation Error: Sundays are closed by default across the system.');
            return;
        }

        const dateISO = parsed.toISODate()!;
        if (selectedDates.includes(dateISO)) {
            setErrorMessage('Validation Error: Target date is already present in the active batch.');
            return;
        }

        setSelectedDates([...selectedDates, dateISO].sort());
        setManualDateInput('');
    };

    const handleBatchSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');

        if (selectedDates.length === 0) {
            setErrorMessage('Validation Error: The batch allocation buffer is completely empty.');
            return;
        }

        setIsLoading(true);
        try {
            const batchPayload = selectedDates.map(dateStr => ({
                professional_id: parseInt(selectedProfessional),
                leave_date: dateStr,
                created_by_username: staffUsername
            }));

            const { error } = await supabase
                .from('doctor_leaves')
                .insert(batchPayload);

            if (error) throw new Error(error.message);

            setSelectedDates([]);
            await fetchDoctorLeaves();
        } catch (error) {
            setErrorMessage('Error inserting vacation batch payload: ' + getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteLeave = async (leaveId: number) => {
        const confirmation = window.confirm('Are you strictly sure you want to permanently delete this vacation slot?');
        if (!confirmation) return;

        setIsLoading(true);
        try {
            const { error } = await supabase
                .from('doctor_leaves')
                .delete()
                .eq('id', leaveId);

            if (error) throw new Error(error.message);

            await fetchDoctorLeaves();
        } catch (error) {
            setErrorMessage('Error purging vacation slot: ' + getErrorMessage(error));
        } finally {
            setIsLoading(false);
        }
    };

    const renderCalendarGrid = () => {
        const daysInMonth = currentMonth.daysInMonth ?? 30;
        const firstDayIndex = (currentMonth.startOf('month').weekday + 6) % 7;
        const matrixSlots = [];

        for (let i = 0; i < firstDayIndex; i++) {
            matrixSlots.push(<div key={`empty-${i}`} className="h-9"></div>);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dateObj = currentMonth.set({ day: i });
            const dateISO = dateObj.toISODate()!;
            
            const isSelected = selectedDates.includes(dateISO);
            const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');
            
            const isPast = dateObj < today;
            const isSunday = dateObj.weekday === 7;
            const isDisabled = isPast || isSunday;

            let cellStyle = 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-semibold';
            if (isDisabled) {
                cellStyle = 'bg-pharmacy-cream-dark text-pharmacy-muted cursor-not-allowed opacity-40 line-through';
            } else if (isSelected) {
                cellStyle = 'bg-pharmacy-gold text-pharmacy-green shadow-md ring-2 ring-pharmacy-gold/40 font-bold scale-105';
            }

            matrixSlots.push(
                <button
                    key={i}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleDateToggle(dateISO)}
                    className={`h-9 w-full rounded-md text-sm transition-all duration-150 ${cellStyle}`}
                >
                    {i}
                </button>
            );
        }

        return (
            <div className="flex flex-col bg-pharmacy-cream/30 p-4 rounded-xl border border-pharmacy-ink/10">
                <div className="flex items-center justify-between mb-3 shrink-0">
                    <button type="button" onClick={() => setCurrentMonth(currentMonth.minus({ months: 1 }))} className="p-1 hover:bg-pharmacy-cream-dark rounded text-pharmacy-ink font-bold">←</button>
                    <span className="font-display text-base text-pharmacy-ink">{currentMonth.toFormat('MMMM yyyy')}</span>
                    <button type="button" onClick={() => setCurrentMonth(currentMonth.plus({ months: 1 }))} className="p-1 hover:bg-pharmacy-cream-dark rounded text-pharmacy-ink font-bold">→</button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center mb-1 text-xs font-bold text-pharmacy-muted">
                    <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {matrixSlots}
                </div>
            </div>
        );
    };

    return (
        <div className="p-6 bg-pharmacy-cream h-screen overflow-y-auto custom-scrollbar flex flex-col gap-6 pb-16">
            <div>
                <p className="text-xs font-semibold tracking-[0.2em] text-pharmacy-gold-dark uppercase">Vacation Controls</p>
                <h1 className="font-display text-3xl text-pharmacy-ink">Manage Doctor Leave Schemes</h1>
            </div>

            {errorMessage && (
                <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm font-medium">
                    {errorMessage}
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                {/* Configuration Panel */}
                <div className="bg-white border border-pharmacy-ink/10 p-5 rounded-xl shadow-sm flex flex-col gap-4">
                    <h2 className="font-display text-lg text-pharmacy-ink border-b pb-2 border-pharmacy-cream-dark">Schedule Time Off</h2>
                    
                    <div>
                        <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Target Professional</label>
                        {role === 'doctor' ? (
                            <div className="w-full rounded-lg border border-pharmacy-ink/15 bg-pharmacy-cream-dark p-2 text-pharmacy-muted font-medium text-sm">
                                {professionals.find(p => p.id.toString() === selectedProfessional)?.full_name || 'Loading profile...'}
                            </div>
                        ) : (
                            <select
                                value={selectedProfessional}
                                onChange={(e) => setSelectedProfessional(e.target.value)}
                                className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                            >
                                {professionals.map(p => (
                                    <option key={p.id} value={p.id}>{p.full_name} ({p.specialty})</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Integrated Doctor Timetable Reference Feed */}
                    <div className="bg-pharmacy-cream/40 border border-pharmacy-ink/10 rounded-xl p-3.5 flex flex-col gap-2">
                        <span className="text-xs font-bold text-pharmacy-gold-dark uppercase tracking-wider">Active Standard Weekly Schedule</span>
                        {availabilities.length === 0 ? (
                            <p className="text-xs text-pharmacy-muted italic">No working shifts mapped for this professional in the system.</p>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {availabilities.map(a => (
                                    <div key={a.id} className="text-xs flex items-center gap-2 bg-white p-1.5 rounded border border-pharmacy-ink/5">
                                        <span className="font-bold text-pharmacy-ink">{DAYS_OF_WEEK[a.day_of_week].substring(0, 3)}:</span>
                                        <span className="font-mono text-pharmacy-muted">{a.start_time.substring(0, 5)} - {a.end_time.substring(0, 5)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleBatchSubmit} className="flex flex-col gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Add Date Manually (Type or Click below)</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={manualDateInput}
                                    onChange={(e) => setManualDateInput(e.target.value)}
                                    placeholder="E.g. 15/07/2026"
                                    className="w-full border border-pharmacy-ink/20 rounded-lg p-2 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold bg-white"
                                />
                                <button
                                    type="button"
                                    onClick={handleManualAdd}
                                    className="bg-pharmacy-green text-white font-bold px-4 py-2 rounded-lg text-sm hover:bg-pharmacy-green-light transition animate-none"
                                >
                                    Add
                                </button>
                            </div>
                        </div>

                        {renderCalendarGrid()}

                        <div>
                            <span className="block text-xs font-bold text-pharmacy-muted uppercase tracking-wider mb-1">Selected Days Batch ({selectedDates.length})</span>
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto bg-pharmacy-cream/20 p-2 rounded-lg border border-pharmacy-ink/5 custom-scrollbar">
                                {selectedDates.length === 0 ? (
                                    <span className="text-xs text-pharmacy-muted italic">No days appended to batch yet. Click calendar blocks.</span>
                                ) : (
                                    selectedDates.map(d => (
                                        <span key={d} className="inline-flex items-center gap-1 text-[11px] font-mono font-bold bg-pharmacy-gold/20 text-pharmacy-gold-dark px-2 py-0.5 rounded border border-pharmacy-gold/30">
                                            {DateTime.fromISO(d).toFormat('dd/MM/yyyy')}
                                            <button type="button" onClick={() => handleDateToggle(d)} className="text-red-700 font-extrabold hover:text-red-900 ml-1">×</button>
                                        </span>
                                    ))
                                )}
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading || !selectedProfessional || selectedDates.length === 0}
                            className="w-full bg-pharmacy-gold text-pharmacy-green rounded-full p-2.5 text-sm font-bold shadow-md hover:bg-pharmacy-gold-dark hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Processing Batch Insertion...' : `Save All Selected Days (${selectedDates.length})`}
                        </button>
                    </form>
                </div>

                {/* Leaves List Panel */}
                <div className="bg-white border border-pharmacy-ink/10 p-5 rounded-xl shadow-sm flex flex-col gap-4 h-fit">
                    <h2 className="font-display text-lg text-pharmacy-ink border-b pb-2 border-pharmacy-cream-dark">Active Vacation Slots</h2>
                    
                    <div className="overflow-y-auto max-h-[600px] border border-pharmacy-ink/10 rounded-lg custom-scrollbar">
                        {leaves.length === 0 ? (
                            <p className="text-xs text-pharmacy-muted p-4 text-center">No leave days currently registered for this scope.</p>
                        ) : (
                            <ul className="divide-y divide-pharmacy-cream-dark">
                                {leaves.map(l => (
                                    <li key={l.id} className="p-3 text-xs flex justify-between items-center hover:bg-pharmacy-cream">
                                        <div>
                                            <span className="font-bold text-pharmacy-ink mr-2">
                                                {DateTime.fromISO(l.leave_date).toFormat('dd/MM/yyyy')}
                                            </span>
                                            <span className="text-pharmacy-muted">
                                                ({DateTime.fromISO(l.leave_date).toFormat('cccc')})
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteLeave(l.id)}
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
        </div>
    );
}