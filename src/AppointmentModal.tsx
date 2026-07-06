import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { getMaltaHolidayName } from './holidays';
import { useAuth } from './context/AuthContext';
import { getErrorMessage } from './lib/errors';
import { COUNTRY_DIAL_CODES, DEFAULT_COUNTRY_ISO2, findCountryByIso2, getFlagEmoji, splitStoredPhone } from './lib/countryCodes';

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

interface Room {
    id: number;
    room_number: number;
    label: string;
}

interface AppointmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    selectedProfessionalId: string;
    professionals: Professional[];
    appointmentToEdit?: Appointment | null;
    initialDate?: DateTime | null;
    initialTime?: string[];
    initialRoom?: string;
}

const extractNameAndNote = (fullName: string) => {
    const match = fullName.match(/^(.*?)(?:\s*\(([^)]+)\))?$/);
    return {
        name: match ? match[1].trim() : fullName,
        note: match && match[2] ? match[2].trim() : ''
    };
};

export default function AppointmentModal({ 
    isOpen, onClose, onSuccess, selectedProfessionalId, professionals, appointmentToEdit, initialDate, initialTime, initialRoom 
}: AppointmentModalProps) {
    const { role, username } = useAuth();
    const staffUsername = username ?? 'System';

    const [modalProfessionalId, setModalProfessionalId] = useState(selectedProfessionalId);
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [appointmentNote, setAppointmentNote] = useState('');
    const [countryIso2, setCountryIso2] = useState(DEFAULT_COUNTRY_ISO2);
    const [roomNumber, setRoomNumber] = useState('');
    const [rooms, setRooms] = useState<Room[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const [activePanel, setActivePanel] = useState<'NONE' | 'DATE' | 'TIME'>('NONE');
    const [confirmedDate, setConfirmedDate] = useState<DateTime | null>(null);
    const [confirmedTime, setConfirmedTime] = useState<string[]>([]);
    const [tempDate, setTempDate] = useState<DateTime | null>(null);
    const [tempTime, setTempTime] = useState<string[]>([]);

    const [monthAvailabilities, setMonthAvailabilities] = useState<Availability[]>([]);
    const [monthAppointments, setMonthAppointments] = useState<Appointment[]>([]);
    const [availableSlots, setAvailableSlots] = useState<{ time: string; isBooked: boolean }[]>([]);
    
    const [currentMonth, setCurrentMonth] = useState<DateTime>(DateTime.local({ zone: 'Europe/Malta' }));

    useEffect(() => {
        if (!isOpen) return;

        setActivePanel('NONE');
        setErrorMessage('');
        setCurrentMonth(DateTime.local({ zone: 'Europe/Malta' }));

        if (appointmentToEdit) {
            setModalProfessionalId(appointmentToEdit.professional_id.toString());
            setRoomNumber(appointmentToEdit.room_number.toString());

            const parsedData = extractNameAndNote(appointmentToEdit.client_name);
            setClientName(parsedData.name);
            setAppointmentNote(parsedData.note);

            const { iso2, localNumber } = splitStoredPhone(appointmentToEdit.client_phone);
            setCountryIso2(iso2);
            setClientPhone(localNumber);

            const oldStart = DateTime.fromISO(appointmentToEdit.start_time_utc, { zone: 'Europe/Malta' });
            const oldEnd = DateTime.fromISO(appointmentToEdit.end_time_utc, { zone: 'Europe/Malta' });
            
            setConfirmedDate(oldStart);
            setCurrentMonth(oldStart);

            const diffMinutes = oldEnd.diff(oldStart, 'minutes').minutes;
            const currentProfessional = professionals.find(p => p.id === appointmentToEdit.professional_id);
            const duration = currentProfessional ? currentProfessional.default_duration_minutes : 15;
            
            const slotsCount = Math.max(1, Math.round(diffMinutes / duration));
            const times = [];
            for (let i = 0; i < slotsCount; i++) {
                times.push(oldStart.plus({ minutes: i * duration }).toFormat('HH:mm'));
            }
            setConfirmedTime(times);
            setTempTime(times);

        } else if (initialDate && initialTime && initialTime.length > 0) {
            setModalProfessionalId((selectedProfessionalId === 'ALL' || selectedProfessionalId === 'MONTH_SUMMARY') ? (professionals[0]?.id.toString() || '') : selectedProfessionalId);
            setConfirmedDate(initialDate);
            setConfirmedTime(initialTime);
            setTempDate(initialDate);
            setTempTime(initialTime);
            setCurrentMonth(initialDate);
            setClientName('');
            setClientPhone('');
            setAppointmentNote('');
            setCountryIso2(DEFAULT_COUNTRY_ISO2);
            setRoomNumber(initialRoom || '');
            setActivePanel('NONE');
        } else {
            setModalProfessionalId((selectedProfessionalId === 'ALL' || selectedProfessionalId === 'MONTH_SUMMARY') ? (professionals[0]?.id.toString() || '') : selectedProfessionalId);
            setConfirmedDate(null);
            setConfirmedTime([]);
            setClientName('');
            setClientPhone('');
            setAppointmentNote('');
            setCountryIso2(DEFAULT_COUNTRY_ISO2);
            setRoomNumber('');
            setTempTime([]);
        }

        if (role === 'doctor' && username) {
            const doctorName = username.split('-')[1];
            const matchingProf = professionals.find(p => p.full_name.includes(doctorName));
            if (matchingProf) setModalProfessionalId(matchingProf.id.toString());
        }
    }, [isOpen, selectedProfessionalId, professionals, appointmentToEdit, role, username, initialDate, initialTime, initialRoom]);

    useEffect(() => {
        if (!isOpen) return;

        const fetchRooms = async () => {
            const { data, error } = await supabase.from('rooms').select('*').order('room_number', { ascending: true });
            if (!error && data) setRooms(data);
        };
        fetchRooms();
    }, [isOpen]);

    // Backfills the default clinic room once the room list loads, without disturbing a room
    // the user (or an edited appointment, or a grid deep-link) has already selected
    useEffect(() => {
        if (!isOpen || appointmentToEdit || roomNumber || rooms.length === 0) return;
        setRoomNumber(rooms[0].room_number.toString());
    }, [isOpen, appointmentToEdit, roomNumber, rooms]);

    // The pharmacy is strictly closed on Sundays and Malta public holidays, regardless of any
    // availability rows that might exist for that day (e.g. a mistaken Sunday schedule entry).
    const isHolidayBlocked = (dateObj: DateTime): boolean => {
        if (dateObj.weekday === 7) return true; // 7 is Sunday in Luxon
        const dateISO = dateObj.toISODate();
        if (!dateISO) return false;
        return getMaltaHolidayName(dateISO) !== null;
    };

    const getHolidayName = (dateObj: DateTime): string | null => {
        if (dateObj.weekday === 7) return 'Sunday (Closed)';
        const dateISO = dateObj.toISODate();
        if (!dateISO) return null;
        return getMaltaHolidayName(dateISO);
    };

    useEffect(() => {
        if (!isOpen || !modalProfessionalId) return;

        const fetchMonthData = async () => {
            const startOfMonth = currentMonth.startOf('month').toUTC().toISO();
            const endOfMonth = currentMonth.endOf('month').toUTC().toISO();
            if (!startOfMonth || !endOfMonth) return;

            const [availRes, apptRes] = await Promise.all([
                supabase.from('availabilities').select('*').eq('professional_id', modalProfessionalId),
                supabase.from('appointments').select('*').eq('professional_id', modalProfessionalId)
                    .gte('start_time_utc', startOfMonth)
                    .lte('start_time_utc', endOfMonth)
            ]);
            
            setMonthAvailabilities(availRes.data || []);
            setMonthAppointments(apptRes.data || []);
        };
        fetchMonthData();
    }, [modalProfessionalId, currentMonth, isOpen]);

    useEffect(() => {
        if (!confirmedDate || !modalProfessionalId) return;
        
        const sqlDayOfWeek = confirmedDate.weekday === 7 ? 0 : confirmedDate.weekday;
        const selectedDateString = confirmedDate.toISODate(); 
        
        const dayAvails = monthAvailabilities.filter(a => a.day_of_week === sqlDayOfWeek);
        const currentProfessional = professionals.find(p => p.id.toString() === modalProfessionalId);
        const duration = currentProfessional ? currentProfessional.default_duration_minutes : 15;

        const generatedSlots: { time: string; isBooked: boolean }[] = [];

        dayAvails.forEach(avail => {
            let currentSlot = DateTime.fromISO(`${selectedDateString}T${avail.start_time}`, { zone: 'Europe/Malta' });
            const endTime = DateTime.fromISO(`${selectedDateString}T${avail.end_time}`, { zone: 'Europe/Malta' });

            while (currentSlot < endTime) {
                const timeString = currentSlot.toFormat('HH:mm');
                const isBooked = monthAppointments.some(appt => {
                    const apptStart = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
                    const apptEnd = DateTime.fromISO(appt.end_time_utc, { zone: 'Europe/Malta' });
                    
                    if (appointmentToEdit && appt.id === appointmentToEdit.id) return false;
                    return appt.status !== 'cancelled' && currentSlot >= apptStart && currentSlot < apptEnd;
                });

                generatedSlots.push({ time: timeString, isBooked });
                currentSlot = currentSlot.plus({ minutes: duration });
            }
        });

        generatedSlots.sort((a, b) => a.time.localeCompare(b.time));
        setAvailableSlots(generatedSlots);
    }, [confirmedDate, monthAvailabilities, monthAppointments, modalProfessionalId, professionals, appointmentToEdit]);

    if (!isOpen) return null;

    const handlePhoneInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const onlyNumbers = e.target.value.replace(/\D/g, '');
        if (onlyNumbers.length <= 15) setClientPhone(onlyNumbers);
    };

    const handleNoteInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAppointmentNote(value);
        
        if (!value.trim()) {
            if (tempTime.length > 1) setTempTime([tempTime[0]]);
            if (confirmedTime.length > 1) setConfirmedTime([confirmedTime[0]]);
        }
    };

    const handleTimeSelection = (time: string) => {
        if (!appointmentNote.trim()) {
            setTempTime([time]);
            return;
        }

        if (tempTime.includes(time)) {
            setTempTime(tempTime.filter(t => t !== time));
            return;
        }

        if (tempTime.length === 0) {
            setTempTime([time]);
        } else if (tempTime.length === 1) {
            const currentProfessional = professionals.find(p => p.id.toString() === modalProfessionalId);
            const duration = currentProfessional ? currentProfessional.default_duration_minutes : 15;
            
            const time1 = DateTime.fromFormat(tempTime[0], 'HH:mm');
            const time2 = DateTime.fromFormat(time, 'HH:mm');
            const diff = Math.abs(time1.diff(time2, 'minutes').minutes);
            
            if (diff === duration) {
                setTempTime([...tempTime, time].sort());
            } else {
                setTempTime([time]); 
            }
        } else {
            setTempTime([time]); 
        }
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        setIsSubmitting(true);

        if (!clientName.trim() || clientPhone.length < 8 || !confirmedDate || confirmedTime.length === 0 || !roomNumber) {
            setErrorMessage('All fields are required. Phone must be at least 8 digits.');
            setIsSubmitting(false);
            return;
        }

        const currentProfessional = professionals.find(p => p.id.toString() === modalProfessionalId);
        const durationMinutes = currentProfessional ? currentProfessional.default_duration_minutes : 15;

        const dateString = confirmedDate.toISODate();
        const startDateTime = DateTime.fromISO(`${dateString}T${confirmedTime[0]}`, { zone: 'Europe/Malta' });
        const durationMultiplier = confirmedTime.length;
        const endDateTime = startDateTime.plus({ minutes: durationMinutes * durationMultiplier });

        if (startDateTime < DateTime.local({ zone: 'Europe/Malta' })) {
            setErrorMessage('Validation Error: Cannot book an appointment in the past.');
            setIsSubmitting(false);
            return;
        }

        const finalClientName = appointmentNote.trim() 
            ? `${clientName.trim()} (${appointmentNote.trim()})`
            : clientName.trim();

        const selectedDialCode = findCountryByIso2(countryIso2).dialCode;

        let isRollbackNeeded = false;

        try {
            if (appointmentToEdit) {
                const { error: cancelError } = await supabase
                    .from('appointments')
                    .update({ status: 'cancelled' })
                    .eq('id', appointmentToEdit.id);

                if (cancelError) throw new Error('System failed to clear original slot.');
                isRollbackNeeded = true;
            }

            const { error: rpcError } = await supabase.rpc('book_appointment_secure', {
                p_professional_id: parseInt(modalProfessionalId),
                p_room_number: parseInt(roomNumber),
                p_client_name: finalClientName,
                p_client_phone: `${selectedDialCode} ${clientPhone}`,
                p_start_time_utc: startDateTime.toUTC().toISO(),
                p_end_time_utc: endDateTime.toUTC().toISO(),
                p_staff_username: staffUsername
            });

            if (rpcError) {
                if (isRollbackNeeded && appointmentToEdit) {
                    await supabase
                        .from('appointments')
                        .update({ status: 'confirmed' })
                        .eq('id', appointmentToEdit.id);
                }
                throw new Error(rpcError.message);
            }
            
            onSuccess();
            onClose();
        } catch (error) {
            setErrorMessage(getErrorMessage(error, 'System error during reservation.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const getDayColorClass = (dateObj: DateTime, isSelected: boolean) => {
        const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');

        if (isSelected) return 'bg-pharmacy-gold text-pharmacy-green shadow-md ring-2 ring-pharmacy-gold/40 font-semibold';
        if (dateObj < today) return 'bg-pharmacy-cream-dark text-pharmacy-muted cursor-not-allowed opacity-60';
        if (isHolidayBlocked(dateObj)) return 'bg-purple-50 text-purple-500 border border-purple-200 cursor-not-allowed opacity-80 line-through';

        const sqlDayOfWeek = dateObj.weekday === 7 ? 0 : dateObj.weekday;
        const dayAvails = monthAvailabilities.filter(a => a.day_of_week === sqlDayOfWeek);
        if (dayAvails.length === 0) return 'bg-pharmacy-cream-dark text-pharmacy-muted cursor-not-allowed opacity-60';

        let totalSlots = 0;
        let bookedSlots = 0;
        const currentProfessional = professionals.find(p => p.id.toString() === modalProfessionalId);
        const duration = currentProfessional ? currentProfessional.default_duration_minutes : 15;
        const selectedDateString = dateObj.toISODate();

        dayAvails.forEach(avail => {
            let currentSlot = DateTime.fromISO(`${selectedDateString}T${avail.start_time}`, { zone: 'Europe/Malta' });
            const endTime = DateTime.fromISO(`${selectedDateString}T${avail.end_time}`, { zone: 'Europe/Malta' });
            while (currentSlot < endTime) {
                totalSlots++;
                const isBooked = monthAppointments.some(appt => {
                    const apptStart = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
                    const apptEnd = DateTime.fromISO(appt.end_time_utc, { zone: 'Europe/Malta' });
                    
                    if (appointmentToEdit && appt.id === appointmentToEdit.id) return false;
                    return appt.status !== 'cancelled' && currentSlot >= apptStart && currentSlot < apptEnd;
                });
                if (isBooked) bookedSlots++;
                currentSlot = currentSlot.plus({ minutes: duration });
            }
        });

        if (totalSlots === 0) return 'bg-pharmacy-cream-dark text-pharmacy-muted cursor-not-allowed opacity-60';
        if (bookedSlots >= totalSlots) return 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-semibold';

        return 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:shadow-sm font-semibold transition-all';
    };

    const renderCalendarInner = () => {
        const daysInMonth = currentMonth.daysInMonth ?? 30;
        const firstDayIndex = (currentMonth.startOf('month').weekday + 6) % 7;
        const days = [];

        for (let i = 0; i < firstDayIndex; i++) {
            days.push(<div key={`empty-${i}`} className="h-9"></div>);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dateObj = currentMonth.set({ day: i });
            const isSelected = tempDate?.toISODate() === dateObj.toISODate();
            const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');
            const sqlDayOfWeek = dateObj.weekday === 7 ? 0 : dateObj.weekday;
            const holidayName = getHolidayName(dateObj);
            const isDisabled = (dateObj < today) || isHolidayBlocked(dateObj) || !monthAvailabilities.some(a => a.day_of_week === sqlDayOfWeek);

            days.push(
                <button
                    key={i}
                    type="button"
                    onClick={() => !isDisabled && setTempDate(dateObj)}
                    disabled={isDisabled}
                    title={holidayName ?? undefined}
                    className={`h-9 w-full rounded-md text-sm transition-colors ${getDayColorClass(dateObj, isSelected)}`}
                >
                    {i}
                </button>
            );
        }

        return (
            <>
                <div className="flex items-center justify-between mb-4 px-2 shrink-0">
                    <button type="button" onClick={() => setCurrentMonth(currentMonth.minus({ months: 1 }))} className="p-1 hover:bg-pharmacy-cream rounded text-pharmacy-ink">←</button>
                    <span className="font-display text-lg text-pharmacy-ink">{currentMonth.toFormat('MMMM yyyy')}</span>
                    <button type="button" onClick={() => setCurrentMonth(currentMonth.plus({ months: 1 }))} className="p-1 hover:bg-pharmacy-cream rounded text-pharmacy-ink">→</button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center mb-2 text-xs font-bold text-pharmacy-muted shrink-0">
                    <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
                </div>

                <div className="grid grid-cols-7 gap-1 shrink-0">
                    {days}
                </div>

                <div className="flex flex-wrap justify-center gap-4 mt-6 mb-2 text-xs font-medium text-pharmacy-muted shrink-0">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-pharmacy-cream-dark"></span> Unavailable</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-100 border border-emerald-300"></span> Available</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-300"></span> Booked</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-50 border border-purple-200"></span> Holiday</div>
                </div>
            </>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-pharmacy-green/50 p-4 backdrop-blur-sm">
            <div className="flex flex-col md:flex-row w-full max-w-4xl h-fit max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-y-auto md:overflow-hidden border border-pharmacy-ink/10">

                <div className="w-full md:w-1/2 p-6 border-b md:border-b-0 md:border-r border-pharmacy-cream-dark bg-pharmacy-cream/40 flex flex-col">
                    <h2 className="font-display text-2xl text-pharmacy-ink mb-4 shrink-0">
                        {appointmentToEdit ? 'Reschedule Appointment' : 'Book Appointment'}
                    </h2>

                    {errorMessage && (
                        <div className="mb-4 rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-600 font-medium shrink-0">
                            {errorMessage}
                        </div>
                    )}

                    <form onSubmit={handleFormSubmit} className="space-y-4 flex-1 flex flex-col">
                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Attending Professional</label>
                            {role === 'doctor' ? (
                                <div className="w-full rounded-lg border border-pharmacy-ink/15 bg-pharmacy-cream-dark p-2 text-pharmacy-muted font-medium">
                                    {(() => {
                                        const own = professionals.find(p => p.id.toString() === modalProfessionalId);
                                        return own ? `${own.full_name} (${own.specialty})` : 'Unknown professional';
                                    })()}
                                </div>
                            ) : (
                                <select
                                    value={modalProfessionalId}
                                    onChange={(e) => setModalProfessionalId(e.target.value)}
                                    className="w-full rounded-lg border border-pharmacy-ink/20 p-2 text-pharmacy-ink shadow-sm focus:border-pharmacy-gold focus:ring-2 focus:ring-pharmacy-gold/20"
                                >
                                    {professionals.map(prof => (
                                        <option key={prof.id} value={prof.id}>{prof.full_name} ({prof.specialty})</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Patient Full Name</label>
                            <input
                                type="text"
                                value={clientName}
                                onChange={(e) => setClientName(e.target.value)}
                                className="w-full rounded-lg border border-pharmacy-ink/20 p-2 shadow-sm focus:border-pharmacy-gold focus:ring-2 focus:ring-pharmacy-gold/20"
                                placeholder="John Doe"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Mobile Number</label>
                            <div className="flex shadow-sm rounded-lg overflow-hidden border border-pharmacy-ink/20 focus-within:border-pharmacy-gold focus-within:ring-2 focus-within:ring-pharmacy-gold/20 bg-white">
                                <div className="relative shrink-0 border-r border-pharmacy-ink/20">
                                    <select
                                        value={countryIso2}
                                        onChange={(e) => setCountryIso2(e.target.value)}
                                        aria-label="Country dial code"
                                        className="h-full appearance-none bg-pharmacy-cream-dark pl-3 pr-7 py-2 text-sm font-bold text-pharmacy-ink focus:outline-none cursor-pointer hover:bg-pharmacy-cream-dark/70 transition-colors"
                                    >
                                        {COUNTRY_DIAL_CODES.map((country) => (
                                            <option key={country.iso2} value={country.iso2} title={country.name}>
                                                {getFlagEmoji(country.iso2)}  {country.dialCode}
                                            </option>
                                        ))}
                                    </select>
                                    <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-pharmacy-gold-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path>
                                    </svg>
                                </div>
                                <input
                                    type="text"
                                    value={clientPhone}
                                    onChange={handlePhoneInput}
                                    className="w-full p-2 focus:outline-none"
                                    placeholder="99998888"
                                />
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Appointment Note (Optional)</label>
                            <input
                                type="text"
                                value={appointmentNote}
                                onChange={handleNoteInput}
                                className="w-full rounded-lg border border-pharmacy-ink/20 p-2 shadow-sm focus:border-pharmacy-gold focus:ring-2 focus:ring-pharmacy-gold/20"
                                placeholder="E.g. Blood test, Ear surgery"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Date</label>
                                <button
                                    type="button"
                                    onClick={() => setActivePanel('DATE')}
                                    className={`w-full text-left rounded-lg border p-2 shadow-sm transition-colors ${activePanel === 'DATE' ? 'border-pharmacy-gold ring-2 ring-pharmacy-gold/20 bg-pharmacy-gold/10' : 'border-pharmacy-ink/20 bg-white hover:bg-pharmacy-cream'}`}
                                >
                                    {confirmedDate ? confirmedDate.toFormat('dd/MM/yyyy') : <span className="text-pharmacy-muted">Select day...</span>}
                                </button>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Start Time</label>
                                <button
                                    type="button"
                                    disabled={!confirmedDate}
                                    onClick={() => setActivePanel('TIME')}
                                    className={`w-full text-left rounded-lg border p-2 shadow-sm transition-colors disabled:bg-pharmacy-cream-dark disabled:text-pharmacy-muted disabled:cursor-not-allowed ${activePanel === 'TIME' ? 'border-pharmacy-gold ring-2 ring-pharmacy-gold/20 bg-pharmacy-gold/10' : 'border-pharmacy-ink/20 bg-white hover:bg-pharmacy-cream'}`}
                                >
                                    {confirmedTime.length > 0 ? (
                                        confirmedTime.length === 1 ? confirmedTime[0] : `${confirmedTime[0]} & ${confirmedTime[1]}`
                                    ) : (
                                        <span className={!confirmedDate ? 'text-pharmacy-muted' : 'text-pharmacy-muted'}>Select time...</span>
                                    )}
                                </button>
                            </div>
                        </div>

                        <div className="pt-1">
                            <label className="block text-sm font-semibold text-pharmacy-ink mb-2">Assigned Clinic Room</label>
                            {rooms.length === 0 ? (
                                <p className="text-xs text-pharmacy-muted">No clinic rooms registered. Add one in Staff Management first.</p>
                            ) : (
                                <div className="flex items-center gap-6 flex-wrap">
                                    {rooms.map(room => (
                                        <label key={room.id} className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="room"
                                                value={room.room_number}
                                                checked={roomNumber === room.room_number.toString()}
                                                onChange={(e) => setRoomNumber(e.target.value)}
                                                className="w-4 h-4 text-pharmacy-gold-dark border-pharmacy-ink/30 focus:ring-pharmacy-gold"
                                            />
                                            <span className="text-sm text-pharmacy-ink font-medium">{room.label}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-auto pt-4 border-t border-pharmacy-cream-dark flex justify-between items-center shrink-0">
                            <button type="button" onClick={onClose} disabled={isSubmitting} className="text-sm font-semibold text-pharmacy-muted hover:text-pharmacy-ink transition">
                                Cancel & Close
                            </button>
                            <button type="submit" disabled={isSubmitting || !clientName || clientPhone.length < 8 || !confirmedDate || confirmedTime.length === 0 || !roomNumber} className="rounded-full bg-pharmacy-gold px-6 py-2.5 text-sm font-bold text-pharmacy-green shadow-md hover:bg-pharmacy-gold-dark hover:text-white disabled:bg-gray-300 disabled:text-white disabled:shadow-none transition-all">
                                {isSubmitting ? 'Saving...' : (appointmentToEdit ? 'Confirm Reschedule' : 'Confirm Appointment')}
                            </button>
                        </div>
                    </form>
                </div>

                <div className="w-full md:w-1/2 p-6 bg-white flex flex-col">
                    {activePanel === 'NONE' && (
                        <div className="m-auto flex flex-col items-center justify-center text-pharmacy-muted">
                            <svg className="w-16 h-16 mb-4 text-pharmacy-cream-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <p className="text-center font-medium">Click on Date or Time<br/>to open the configuration panel.</p>
                        </div>
                    )}

                    {activePanel === 'DATE' && (
                        <>
                            <h3 className="font-display text-lg text-pharmacy-ink mb-6 shrink-0">Select Appointment Date</h3>
                            {renderCalendarInner()}
                            <div className="mt-auto pt-4 border-t border-pharmacy-cream-dark flex justify-end shrink-0">
                                <button
                                    type="button"
                                    onClick={() => { if (tempDate) { setConfirmedDate(tempDate); setConfirmedTime([]); setActivePanel('NONE'); } }}
                                    disabled={!tempDate}
                                    className="bg-pharmacy-gold text-pharmacy-green px-6 py-2.5 rounded-full font-bold text-sm disabled:opacity-50 disabled:shadow-none shadow-md hover:bg-pharmacy-gold-dark hover:text-white transition-all"
                                >
                                    Save Date
                                </button>
                            </div>
                        </>
                    )}

                    {activePanel === 'TIME' && (
                        <>
                            <div className="shrink-0">
                                <h3 className="font-display text-lg text-pharmacy-ink mb-1">Select Time Slot</h3>
                                <p className="text-sm text-pharmacy-muted mb-4 pb-4 border-b border-pharmacy-cream-dark">Availability for {confirmedDate?.toFormat('dd/MM/yyyy')}</p>
                            </div>

                            {availableSlots.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-pharmacy-muted bg-pharmacy-cream rounded-lg border border-dashed border-pharmacy-ink/15 p-6 text-center">
                                    No available working hours for this professional today.
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                    <div className="grid grid-cols-3 gap-3 pb-2">
                                        {availableSlots.map((slot, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                disabled={slot.isBooked}
                                                onClick={() => handleTimeSelection(slot.time)}
                                                className={`p-3 rounded-lg border-2 text-sm font-bold transition-all ${
                                                    slot.isBooked
                                                        ? 'bg-red-50 border-red-100 text-red-400 cursor-not-allowed line-through'
                                                        : tempTime.includes(slot.time)
                                                            ? 'bg-pharmacy-gold border-pharmacy-gold text-pharmacy-green shadow-md transform scale-105'
                                                            : 'bg-white border-emerald-100 text-emerald-700 hover:border-pharmacy-gold hover:text-pharmacy-gold-dark hover:bg-pharmacy-gold/10'
                                                }`}
                                            >
                                                {slot.time}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-auto pt-4 border-t border-pharmacy-cream-dark flex justify-end shrink-0">
                                <button
                                    type="button"
                                    onClick={() => { if (tempTime.length > 0) { setConfirmedTime(tempTime); setActivePanel('NONE'); } }}
                                    disabled={tempTime.length === 0}
                                    className="bg-pharmacy-gold text-pharmacy-green px-6 py-2.5 rounded-full font-bold text-sm disabled:opacity-50 disabled:shadow-none shadow-md hover:bg-pharmacy-gold-dark hover:text-white transition-all"
                                >
                                    Save Time
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}