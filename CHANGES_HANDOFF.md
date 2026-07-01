# Traspaso completo de cambios — William's Pharmacy Booking System

Documento exhaustivo de todo lo realizado en esta sesión: código final de cada archivo tocado/creado/eliminado, el SQL exacto, y los comandos ejecutados. Pensado para que otro asistente de IA pueda retomar el trabajo sin perder contexto.

---

## 0. Comandos de control de versiones ejecutados

```bash
git pull
git add src/AppointmentModal.tsx src/Calendar.tsx src/Layout.tsx
git commit -m "feat: restrict doctor view to own profile and add collapsible sidebar"
git push

git add src/context/AuthContext.tsx
git commit -m "fix: use type-only import for Session/User in AuthContext"
git push

# Tras el merge con los cambios del compañero (Pau):
git rm src/ProtectedRoute.tsx src/supabaseClient.ts

# Verificación usada repetidamente tras cada cambio:
npx tsc -b --noEmit
npx eslint .
```

Historial relevante de commits (más reciente primero):
```
6827716 fix: resolve merge conflicts and enforce 8 characters password limit
b5674bf feat: save user local changes before syncing
f2806d9 feat: save user local changes before syncing
6ad6748 Merge branch 'main' of https://github.com/paumayrea22/William-s-Pharmacy-Booking-System
ae4d0b2 chore: save ivan local changes before syncing
5640123 feat: sync local changes and refresh Vercel public webhook
475b3c7 chore: force Vercel build after changing repo to public
633bcc3 fix: use type-only import for Session/User in AuthContext
58dcf3b Merge branch 'main' of https://github.com/paumayrea22/William-s-Pharmacy-Booking-System
0a848c0 save local UI changes
3ca5c16 Merge branch 'main' of https://github.com/paumayrea22/William-s-Pharmacy-Booking-Systenm
933588c feat: implement Supabase auth client, RBAC logic and secure routing
fd1b44d feat: restrict doctor view to own profile and add collapsible sidebar
```

---

## 1. Base de datos (Supabase / PostgreSQL) — 3 archivos SQL nuevos, 1 corregido

### `supabase/04_holiday_overrides.sql` (nuevo, corregido después)

```sql
-- Layer 4: Malta Public Holiday Overrides
-- Malta's fixed national holidays (and the movable Good Friday) are computed
-- client-side (see src/holidays.ts). This table only stores explicit staff
-- overrides for holidays where the pharmacy decides to open and operate as a
-- normal working day. Presence of a row for a given date means "open as usual".

CREATE TABLE IF NOT EXISTS holiday_overrides (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    created_by_username VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE holiday_overrides ENABLE ROW LEVEL SECURITY;

-- Clean up previous policies to avoid naming collisions on re-run
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON holiday_overrides;
DROP POLICY IF EXISTS "Enable insert for pharmacists only" ON holiday_overrides;
DROP POLICY IF EXISTS "Enable delete for pharmacists only" ON holiday_overrides;

-- READ: All authenticated staff (doctors and pharmacists) need to know whether the pharmacy is open
CREATE POLICY "Enable read access for authenticated users"
ON holiday_overrides FOR SELECT TO authenticated USING (true);

-- WRITE: Only staff sealed with the 'pharmacist' role in app_metadata can create exceptions.
-- app_metadata is only writable server-side (see 05_app_metadata_rbac.sql), unlike user_metadata
-- which the client SDK can freely rewrite, so it is the only trustworthy source for RLS checks.
CREATE POLICY "Enable insert for pharmacists only"
ON holiday_overrides FOR INSERT TO authenticated
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');

-- DELETE: Only staff sealed with the 'pharmacist' role in app_metadata can remove exceptions
CREATE POLICY "Enable delete for pharmacists only"
ON holiday_overrides FOR DELETE TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'pharmacist');
```

> **Nota de historial:** la primera versión de este archivo (creada por mí) usaba políticas simples `authenticated USING (true)`. Un colaborador la reescribió para restringir a farmacéuticos, pero usando `user_metadata` (inseguro, ver sección 2). Yo corregí esa versión para usar `app_metadata`.

### `supabase/05_app_metadata_rbac.sql` (nuevo)

```sql
-- Layer 5: Role-Based Access Control via app_metadata
-- user_metadata is writable by the client SDK (supabase.auth.updateUser), so it must never be
-- trusted for authorization: a pharmacist could self-promote to doctor by rewriting it. This
-- trigger seals the derived role into app_metadata, which is only writable server-side, so RLS
-- policies and the frontend AuthContext can trust it unconditionally.

CREATE OR REPLACE FUNCTION sync_role_to_app_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_username TEXT;
    v_role TEXT;
BEGIN
    v_username := NEW.raw_user_meta_data ->> 'username';

    IF v_username LIKE 'D-%' THEN
        v_role := 'doctor';
    ELSIF v_username LIKE 'P-%' THEN
        v_role := 'pharmacist';
    ELSE
        v_role := NULL;
    END IF;

    NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_role_to_app_metadata ON auth.users;

-- BEFORE trigger so it can mutate NEW directly without a recursive UPDATE statement
CREATE TRIGGER trg_sync_role_to_app_metadata
BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION sync_role_to_app_metadata();

-- Backfill: seal the role for staff accounts registered before this trigger existed.
-- Note: any of these users with an already-issued JWT must sign out and back in for the
-- updated app_metadata claim to appear in a fresh token.
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'role',
    CASE
        WHEN raw_user_meta_data ->> 'username' LIKE 'D-%' THEN 'doctor'
        WHEN raw_user_meta_data ->> 'username' LIKE 'P-%' THEN 'pharmacist'
        ELSE NULL
    END
)
WHERE raw_user_meta_data ->> 'username' IS NOT NULL;
```

### `supabase/06_missing_write_policies.sql` (nuevo)

```sql
-- Layer 6: Missing Write Policies for Staff Management
-- professionals and availabilities have RLS enabled (see 02_security_and_policies.sql) but were
-- only ever given a SELECT policy. With RLS enabled and no matching policy, Postgres denies the
-- command by default, so "Register Specialist", "Add" and "Delete" in Staff Management have been
-- silently rejected by the database. These policies close that gap.

DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON professionals;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON availabilities;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON availabilities;

CREATE POLICY "Enable insert for authenticated users only"
ON professionals FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable insert for authenticated users only"
ON availabilities FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Enable delete for authenticated users only"
ON availabilities FOR DELETE TO authenticated USING (true);
```

**⚠️ Pendiente de ejecutar en el SQL Editor de Supabase, en este orden: `04` → `05` → `06`.** Nadie más que yo ha corrido estos scripts contra la base de datos real.

---

## 2. Autenticación y RBAC — `app_metadata` en vez de `user_metadata`

**Causa raíz:** `user_metadata` es reescribible por el propio usuario desde el cliente (`supabase.auth.updateUser()`), así que basar el rol (doctor/farmacéutico) en él es falsificable. La solución fue el trigger de la sección 1 + este contexto:

### `src/context/AuthContext.tsx` (modificado — archivo completo actual)

```tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Staff role sealed server-side in app_metadata by the sync_role_to_app_metadata trigger,
// never trusted from user_metadata since that field is client-writable
export type StaffRole = 'doctor' | 'pharmacist' | null;

// Define the exact shape of the authentication context
interface AuthState {
  session: Session | null;
  user: User | null;
  role: StaffRole;
  username: string | null;
  isLoading: boolean;
}

// Initialize context without default values to enforce provider usage
const AuthContext = createContext<AuthState | undefined>(undefined);

// Reads the role exclusively from app_metadata, which only the Postgres trigger can write
const deriveRole = (user: User | null): StaffRole => {
  const role = user?.app_metadata?.role;
  return role === 'doctor' || role === 'pharmacist' ? role : null;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Retrieve the active session from local storage on initial mount
    const initializeAuth = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setIsLoading(false);
    };

    initializeAuth();

    // Attach a real-time listener for login, logout, and token refresh events
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setIsLoading(false);
    });

    // Cleanup memory allocation when the component is destroyed
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // Username is display-only metadata (used for profile matching), never for security decisions
  const role = deriveRole(user);
  const username = (user?.user_metadata?.username as string | undefined) ?? null;

  return (
    <AuthContext.Provider value={{ session, user, role, username, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Expose a custom hook for secure and direct access to the authentication state
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('System Error: useAuth hook called outside of AuthProvider perimeter.');
  }
  return context;
};
```

**Fix de build incluido en este archivo:** la versión del compañero importaba `Session, User` como valores normales; con `verbatimModuleSyntax: true` (activado en `tsconfig.app.json`) eso rompe `npm run build`. Se cambió a:
```ts
import type { Session, User } from '@supabase/supabase-js';
```

### `src/lib/supabase.ts` (del compañero, sin cambios — cliente único)

```ts
import { createClient } from '@supabase/supabase-js';

// Extract environment variables securely via Vite's import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Active runtime security check: prevent the application from mounting if keys are missing
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Critical Error: Supabase environment variables are missing. Verify Vercel settings or local .env file.');
}

// Initialize and export the Supabase Singleton client with optimized auth settings
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // Stores the JWT token in local storage for persistent login
    autoRefreshToken: true, // Silently refreshes the token before it expires
    detectSessionInUrl: false // Disabled for standard email/password authentication flow
  }
});
```

### Archivos eliminados (cliente y guard duplicados)

```bash
git rm src/ProtectedRoute.tsx src/supabaseClient.ts
```

- `src/supabaseClient.ts` — cliente Supabase antiguo/duplicado. Causaba el aviso en consola "Multiple GoTrueClient instances detected".
- `src/ProtectedRoute.tsx` — guard de rutas antiguo, reemplazado por `src/components/ProtectedRoute.tsx` (del compañero, que sí usa `useAuth()`).

---

## 3. `src/holidays.ts` (nuevo, completo) — festivos nacionales de Malta

```ts
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
```

---

## 4. `src/lib/errors.ts` (nuevo, completo) — elimina `catch (error: any)`

```ts
// Safely extracts a human-readable message from an unknown thrown value.
// Catch blocks receive `unknown` under strict TypeScript, so this avoids
// scattering `catch (error: any)` casts across the codebase.
export const getErrorMessage = (error: unknown, fallback = 'An unexpected error occurred.'): string => {
    return error instanceof Error ? error.message : fallback;
};
```

Usado en: `StaffManagement.tsx` (4 sitios), `AppointmentModal.tsx` (1 sitio), `StressTest.tsx` (2 sitios). **Pendiente aplicar también en `Login.tsx`** (ver sección 9).

---

## 5. `src/Calendar.tsx` (modificado — archivo completo actual)

Cambios acumulados en este archivo:
- Cliente migrado a `./lib/supabase` + `useAuth()` en vez de `supabase.auth.getUser()` propio.
- Doctor ve su propio nombre bloqueado (no desplegable) en vez del `<select>` de profesionales; farmacéutico sigue viendo el desplegable completo.
- Vista "Grid View": desplegable de un solo día (por defecto el día actual) en vez de las 7 columnas fijas.
- Horas en intervalos de 15 minutos (08:00, 08:15, 08:30...) empezando a las 8:00 en vez de las 7:00; `getCellStatus` compara minutos exactos.
- `webkitAudioContext` tipado correctamente (sin `as any`).
- `catch (error)` sin usar → `catch { ... }`.

```tsx
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import AppointmentModal from './AppointmentModal';
import { useAuth } from './context/AuthContext';

// Safari still requires the vendor-prefixed constructor, which is absent from the DOM lib types
interface WindowWithWebkitAudio extends Window {
    webkitAudioContext?: typeof AudioContext;
}

const getAudioContextConstructor = (): typeof AudioContext => {
    return window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext || AudioContext;
};

// Shared global audio engine instance to bypass strict browser autoplay policies
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

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Quarter-hour slots from 08:00 to 19:45
const TIME_SLOTS: { hour: number; minute: number }[] = [];
for (let hour = 8; hour <= 19; hour++) {
    for (const minute of [0, 15, 30, 45]) {
        TIME_SLOTS.push({ hour, minute });
    }
}

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

    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [gridSelectedDay, setGridSelectedDay] = useState<number>(() => {
        const todayWeekday = DateTime.local({ zone: 'Europe/Malta' }).weekday;
        return todayWeekday === 7 ? 6 : todayWeekday - 1;
    });
    
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
                sharedAudioContext = new (getAudioContextConstructor())();
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

                if (!lockedToOwnProfile) setSelectedProfessional(data[0].id.toString());
            }
            setIsStaffLoading(false);
        };
        fetchProfessionals();
    }, [role, username]);

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
        } catch {
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

    const getCellStatus = (dayIndex: number, hour: number, minute: number) => {
        const sqlDayIndex = dayIndex === 6 ? 0 : dayIndex + 1;
        const slotMinutes = hour * 60 + minute;

        const hasAppointment = appointments.some(appt => {
            const apptTime = DateTime.fromISO(appt.start_time_utc, { zone: 'Europe/Malta' });
            const apptSqlDay = apptTime.weekday === 7 ? 0 : apptTime.weekday;
            return apptSqlDay === sqlDayIndex && apptTime.hour === hour && apptTime.minute === minute && appt.status !== 'cancelled';
        });

        if (hasAppointment) return 'bg-green-200 border-green-300 text-green-800 font-medium';

        const isAvailable = availabilities.some(avail => {
            const [startHour, startMinute] = avail.start_time.split(':').map(Number);
            const [endHour, endMinute] = avail.end_time.split(':').map(Number);
            const startMinutes = startHour * 60 + startMinute;
            const endMinutes = endHour * 60 + endMinute;
            return avail.day_of_week === sqlDayIndex && slotMinutes >= startMinutes && slotMinutes < endMinutes;
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
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-end gap-2">
                                    <label className="text-sm font-medium text-gray-600">Day:</label>
                                    <select
                                        value={gridSelectedDay}
                                        onChange={(e) => setGridSelectedDay(Number(e.target.value))}
                                        className="rounded-md border border-gray-300 bg-gray-50 p-2 text-sm text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        {DAYS_OF_WEEK.map((day, idx) => (
                                            <option key={idx} value={idx}>{day}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                    <table className="w-full text-sm text-left border-collapse">
                                        <thead className="bg-gray-50 text-gray-700">
                                            <tr>
                                                <th className="border border-gray-200 px-4 py-3 font-semibold text-center w-24">Time</th>
                                                <th className="border border-gray-200 px-4 py-3 font-semibold text-center">
                                                    {DAYS_OF_WEEK[gridSelectedDay]}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {TIME_SLOTS.map(({ hour, minute }) => {
                                                const cellClass = getCellStatus(gridSelectedDay, hour, minute);
                                                return (
                                                    <tr key={`${hour}-${minute}`}>
                                                        <td className="border border-gray-200 px-4 py-2 text-center text-gray-600 font-medium bg-gray-50">
                                                            {hour.toString().padStart(2, '0')}:{minute.toString().padStart(2, '0')}
                                                        </td>
                                                        <td className={`border px-2 py-3 text-center transition-colors text-xs ${cellClass}`}>
                                                            {cellClass.includes('green') ? 'Booked' : ''}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
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
            />
        </div>
    );
}
```

---

## 6. `src/Layout.tsx` (modificado — archivo completo actual)

Cambios: sidebar plegable horizontalmente con botón semicircular; rol/username leídos de `useAuth()` en vez de parsear `user_metadata` localmente.

```tsx
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from './lib/supabase';
// Read the global auth state instead of issuing redundant requests to the server
import { useAuth } from './context/AuthContext';

export default function Layout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { username, role } = useAuth(); // Sealed role read from app_metadata, never user_metadata

    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const displayUsername = username ?? 'User';
    const displayRole = role ? role.toUpperCase() : 'STAFF';

    const handleSignOut = async () => {
        // Destroy the JWT token on the server and clear local storage
        await supabase.auth.signOut();
        // ProtectedRoute will detect the dropped session, but we force navigation for UX
        navigate('/login');
    };

    return (
        <div className="relative flex h-screen w-screen bg-gray-50 overflow-hidden font-sans">

            {/* Horizontally collapsible navigation sidebar */}
            <aside
                className={`bg-[#1e293b] text-white flex flex-col justify-between shrink-0 z-20 shadow-xl overflow-hidden transition-all duration-300 ${
                    isSidebarOpen ? 'w-64' : 'w-0'
                }`}
            >
                <div className="w-64 h-full flex flex-col justify-between">
                    <div>
                        <div className="p-6">
                            <h2 className="text-xl font-bold tracking-wide">William's Pharmacy</h2>
                            <div className="flex items-center gap-3 mt-4">
                                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                                    <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"></path>
                                    </svg>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-semibold text-slate-400">{displayRole}</span>
                                    <span className="text-sm font-medium">{displayUsername}</span>
                                </div>
                            </div>
                        </div>

                        <nav className="flex flex-col gap-1 px-4 mt-2">
                            <Link
                                to="/"
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                                    location.pathname === '/' ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                }`}
                            >
                                Calendar
                            </Link>

                            {/* Link to the staff management module */}
                            <Link
                                to="/staff"
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                                    location.pathname === '/staff' ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                }`}
                            >
                                Staff Management
                            </Link>
                        </nav>
                    </div>

                    <div className="p-4">
                        <button
                            onClick={handleSignOut}
                            className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors border border-slate-700"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                            </svg>
                            Sign Out
                        </button>
                    </div>
                </div>
            </aside>

            {/* Semicircular toggle button attached to the panel edge to collapse/expand */}
            <button
                onClick={() => setIsSidebarOpen(prev => !prev)}
                aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                className={`absolute top-1/2 -translate-y-1/2 z-30 h-9 w-4 rounded-r-full bg-[#1e293b] border border-l-0 border-slate-700 flex items-center justify-center text-slate-300 shadow-lg hover:bg-slate-800 hover:text-white transition-all duration-300 ${
                    isSidebarOpen ? 'left-64' : 'left-0'
                }`}
            >
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        d={isSidebarOpen ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
                    ></path>
                </svg>
            </button>

            {/* Dynamic container injected by React Router (Outlet) */}
            <main className="flex-1 overflow-hidden relative">
                <Outlet />
            </main>
        </div>
    );
}
```

---

## 7. `src/AppointmentModal.tsx` (modificado — archivo completo actual)

Cambios: cliente + `useAuth()`; doctor ya no ve ni la flechita del `<select>` de profesional (texto plano en su lugar); bloqueo visual de festivos de Malta (morado/tachado + tooltip) salvo que estén marcados como abiertos; `catch (error: any)` → `getErrorMessage`.

```tsx
import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { getMaltaHolidayName } from './holidays';
import { useAuth } from './context/AuthContext';
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
    appointmentToEdit?: Appointment | null; // Existing appointment to prefill the form for rescheduling
}

export default function AppointmentModal({ isOpen, onClose, onSuccess, selectedProfessionalId, professionals, appointmentToEdit }: AppointmentModalProps) {
    const { role, username } = useAuth(); // Sealed role read from app_metadata, never user_metadata
    const staffUsername = username ?? 'System';

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

    // Initialization effect: prefills the form when editing, resets it for a new booking
    useEffect(() => {
        if (!isOpen) return;

        setActivePanel('NONE');
        setErrorMessage('');
        setCurrentMonth(DateTime.local({ zone: 'Europe/Malta' }));

        if (appointmentToEdit) {
            // Prefill the form with the existing appointment's data
            setModalProfessionalId(appointmentToEdit.professional_id.toString());
            setClientName(appointmentToEdit.client_name);
            setClientPhone(appointmentToEdit.client_phone);
            setRoomNumber(appointmentToEdit.room_number.toString());

            const oldDate = DateTime.fromISO(appointmentToEdit.start_time_utc, { zone: 'Europe/Malta' });
            setConfirmedDate(oldDate);
            setConfirmedTime(oldDate.toFormat('HH:mm'));
            setCurrentMonth(oldDate);
        } else {
            // Empty form by default for new bookings
            setModalProfessionalId(selectedProfessionalId);
            setConfirmedDate(null);
            setConfirmedTime(null);
            setClientName('');
            setClientPhone('');
            setRoomNumber('1');
        }
        setTempDate(null);
        setTempTime(null);

        // Doctors are locked to their own professional record, matched by username suffix
        if (role === 'doctor' && username) {
            const doctorName = username.split('-')[1];
            const matchingProf = professionals.find(p => p.full_name.includes(doctorName));
            if (matchingProf) setModalProfessionalId(matchingProf.id.toString());
        }

        const fetchHolidayOverrides = async () => {
            const { data } = await supabase.from('holiday_overrides').select('holiday_date');
            setOpenHolidayOverrides(new Set((data || []).map(row => row.holiday_date)));
        };
        fetchHolidayOverrides();
    }, [isOpen, selectedProfessionalId, professionals, appointmentToEdit, role, username]);

    // A day is blocked as a Malta holiday unless the staff explicitly marked it as open
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
                    // Ignore the current appointment when in edit mode to avoid self-blocking
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
            // Phase 1: If this is a modification, temporarily cancel the original slot
            if (appointmentToEdit) {
                const { error: cancelError } = await supabase
                    .from('appointments')
                    .update({ status: 'cancelled' })
                    .eq('id', appointmentToEdit.id);

                if (cancelError) throw new Error('System failed to clear original slot.');
                isRollbackNeeded = true;
            }

            // Phase 2: Execute the secure RPC with the new booking data
            const { error: rpcError } = await supabase.rpc('book_appointment_secure', {
                p_professional_id: parseInt(modalProfessionalId),
                p_room_number: parseInt(roomNumber),
                p_client_name: clientName.trim(),
                p_client_phone: clientPhone,
                p_start_time_utc: startDateTime.toUTC().toISO(),
                p_end_time_utc: endDateTime.toUTC().toISO(),
                p_staff_username: staffUsername
            });

            // Phase 3: Rollback evaluation (revert changes if the RPC fails)
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
                            {role === 'doctor' ? (
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
```

---

## 8. `src/StaffManagement.tsx` (modificado — archivo completo actual)

Cambios: cliente + `useAuth()`; nuevo panel "Malta Public Holidays" con toggle visible solo para farmacéuticos; `catch (error: any)` → `getErrorMessage` (4 sitios).

```tsx
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { getMaltaHolidays } from './holidays';
import { useAuth } from './context/AuthContext';
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
    const { role, username } = useAuth(); // Sealed role read from app_metadata, never user_metadata
    const staffUsername = username ?? 'System';

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

    // Retrieves the dates the pharmacy explicitly opted to open despite being a Malta public holiday
    const fetchHolidayOverrides = async () => {
        try {
            const { data, error } = await supabase.from('holiday_overrides').select('holiday_date');
            if (error) throw new Error(error.message);
            setOpenHolidayOverrides(new Set((data || []).map(row => row.holiday_date)));
        } catch (error) {
            setErrorMessage('Infrastructure error loading holiday overrides: ' + getErrorMessage(error));
        }
    };

    useEffect(() => {
        fetchProfessionals();
        fetchHolidayOverrides();
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
        } catch (error) {
            setErrorMessage('Error updating holiday override: ' + getErrorMessage(error));
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
                        {role !== 'pharmacist' && ' Only pharmacists can toggle this setting.'}
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
                                    {role === 'pharmacist' && (
                                        <button
                                            onClick={() => toggleHolidayOverride(holiday.date, isOpen)}
                                            disabled={isActionLoading}
                                            className={`font-bold transition disabled:opacity-50 ${isOpen ? 'text-purple-600 hover:text-purple-800' : 'text-emerald-600 hover:text-emerald-800'}`}
                                        >
                                            {isActionLoading ? '...' : (isOpen ? 'Revert to Holiday' : 'Mark as Open')}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}
```

---

## 9. `src/StressTest.tsx` (modificado — archivo completo actual)

Cambios: cliente migrado a `./lib/supabase`; `catch (error: any)` → `getErrorMessage` (2 sitios + `result.reason.message` tipado).

```tsx
import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { DateTime } from 'luxon';
import { getErrorMessage } from './lib/errors';

interface TestResult {
    threadId: number;
    status: 'pending' | 'success' | 'failed';
    message: string;
}

interface Professional {
    id: number;
    default_duration_minutes: number;
}

export default function StressTest() {
    const [testResults, setTestResults] = useState<TestResult[]>([]);
    const [isTesting, setIsTesting] = useState(false);
    const [targetProfessional, setTargetProfessional] = useState<Professional | null>(null);

    useEffect(() => {
        const fetchTarget = async () => {
            try {
                const { data, error } = await supabase
                    .from('professionals')
                    .select('id, default_duration_minutes')
                    .limit(1)
                    .single();

                if (error) {
                    throw new Error(error.message);
                }
                
                setTargetProfessional(data);
            } catch (error) {
                console.error('Failed to load target professional:', getErrorMessage(error));
            }
        };
        
        fetchTarget();
    }, []);

    const executeConcurrencyAttack = async () => {
        if (!targetProfessional) return;

        setIsTesting(true);
        setTestResults([]);

        // Calculate a strict invariant time: Tomorrow at 09:00 AM Malta Time
        const tomorrow = DateTime.local({ zone: 'Europe/Malta' }).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
        const startUtc = tomorrow.toUTC().toISO();
        const endUtc = tomorrow.plus({ minutes: targetProfessional.default_duration_minutes }).toUTC().toISO();

        if (!startUtc || !endUtc) {
            setIsTesting(false);
            return;
        }

        // Initialize UI states for the 3 parallel threads
        const initialResults: TestResult[] = [
            { threadId: 1, status: 'pending', message: 'Firing RPC...' },
            { threadId: 2, status: 'pending', message: 'Firing RPC...' },
            { threadId: 3, status: 'pending', message: 'Firing RPC...' }
        ];
        setTestResults(initialResults);

        // Build the identical payloads simulating 3 users hitting confirm at the exact same millisecond
        const rpcPayload = {
            p_professional_id: targetProfessional.id,
            p_room_number: 1,
            p_client_name: 'Stress Test Phantom',
            p_client_phone: '00000000',
            p_start_time_utc: startUtc,
            p_end_time_utc: endUtc,
            p_staff_username: 'System_Test'
        };

        const createPromise = async (threadId: number) => {
            const { error } = await supabase.rpc('book_appointment_secure', rpcPayload);
            if (error) {
                throw new Error(`Thread ${threadId} Rejected: ${error.message}`);
            }
            return `Thread ${threadId} Success: Appointment inserted safely.`;
        };

        try {
            // Fire all promises simultaneously. allSettled waits for all to finish regardless of individual rejections
            const results = await Promise.allSettled([
                createPromise(1),
                createPromise(2),
                createPromise(3)
            ]);

            const finalResults: TestResult[] = results.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return { threadId: index + 1, status: 'success', message: result.value };
                } else {
                    return { threadId: index + 1, status: 'failed', message: getErrorMessage(result.reason) };
                }
            });

            setTestResults(finalResults);

        } catch (error) {
            console.error('Catastrophic failure in test harness:', getErrorMessage(error));
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div className="p-8 max-w-3xl mx-auto flex flex-col gap-6">
            <div className="border-b border-gray-200 pb-4">
                <h1 className="text-2xl font-black text-gray-800">Concurrency Stress Test</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Validates the PL/pgSQL pessimistic locking (SELECT FOR UPDATE) preventing double-booking room collisions.
                </p>
            </div>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
                <p className="text-sm text-slate-700 font-medium">
                    This test will attempt to fire 3 identical appointment insertions at the exact same millisecond. 
                    If the database architecture is solid, only 1 thread will succeed, and 2 will be blocked by the RPC exception raiser.
                </p>

                <button
                    onClick={executeConcurrencyAttack}
                    disabled={isTesting || !targetProfessional}
                    className="w-full sm:w-auto self-start bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-all disabled:opacity-50"
                >
                    {isTesting ? 'Attacking Database...' : 'Launch Simultaneous Attack'}
                </button>
            </div>

            {testResults.length > 0 && (
                <div className="flex flex-col gap-3 mt-4">
                    <h3 className="font-bold text-gray-800 text-lg">Transaction Results:</h3>
                    {testResults.map((res) => (
                        <div 
                            key={res.threadId} 
                            className={`p-4 rounded-lg border font-mono text-sm shadow-sm ${
                                res.status === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 
                                res.status === 'failed' ? 'bg-red-50 border-red-200 text-red-800' : 
                                'bg-gray-50 border-gray-200 text-gray-500 animate-pulse'
                            }`}
                        >
                            <span className="font-bold mr-2">[THREAD 0{res.threadId}]</span>
                            {res.message}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
```

---

## 10. `src/Login.tsx` — estado ACTUAL (pendiente de limpieza, ver sección 11)

Este archivo fue limpiado (comentarios en inglés + `getErrorMessage`) en un momento de la sesión, pero un merge posterior lo devolvió a este estado. **Este es el contenido real que hay ahora mismo en el repo:**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './lib/supabase';

export default function Login() {
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    
    const navigate = useNavigate();

    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage('');
        setIsProcessing(true);

        try {
            if (isRegistering) {
                // Validación estricta mediante RegEx para perfiles médicos y farmacéuticos
                const prefixRegex = /^(D-|P-).+$/;
                
                if (!prefixRegex.test(username)) {
                    throw new Error('Error: Username must strictly start with "D-" (Doctor) or "P-" (Pharmacy). Ex: P-Denisse');
                }

                // Registro en Supabase inyectando el nombre de usuario en los metadatos
                const { error: authError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            username: username
                        }
                    }
                });

                if (authError) {
                    throw new Error(authError.message);
                }
                
                navigate('/');
            } else {
                // Flujo estándar de inicio de sesión
                const { error: authError } = await supabase.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (authError) {
                    throw new Error('Invalid credentials. Please verify your email and password.');
                }
                
                navigate('/');
            }
        } catch (error: any) {
            // Captura de excepciones genéricas y errores delegados por Supabase
            setErrorMessage(error.message || 'An unexpected network error occurred.');
        } finally {
            // Liberación del bloqueo de interfaz garantizada independientemente del resultado
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
                <h2 className="mb-6 text-center text-2xl font-bold text-gray-800">
                    {isRegistering ? 'Staff Registration' : 'Internal Access'}
                </h2>

                {errorMessage && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-100 p-3 text-sm text-red-700">
                        {errorMessage}
                    </div>
                )}

                <form onSubmit={handleFormSubmit} className="space-y-4">
                    {isRegistering && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Ex: P-Denisse or D-Fsadni"
                                className="mt-1 w-full rounded-md border border-gray-300 p-3 shadow-sm focus:border-blue-500 focus:outline-none"
                                required={isRegistering}
                                disabled={isProcessing}
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="email@pharmacy.com"
                            className="mt-1 w-full rounded-md border border-gray-300 p-3 shadow-sm focus:border-blue-500 focus:outline-none"
                            required
                            disabled={isProcessing}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Minimum 8 characters"
                            className="mt-1 w-full rounded-md border border-gray-300 p-3 shadow-sm focus:border-blue-500 focus:outline-none"
                            required
                            disabled={isProcessing}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isProcessing}
                        className={`w-full rounded-md p-3 font-semibold text-white transition ${
                            isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {isProcessing ? 'Processing...' : (isRegistering ? 'Create Secure Account' : 'Enter System')}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        onClick={() => {
                            setIsRegistering(!isRegistering);
                            setErrorMessage('');
                        }}
                        disabled={isProcessing}
                        className="text-sm text-blue-600 hover:underline disabled:text-gray-400"
                    >
                        {isRegistering ? 'Already have an account? Sign in' : 'First time? Create your password'}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

**Diff pendiente de aplicar** (mismo patrón que el resto del código):
```diff
 import { useState } from 'react';
 import { useNavigate } from 'react-router-dom';
 import { supabase } from './lib/supabase';
+import { getErrorMessage } from './lib/errors';
 ...
-                // Validación estricta mediante RegEx para perfiles médicos y farmacéuticos
+                // Strict prefix validation using RegEx for Doctors and Pharmacists
                 const prefixRegex = /^(D-|P-).+$/;
 ...
-                // Registro en Supabase inyectando el nombre de usuario en los metadatos
+                // Register in Supabase injecting the username. The SQL Trigger will assign the immutable role.
                 const { error: authError } = await supabase.auth.signUp({
 ...
-                // Flujo estándar de inicio de sesión
+                // Standard login flow
                 const { error: authError } = await supabase.auth.signInWithPassword({
 ...
-        } catch (error: any) {
-            // Captura de excepciones genéricas y errores delegados por Supabase
-            setErrorMessage(error.message || 'An unexpected network error occurred.');
+        } catch (error) {
+            // Catch generic exceptions and errors delegated by Supabase
+            setErrorMessage(getErrorMessage(error, 'An unexpected network error occurred.'));
         } finally {
-            // Liberación del bloqueo de interfaz garantizada independientemente del resultado
+            // Guaranteed UI unlock regardless of the result
             setIsProcessing(false);
         }
```

---

## 11. Archivos NO tocados pero relevantes

- `src/components/ProtectedRoute.tsx` — guard actual del compañero, usa `useAuth()` correctamente. Sin cambios.
- `src/App.tsx`, `src/main.tsx`, `src/vite-env.d.ts` — sin cambios, ya en inglés y correctos.
- `src/UnifiedCalendar.tsx` — código huérfano (no enlazado a ninguna ruta), prototipo de vista móvil. No se tocó.
- `.env.local` — creado al inicio de la sesión con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ya en `.gitignore`, nunca se subió).

---

## 12. Pendientes / próximos pasos

1. Ejecutar en el SQL Editor de Supabase, en orden: `04_holiday_overrides.sql` → `05_app_metadata_rbac.sql` → `06_missing_write_policies.sql`.
2. Cerrar sesión y volver a entrar con cualquier cuenta ya logueada para que el JWT incluya el nuevo claim `app_metadata.role`.
3. Aplicar a `src/Login.tsx` el mismo diff de limpieza que el resto de archivos (sección 10).
4. Decidir si `src/UnifiedCalendar.tsx` se conserva o se elimina.
