import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { getMaltaHolidayName } from '../holidays';

const MALTA_ZONE = 'Europe/Malta';
const WEEKDAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface CalendarioBookingProps {
    weekStart: DateTime;
    selectedDayIndex: number;
    allowAllWeek: boolean;
    onSelectDate: (date: DateTime) => void;
    onSelectAllWeek: () => void;
}

// Day picker for the booking calendar: a trigger pill that opens a month grid (Monday-first, like Luxon weeks).
// Picking any date jumps the parent to that date's week and day, so it covers both the day dropdown and week paging.
export default function CalendarioBooking({ weekStart, selectedDayIndex, allowAllWeek, onSelectDate, onSelectAllWeek }: CalendarioBookingProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [visibleMonth, setVisibleMonth] = useState<DateTime>(() => weekStart.startOf('month'));
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const selectedDate = selectedDayIndex === -1 ? null : weekStart.plus({ days: selectedDayIndex });
    const today = DateTime.local({ zone: MALTA_ZONE }).startOf('day');

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    // The trigger sits near the right edge inside an overflow-auto panel, so an absolutely positioned popover
    // got clipped on the right. Fixed positioning escapes that panel; clamping keeps it fully inside the viewport.
    // Styles are written straight to the node (before paint) to avoid an extra render on every scroll/resize.
    useLayoutEffect(() => {
        if (!isOpen) return;
        const place = () => {
            const trigger = triggerRef.current;
            const popover = popoverRef.current;
            if (!trigger || !popover) return;

            const gap = 8;
            const edge = 8;
            const t = trigger.getBoundingClientRect();
            const p = popover.getBoundingClientRect();

            const left = Math.max(edge, Math.min(t.left, window.innerWidth - p.width - edge));
            const fitsBelow = t.bottom + gap + p.height <= window.innerHeight - edge;
            const top = fitsBelow ? t.bottom + gap : Math.max(edge, t.top - gap - p.height);

            popover.style.left = `${left}px`;
            popover.style.top = `${top}px`;
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [isOpen]);

    const toggleOpen = () => {
        if (!isOpen) setVisibleMonth((selectedDate ?? weekStart).startOf('month'));
        setIsOpen(!isOpen);
    };

    const pickDate = (date: DateTime) => {
        onSelectDate(date);
        setIsOpen(false);
    };

    // Always render 6 full weeks so the popover keeps a stable height between months
    const gridStart = visibleMonth.startOf('week');
    const gridDays = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));

    const triggerLabel = selectedDate
        ? `${DAYS_OF_WEEK[selectedDayIndex]} (${selectedDate.toFormat('dd/MM')})`
        : 'All Week';

    return (
        <div ref={containerRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={toggleOpen}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                className="flex items-center gap-2 rounded-full border border-pharmacy-ink/20 bg-white px-3 py-1.5 text-sm font-medium text-pharmacy-ink shadow-sm hover:border-pharmacy-gold focus:border-pharmacy-gold focus:outline-none"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4 text-pharmacy-gold-dark">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                {triggerLabel}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 text-pharmacy-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
            </button>

            {isOpen && (
                <div ref={popoverRef} role="dialog" aria-label="Pick a date" className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-pharmacy-ink/10 bg-white p-4 shadow-xl">
                    <p className="border-b border-pharmacy-cream-dark pb-3 text-sm font-semibold text-pharmacy-ink">
                        {(selectedDate ?? today).toFormat('cccc, MMMM d')}
                    </p>

                    <div className="mt-3 flex items-center justify-between">
                        <span className="font-display text-base text-pharmacy-ink">{visibleMonth.toFormat('MMMM yyyy')}</span>
                        <div className="flex gap-1">
                            <button
                                type="button"
                                onClick={() => setVisibleMonth(prev => prev.minus({ months: 1 }))}
                                aria-label="Previous month"
                                className="rounded-md px-2 py-1 text-xs text-pharmacy-muted hover:bg-pharmacy-cream hover:text-pharmacy-ink"
                            >
                                ▲
                            </button>
                            <button
                                type="button"
                                onClick={() => setVisibleMonth(prev => prev.plus({ months: 1 }))}
                                aria-label="Next month"
                                className="rounded-md px-2 py-1 text-xs text-pharmacy-muted hover:bg-pharmacy-cream hover:text-pharmacy-ink"
                            >
                                ▼
                            </button>
                        </div>
                    </div>

                    <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-pharmacy-muted">
                        {WEEKDAY_HEADERS.map(d => <span key={d} className="py-1">{d}</span>)}
                    </div>

                    <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
                        {gridDays.map(day => {
                            const isOtherMonth = !day.hasSame(visibleMonth, 'month');
                            const isSelected = selectedDate !== null && day.hasSame(selectedDate, 'day');
                            const isToday = day.hasSame(today, 'day');
                            const isSunday = day.weekday === 7;
                            const holidayName = getMaltaHolidayName(day.toISODate()!);

                            let tone = 'text-pharmacy-ink hover:bg-pharmacy-cream';
                            if (isSelected) tone = 'bg-pharmacy-gold text-pharmacy-green font-bold';
                            else if (isToday) tone = 'ring-2 ring-pharmacy-gold text-pharmacy-ink font-semibold hover:bg-pharmacy-cream';
                            else if (isOtherMonth) tone = 'text-pharmacy-ink/30 hover:bg-pharmacy-cream';
                            else if (isSunday || holidayName) tone = 'text-red-400 hover:bg-pharmacy-cream';

                            return (
                                <button
                                    key={day.toISODate()}
                                    type="button"
                                    onClick={() => pickDate(day)}
                                    title={holidayName ?? (isSunday ? 'Sunday (Closed)' : undefined)}
                                    className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full transition-colors ${tone}`}
                                >
                                    {day.day}
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-pharmacy-cream-dark pt-3">
                        <button
                            type="button"
                            onClick={() => pickDate(today)}
                            className="text-xs font-bold uppercase tracking-wider text-pharmacy-gold-dark hover:underline"
                        >
                            Today
                        </button>
                        {allowAllWeek && (
                            <button
                                type="button"
                                onClick={() => {
                                    onSelectAllWeek();
                                    setIsOpen(false);
                                }}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${selectedDate === null ? 'bg-pharmacy-gold text-pharmacy-green' : 'border border-pharmacy-ink/20 text-pharmacy-ink hover:bg-pharmacy-cream'}`}
                            >
                                All Week
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
