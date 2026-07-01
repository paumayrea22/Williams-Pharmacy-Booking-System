import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { DateTime } from 'luxon';
import { getMaltaHolidayName } from './holidays';

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

interface AppointmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    selectedProfessionalId: string;
    professionals: Professional[];
    appointmentToEdit?: Appointment | null; // Nueva propiedad para inyectar datos
}

export default function AppointmentModal({ isOpen, onClose, onSuccess, selectedProfessionalId, professionals, appointmentToEdit }: AppointmentModalProps) {
    const [currentUserRole, setCurrentUserRole] = useState<'PHARMACIST' | 'DOCTOR'>('PHARMACIST');
    const [staffUsername, setStaffUsername] = useState('System');
    
    const [modalProfessionalId, setModalProfessionalId] = useState(selectedProfessionalId);
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [roomNumber, setRoomNumber] = useState('1');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const [activePanel, setActivePanel] = useState<'NONE' | 'DATE' | 'TIME'>('NONE');
    const [confirmedDate, setConfirmedDate] = useState<DateTime | null>(null);
    const [confirmedTime, setConfirmedTime] = useState<string | null>(null);
    const [tempDate, setTempDate] = useState<DateTime | null>(null);
    const [tempTime, setTempTime] = useState<string | null>(null);

    const [monthAvailabilities, setMonthAvailabilities] = useState<Availability[]>([]);
    const [monthAppointments, setMonthAppointments] = useState<Appointment[]>([]);
    const [availableSlots, setAvailableSlots] = useState<{ time: string; isBooked: boolean }[]>([]);
    const [openHolidayOverrides, setOpenHolidayOverrides] = useState<Set<string>>(new Set());
    
    const [currentMonth, setCurrentMonth] = useState<DateTime>(DateTime.local({ zone: 'Europe/Malta' }));

    // Efecto de inicialización e inyección de datos de edición
    useEffect(() => {
        if (!isOpen) return;
        
        setActivePanel('NONE');
        setErrorMessage('');
        setCurrentMonth(DateTime.local({ zone: 'Europe/Malta' }));

        if (appointmentToEdit) {
            // Rellenar formulario con los datos de la cita existente
            setModalProfessionalId(appointmentToEdit.professional_id.toString());
            setClientName(appointmentToEdit.client_name);
            setClientPhone(appointmentToEdit.client_phone);
            setRoomNumber(appointmentToEdit.room_number.toString());
            
            const oldDate = DateTime.fromISO(appointmentToEdit.start_time_utc, { zone: 'Europe/Malta' });
            setConfirmedDate(oldDate);
            setConfirmedTime(oldDate.toFormat('HH:mm'));
            setCurrentMonth(oldDate);
        } else {
            // Formulario vacío por defecto para nuevas reservas
            setModalProfessionalId(selectedProfessionalId);
            setConfirmedDate(null);
            setConfirmedTime(null);
            setClientName('');
            setClientPhone('');
            setRoomNumber('1');
        }
        setTempDate(null);
        setTempTime(null);

        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const username = user?.user_metadata?.username || 'System';
            setStaffUsername(username);
            
            if (username.startsWith('D-')) {
                setCurrentUserRole('DOCTOR');
                const doctorName = username.split('-')[1];
                const matchingProf = professionals.find(p => p.full_name.includes(doctorName));
                if (matchingProf) setModalProfessionalId(matchingProf.id.toString());
            } else {
                setCurrentUserRole('PHARMACIST');
            }
        };
        fetchUser();

        const fetchHolidayOverrides = async () => {
            const { data } = await supabase.from('holiday_overrides').select('holiday_date');
            setOpenHolidayOverrides(new Set((data || []).map(row => row.holiday_date)));
        };
        fetchHolidayOverrides();
    }, [isOpen, selectedProfessionalId, professionals, appointmentToEdit]);

    // Un día es festivo bloqueado en Malta salvo que el staff lo haya marcado explícitamente como abierto
    const isHolidayBlocked = (dateObj: DateTime): boolean => {
        const dateISO = dateObj.toISODate();
        if (!dateISO) return false;
        return getMaltaHolidayName(dateISO) !== null && !openHolidayOverrides.has(dateISO);
    };

    const getHolidayName = (dateObj: DateTime): string | null => {
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
                    const apptDate = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
                    // Ignorar la cita actual si estamos en modo edición para no auto-bloquearse
                    if (appointmentToEdit && appt.id === appointmentToEdit.id) return false;
                    
                    return apptDate.toISODate() === selectedDateString &&
                           apptDate.toFormat('HH:mm') === timeString &&
                           appt.status !== 'cancelled';
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
        if (onlyNumbers.length <= 9) setClientPhone(onlyNumbers);
    };

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        setIsSubmitting(true);

        if (!clientName.trim() || clientPhone.length < 8 || !confirmedDate || !confirmedTime) {
            setErrorMessage('All fields are required. Phone must be at least 8 digits.');
            setIsSubmitting(false);
            return;
        }

        const currentProfessional = professionals.find(p => p.id.toString() === modalProfessionalId);
        const durationMinutes = currentProfessional ? currentProfessional.default_duration_minutes : 15;

        const dateString = confirmedDate.toISODate();
        const startDateTime = DateTime.fromISO(`${dateString}T${confirmedTime}`, { zone: 'Europe/Malta' });
        const endDateTime = startDateTime.plus({ minutes: durationMinutes });

        if (startDateTime < DateTime.local({ zone: 'Europe/Malta' })) {
            setErrorMessage('Validation Error: Cannot book an appointment in the past.');
            setIsSubmitting(false);
            return;
        }

        let isRollbackNeeded = false;

        try {
            // Fase 1: Si es una modificación, cancelar temporalmente la original
            if (appointmentToEdit) {
                const { error: cancelError } = await supabase
                    .from('appointments')
                    .update({ status: 'cancelled' })
                    .eq('id', appointmentToEdit.id);

                if (cancelError) throw new Error('System failed to clear original slot.');
                isRollbackNeeded = true;
            }

            // Fase 2: Ejecutar RPC de seguridad con los nuevos datos
            const { error: rpcError } = await supabase.rpc('book_appointment_secure', {
                p_professional_id: parseInt(modalProfessionalId),
                p_room_number: parseInt(roomNumber),
                p_client_name: clientName.trim(),
                p_client_phone: clientPhone,
                p_start_time_utc: startDateTime.toUTC().toISO(),
                p_end_time_utc: endDateTime.toUTC().toISO(),
                p_staff_username: staffUsername
            });

            // Fase 3: Evaluación de Rollback (Revertir cambios si RPC falla)
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
        } catch (error: any) {
            setErrorMessage(error.message || 'System error during reservation.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const getDayColorClass = (dateObj: DateTime, isSelected: boolean) => {
        const today = DateTime.local({ zone: 'Europe/Malta' }).startOf('day');
        
        if (isSelected) return 'bg-blue-600 text-white shadow-md ring-2 ring-blue-300';
        if (dateObj < today) return 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60';
        if (isHolidayBlocked(dateObj)) return 'bg-purple-50 text-purple-500 border border-purple-200 cursor-not-allowed opacity-80 line-through';

        const sqlDayOfWeek = dateObj.weekday === 7 ? 0 : dateObj.weekday;
        const dayAvails = monthAvailabilities.filter(a => a.day_of_week === sqlDayOfWeek);
        if (dayAvails.length === 0) return 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60';

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
                const timeString = currentSlot.toFormat('HH:mm');
                const isBooked = monthAppointments.some(appt => {
                    const apptDate = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
                    if (appointmentToEdit && appt.id === appointmentToEdit.id) return false;
                    return apptDate.toISODate() === selectedDateString &&
                           apptDate.toFormat('HH:mm') === timeString &&
                           appt.status !== 'cancelled';
                });
                if (isBooked) bookedSlots++;
                currentSlot = currentSlot.plus({ minutes: duration });
            }
        });

        if (totalSlots === 0) return 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60';
        if (bookedSlots >= totalSlots) return 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-semibold';
        
        return 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:shadow-sm font-semibold transition-all';
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
                    <button type="button" onClick={() => setCurrentMonth(currentMonth.minus({ months: 1 }))} className="p-1 hover:bg-gray-100 rounded text-gray-600">←</button>
                    <span className="font-semibold text-gray-800">{currentMonth.toFormat('MMMM yyyy')}</span>
                    <button type="button" onClick={() => setCurrentMonth(currentMonth.plus({ months: 1 }))} className="p-1 hover:bg-gray-100 rounded text-gray-600">→</button>
                </div>
                
                <div className="grid grid-cols-7 gap-1 text-center mb-2 text-xs font-bold text-gray-400 shrink-0">
                    <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
                </div>
                
                <div className="grid grid-cols-7 gap-1 shrink-0">
                    {days}
                </div>

                <div className="flex flex-wrap justify-center gap-4 mt-6 mb-2 text-xs font-medium text-gray-500 shrink-0">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-200"></span> Unavailable</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-300"></span> Available</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-300"></span> Booked</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-50 border border-purple-200"></span> Holiday</div>
                </div>
            </>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="flex w-full max-w-4xl h-fit max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
                
                <div className="w-1/2 p-6 border-r border-gray-100 bg-gray-50/30 flex flex-col">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4 shrink-0">
                        {appointmentToEdit ? 'Reschedule Appointment' : 'Book Appointment'}
                    </h2>
                    
                    {errorMessage && (
                        <div className="mb-4 rounded-lg bg-red-50 border border-red-100 p-3 text-sm text-red-600 font-medium shrink-0">
                            {errorMessage}
                        </div>
                    )}

                    <form onSubmit={handleFormSubmit} className="space-y-4 flex-1 flex flex-col">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Attending Professional</label>
                            {currentUserRole === 'DOCTOR' ? (
                                <div className="w-full rounded-lg border border-gray-300 bg-gray-100 p-2 text-gray-500 font-medium">
                                    {(() => {
                                        const own = professionals.find(p => p.id.toString() === modalProfessionalId);
                                        return own ? `${own.full_name} (${own.specialty})` : 'Unknown professional';
                                    })()}
                                </div>
                            ) : (
                                <select
                                    value={modalProfessionalId}
                                    onChange={(e) => setModalProfessionalId(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 p-2 text-gray-800 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                >
                                    {professionals.map(prof => (
                                        <option key={prof.id} value={prof.id}>{prof.full_name} ({prof.specialty})</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Patient Full Name</label>
                            <input 
                                type="text"
                                value={clientName}
                                onChange={(e) => setClientName(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                placeholder="John Doe"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">Mobile Number</label>
                            <div className="flex shadow-sm rounded-lg overflow-hidden border border-gray-300 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 bg-white">
                                <span className="flex items-center justify-center bg-gray-100 px-3 text-sm font-medium text-gray-600 border-r border-gray-300">
                                    +356
                                </span>
                                <input 
                                    type="text"
                                    value={clientPhone}
                                    onChange={handlePhoneInput}
                                    className="w-full p-2 focus:outline-none"
                                    placeholder="99998888"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                                <button 
                                    type="button"
                                    onClick={() => setActivePanel('DATE')}
                                    className={`w-full text-left rounded-lg border p-2 shadow-sm transition-colors ${activePanel === 'DATE' ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50/50' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                                >
                                    {confirmedDate ? confirmedDate.toFormat('dd/MM/yyyy') : <span className="text-gray-400">Select day...</span>}
                                </button>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Start Time</label>
                                <button 
                                    type="button"
                                    disabled={!confirmedDate}
                                    onClick={() => setActivePanel('TIME')}
                                    className={`w-full text-left rounded-lg border p-2 shadow-sm transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed ${activePanel === 'TIME' ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50/50' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                                >
                                    {confirmedTime ? confirmedTime : <span className={!confirmedDate ? 'text-gray-400' : 'text-gray-500'}>Select time...</span>}
                                </button>
                            </div>
                        </div>

                        <div className="pt-1">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Assigned Clinic Room</label>
                            <div className="flex items-center gap-6">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="room" value="1" checked={roomNumber === '1'} onChange={(e) => setRoomNumber(e.target.value)} className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"/>
                                    <span className="text-sm text-gray-700 font-medium">Room 1</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="radio" name="room" value="2" checked={roomNumber === '2'} onChange={(e) => setRoomNumber(e.target.value)} className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"/>
                                    <span className="text-sm text-gray-700 font-medium">Room 2</span>
                                </label>
                            </div>
                        </div>

                        <div className="mt-auto pt-4 border-t border-gray-200 flex justify-between items-center shrink-0">
                            <button type="button" onClick={onClose} disabled={isSubmitting} className="text-sm font-semibold text-gray-500 hover:text-gray-800 transition">
                                Cancel & Close
                            </button>
                            <button type="submit" disabled={isSubmitting || !clientName || clientPhone.length < 8 || !confirmedDate || !confirmedTime} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-blue-700 disabled:bg-gray-300 disabled:shadow-none transition-all">
                                {isSubmitting ? 'Saving...' : (appointmentToEdit ? 'Confirm Reschedule' : 'Confirm Appointment')}
                            </button>
                        </div>
                    </form>
                </div>

                <div className="w-1/2 p-6 bg-white flex flex-col">
                    {activePanel === 'NONE' && (
                        <div className="m-auto flex flex-col items-center justify-center text-gray-400">
                            <svg className="w-16 h-16 mb-4 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            <p className="text-center font-medium">Click on Date or Time<br/>to open the configuration panel.</p>
                        </div>
                    )}

                    {activePanel === 'DATE' && (
                        <>
                            <h3 className="text-lg font-bold text-gray-800 mb-6 shrink-0">Select Appointment Date</h3>
                            {renderCalendarInner()}
                            <div className="mt-auto pt-4 border-t border-gray-200 flex justify-end shrink-0">
                                <button
                                    type="button"
                                    onClick={() => { if (tempDate) { setConfirmedDate(tempDate); setConfirmedTime(null); setActivePanel('NONE'); } }}
                                    disabled={!tempDate}
                                    className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold text-sm disabled:opacity-50 disabled:shadow-none shadow-md hover:bg-blue-700 transition-all"
                                >
                                    Save Date
                                </button>
                            </div>
                        </>
                    )}

                    {activePanel === 'TIME' && (
                        <>
                            <div className="shrink-0">
                                <h3 className="text-lg font-bold text-gray-800 mb-1">Select Time Slot</h3>
                                <p className="text-sm text-gray-500 mb-4 pb-4 border-b border-gray-100">Availability for {confirmedDate?.toFormat('dd/MM/yyyy')}</p>
                            </div>
                            
                            {availableSlots.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300 p-6 text-center">
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
                                                onClick={() => setTempTime(slot.time)}
                                                className={`p-3 rounded-lg border-2 text-sm font-bold transition-all ${
                                                    slot.isBooked 
                                                        ? 'bg-red-50 border-red-100 text-red-400 cursor-not-allowed line-through' 
                                                        : tempTime === slot.time
                                                            ? 'bg-blue-600 border-blue-600 text-white shadow-md transform scale-105'
                                                            : 'bg-white border-blue-100 text-blue-700 hover:border-blue-500 hover:text-blue-800 hover:bg-blue-50'
                                                }`}
                                            >
                                                {slot.time}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="mt-auto pt-4 border-t border-gray-200 flex justify-end shrink-0">
                                <button
                                    type="button"
                                    onClick={() => { if (tempTime) { setConfirmedTime(tempTime); setActivePanel('NONE'); } }}
                                    disabled={!tempTime}
                                    className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold text-sm disabled:opacity-50 disabled:shadow-none shadow-md hover:bg-blue-700 transition-all"
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