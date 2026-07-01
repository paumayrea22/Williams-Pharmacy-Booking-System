import { DateTime } from 'luxon';

export interface MaltaHoliday {
    date: string; // ISO YYYY-MM-DD
    name: string;
}

const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
    { month: 1, day: 1, name: "New Year's Day" },
    { month: 2, day: 10, name: "Feast of St. Paul's Shipwreck" },
    { month: 3, day: 19, name: 'Feast of St. Joseph' },
    { month: 3, day: 31, name: 'Freedom Day' },
    { month: 5, day: 1, name: "Worker's Day" },
    { month: 6, day: 7, name: 'Sette Giugno' },
    { month: 6, day: 29, name: 'Feast of St. Peter and St. Paul (Imnarja)' },
    { month: 8, day: 15, name: 'Feast of the Assumption (Santa Marija)' },
    { month: 9, day: 8, name: 'Feast of Our Lady of Victories' },
    { month: 9, day: 21, name: 'Independence Day' },
    { month: 12, day: 8, name: 'Feast of the Immaculate Conception' },
    { month: 12, day: 13, name: 'Republic Day' },
    { month: 12, day: 25, name: 'Christmas Day' },
];

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) to locate Easter Sunday,
// needed because Good Friday is a movable feast observed as a Malta public holiday.
function getEasterSunday(year: number): DateTime {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return DateTime.fromObject({ year, month, day }, { zone: 'Europe/Malta' });
}

export function getMaltaHolidays(year: number): MaltaHoliday[] {
    const holidays: MaltaHoliday[] = FIXED_HOLIDAYS.map(h => ({
        date: DateTime.fromObject({ year, month: h.month, day: h.day }, { zone: 'Europe/Malta' }).toISODate()!,
        name: h.name,
    }));

    const goodFriday = getEasterSunday(year).minus({ days: 2 });
    holidays.push({ date: goodFriday.toISODate()!, name: 'Good Friday' });

    return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

const holidayMapCache = new Map<number, Map<string, string>>();

function getHolidayMapForYear(year: number): Map<string, string> {
    let map = holidayMapCache.get(year);
    if (!map) {
        map = new Map(getMaltaHolidays(year).map(h => [h.date, h.name]));
        holidayMapCache.set(year, map);
    }
    return map;
}

export function getMaltaHolidayName(dateISO: string): string | null {
    const year = parseInt(dateISO.substring(0, 4), 10);
    if (Number.isNaN(year)) return null;
    return getHolidayMapForYear(year).get(dateISO) ?? null;
}
