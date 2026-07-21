import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { useAuth } from './context/AuthContext';

// Extend the global Window interface to support the experimental PWA API
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt(): Promise<void>;
}

export default function Layout() {
    const location = useLocation();
    const navigate = useNavigate();

    // Sealed role read from app_metadata, never user_metadata for security
    const { username, role } = useAuth();

    // UI Layout States
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

    // PWA Installation States
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isInstallable, setIsInstallable] = useState(false);

    // Calendar Sync Modal States
    const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
    const [isSyncLoading, setIsSyncLoading] = useState(false);
    const [syncErrorMsg, setSyncErrorMsg] = useState('');
    const [professionalId, setProfessionalId] = useState<number | null>(null);

    // Sync Preferences States
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [syncEmail, setSyncEmail] = useState('');
    const [syncGoogle, setSyncGoogle] = useState(false);
    const [syncApple, setSyncApple] = useState(false);
    const [syncToken, setSyncToken] = useState<string | null>(null);

    const displayUsername = username ?? 'User';
    const displayRole = role ? role.toUpperCase() : 'STAFF';

    // Intercept the browser's native PWA installation prompt
    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setIsInstallable(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // Hide the button permanently once the app is successfully installed
        const handleAppInstalled = () => {
            setIsInstallable(false);
            setDeferredPrompt(null);
        };

        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    // Fetch professional ID and existing sync settings when the modal is opened
    useEffect(() => {
        if (isSyncModalOpen && role === 'doctor' && username) {
            const fetchSyncData = async () => {
                setIsSyncLoading(true);
                setSyncErrorMsg('');

                try {
                    // 1. Extract the unique name identifier and resolve the numeric Professional ID
                    const doctorNameSuffix = username.split('-')[1];
                    const { data: profData, error: profError } = await supabase
                        .from('professionals')
                        .select('id')
                        .ilike('full_name', `%${doctorNameSuffix}%`)
                        .maybeSingle();

                    if (profError) throw profError;

                    // Data Integrity Check: If the Pharmacist hasn't registered this doctor's profile yet
                    if (!profData) {
                        setSyncErrorMsg(`Data Linkage Failed: No medical profile found matching "${doctorNameSuffix}". Please ask the Administrator to register your full name in Staff Management before configuring synchronization.`);
                        return;
                    }

                    setProfessionalId(profData.id);

                    // 2. Fetch existing synchronization preferences from the persistence table
                    const { data: syncData, error: syncError } = await supabase
                        .from('calendar_sync_settings')
                        .select('*')
                        .eq('professional_id', profData.id)
                        .maybeSingle();

                    if (syncError) throw syncError;

                    if (syncData) {
                        setSyncEnabled(syncData.sync_enabled);
                        setSyncEmail(syncData.target_email || '');
                        setSyncGoogle(syncData.sync_google);
                        setSyncApple(syncData.sync_apple);
                        setSyncToken(syncData.secure_token);
                    } else {
                        // If no record exists, try to prefill the email from the auth context as a UX courtesy
                        const { data: authData } = await supabase.auth.getUser();
                        if (authData.user?.email) {
                            setSyncEmail(authData.user.email);
                        }
                    }

                } catch (error) {
                    console.error('Infrastructure error loading synchronization settings:', error);
                    setSyncErrorMsg('An unexpected infrastructure error occurred while loading your preferences.');
                } finally {
                    setIsSyncLoading(false);
                }
            };
            fetchSyncData();
        }
    }, [isSyncModalOpen, role, username]);

    // Upsert the synchronization preferences securely into the database
    const handleSaveSyncSettings = async () => {
        if (!professionalId) return;
        setIsSyncLoading(true);
        setSyncErrorMsg('');

        try {
            const payload = {
                professional_id: professionalId,
                sync_enabled: syncEnabled,
                target_email: syncEmail,
                sync_google: syncGoogle,
                sync_apple: syncApple,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('calendar_sync_settings')
                .upsert(payload)
                .select('secure_token')
                .single();

            if (error) throw error;

            if (data) {
                setSyncToken(data.secure_token);
            }
        } catch (error) {
            console.error('Error saving sync settings:', error);
            setSyncErrorMsg('An infrastructure error occurred while saving your preferences. Please try again.');
        } finally {
            setIsSyncLoading(false);
        }
    };

    const handleInstallClick = async () => {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setIsInstallable(false);
            setDeferredPrompt(null);
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    const closeMobileDrawer = () => setIsMobileDrawerOpen(false);

    // Dynamically generate the WebCal subscription URL stripping any residual protocols or extra slashes
    const hostname = window.location.host.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '');
    const generatedWebcalUrl = syncToken ? `webcal://${hostname}/api/calendar?token=${syncToken}` : '';

    return (
        <div className="relative flex h-screen w-screen bg-pharmacy-cream overflow-hidden font-sans">

            {/* Sync Configuration Modal Overlay */}
            {isSyncModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-pharmacy-ink/40 backdrop-blur-sm p-4">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                        <div className="p-6 border-b border-pharmacy-cream-dark">
                            <div className="flex justify-between items-center">
                                <h2 className="font-display text-2xl text-pharmacy-ink">Calendar Synchronization</h2>
                                <button
                                    onClick={() => setIsSyncModalOpen(false)}
                                    aria-label="Close modal"
                                    className="text-pharmacy-muted hover:text-pharmacy-ink text-xl font-bold transition-colors"
                                >
                                    &times;
                                </button>
                            </div>
                            <p className="text-sm text-pharmacy-muted mt-2">
                                Connect your clinic appointments securely with your personal device. Data flows automatically and avoids duplicates.
                            </p>
                        </div>

                        <div className="p-6 flex flex-col gap-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
                            {isSyncLoading ? (
                                <div className="text-center text-pharmacy-muted py-8 font-bold animate-pulse">Loading secure preferences...</div>
                            ) : syncErrorMsg ? (
                                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm font-medium shadow-sm">
                                    <span className="font-bold block mb-1">Authorization Blocked</span>
                                    {syncErrorMsg}
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between bg-pharmacy-cream p-4 rounded-xl border border-pharmacy-ink/10">
                                        <div>
                                            <span className="font-bold text-pharmacy-ink block">Enable Synchronization</span>
                                            <span className="text-xs text-pharmacy-muted">Turn off to instantly halt event pushing without deleting past history.</span>
                                        </div>
                                        <button
                                            onClick={() => setSyncEnabled(!syncEnabled)}
                                            aria-pressed={syncEnabled}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${syncEnabled ? 'bg-pharmacy-green' : 'bg-gray-300'}`}
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${syncEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    </div>

                                    <div className={`flex flex-col gap-4 transition-opacity ${syncEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                                        <div>
                                            <label className="block text-sm font-semibold text-pharmacy-ink mb-1">Target Account Email</label>
                                            <input
                                                type="email"
                                                value={syncEmail}
                                                onChange={(e) => setSyncEmail(e.target.value)}
                                                placeholder="e.g. doctor@gmail.com"
                                                className="w-full border border-pharmacy-ink/20 rounded-lg p-2.5 text-sm shadow-sm focus:border-pharmacy-gold focus:outline-none focus:ring-1 focus:ring-pharmacy-gold"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-semibold text-pharmacy-ink mb-2">Select Target Platforms</label>
                                            <div className="flex gap-4">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={syncGoogle}
                                                        onChange={(e) => setSyncGoogle(e.target.checked)}
                                                        className="w-4 h-4 text-pharmacy-green rounded focus:ring-pharmacy-green"
                                                    />
                                                    <span className="text-sm font-medium text-pharmacy-ink">Google Calendar</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={syncApple}
                                                        onChange={(e) => setSyncApple(e.target.checked)}
                                                        className="w-4 h-4 text-pharmacy-green rounded focus:ring-pharmacy-green"
                                                    />
                                                    <span className="text-sm font-medium text-pharmacy-ink">Apple Calendar</span>
                                                </label>
                                            </div>
                                        </div>

                                        {syncToken && syncEnabled && (syncGoogle || syncApple) && (
                                            <div className="mt-2 bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex flex-col gap-3">
                                                <h3 className="font-bold text-emerald-800 text-sm">Action Required</h3>
                                                <p className="text-xs text-emerald-700">Due to external security policies, you must add the following secure feed URL to your calendar app manually:</p>
                                                <div className="bg-white border border-emerald-200 rounded p-2 text-[10px] font-mono break-all text-gray-600 select-all cursor-text">
                                                    {generatedWebcalUrl}
                                                </div>

                                                {syncApple && (
                                                    <div className="text-xs text-emerald-800 bg-emerald-100/50 p-2 rounded">
                                                        <span className="font-bold">Apple:</span> On an iPhone/Mac, simply click or copy the link above and open it in Safari. The system will prompt you to subscribe automatically.
                                                    </div>
                                                )}

                                                {syncGoogle && (
                                                    <div className="text-xs text-emerald-800 bg-emerald-100/50 p-3 rounded flex flex-col gap-2">
                                                        <p>
                                                            <span className="font-bold">Google:</span> Open Google Calendar on a PC &gt; Settings &gt; Add Calendar &gt; "From URL" &gt; Paste the link above.
                                                        </p>
                                                        <div className="bg-amber-100 text-amber-900 p-2 rounded border border-amber-200">
                                                            <span className="font-bold flex items-center gap-1">
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                                                                Google Calendar Latency Warning
                                                            </span>
                                                            <p className="mt-1">Initial setup is instant, but Google servers only refresh external calendars every 12-24 hours. For real-time updates, always rely on this portal.</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="p-4 border-t border-pharmacy-cream-dark bg-gray-50 flex justify-end gap-3 shrink-0 rounded-b-2xl">
                            <button
                                onClick={() => setIsSyncModalOpen(false)}
                                className="px-5 py-2.5 rounded-lg text-sm font-bold text-pharmacy-muted hover:bg-gray-200 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveSyncSettings}
                                disabled={isSyncLoading || !!syncErrorMsg || (syncEnabled && !syncEmail.trim())}
                                className="bg-pharmacy-green text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-pharmacy-green-light transition shadow-md disabled:opacity-50"
                            >
                                {isSyncLoading ? 'Saving...' : 'Save Preferences'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isMobileDrawerOpen && (
                <div
                    onClick={closeMobileDrawer}
                    aria-hidden="true"
                    className="fixed inset-0 z-30 bg-black/40 md:hidden"
                ></div>
            )}

            <aside
                className={`bg-pharmacy-green text-pharmacy-cream flex flex-col justify-between shrink-0 shadow-xl overflow-hidden transition-all duration-300
                    fixed inset-y-0 left-0 z-40 w-64 ${isMobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:static md:z-20 md:translate-x-0 ${isSidebarOpen ? 'md:w-64' : 'md:w-0'}`}
            >
                <div className="w-64 h-full flex flex-col justify-between">
                    <div>
                        <div className="p-6">
                            <div className="bg-pharmacy-cream rounded-xl p-3 shadow-md">
                                <img src="/logo-wordmark.png" alt="William's Pharmacy" className="w-full h-auto" />
                            </div>
                            <div className="flex items-center gap-3 mt-4">
                                <div className="w-8 h-8 rounded-full bg-pharmacy-green-light flex items-center justify-center">
                                    <svg className="w-4 h-4 text-pharmacy-cream/80" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"></path>
                                    </svg>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-semibold text-pharmacy-gold">{displayRole}</span>
                                    <span className="text-sm font-medium text-white">{displayUsername}</span>
                                </div>
                            </div>
                        </div>

                        <nav className="flex flex-col gap-1 px-4 mt-2">
                            <Link
                                to="/"
                                onClick={closeMobileDrawer}
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${location.pathname === '/' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                    }`}
                            >
                                Calendar
                            </Link>

                            {role !== 'doctor' && (
                                <Link
                                    to="/staff"
                                    onClick={closeMobileDrawer}
                                    className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${location.pathname === '/staff' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                        }`}
                                >
                                    Staff Management
                                </Link>
                            )}

                            <Link
                                to="/leaves"
                                onClick={closeMobileDrawer}
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${location.pathname === '/leaves' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                    }`}
                            >
                                Doctor Leaves
                            </Link>

                            {/* Appointment history is available to both roles; doctors are scoped server-side to their own patients */}
                            <Link
                                to="/history"
                                onClick={closeMobileDrawer}
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                                    location.pathname === '/history' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                }`}
                            >
                                Appointment History
                            </Link>
                        </nav>
                    </div>

                    <div className="p-4 flex flex-col gap-2">
                        {role === 'doctor' && (
                            <button
                                onClick={() => setIsSyncModalOpen(true)}
                                className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-pharmacy-cream/90 hover:bg-pharmacy-green-light hover:text-white transition-colors border border-pharmacy-green-light/50 bg-pharmacy-green-light/20"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                </svg>
                                Sync with Calendar
                            </button>
                        )}

                        {isInstallable && (
                            <button
                                onClick={handleInstallClick}
                                className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold bg-pharmacy-gold text-pharmacy-green hover:bg-pharmacy-gold-dark hover:text-white transition-colors shadow-md"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                                </svg>
                                Install App
                            </button>
                        )}

                        <button
                            onClick={handleSignOut}
                            className="w-full flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-pharmacy-cream/70 hover:bg-pharmacy-green-light hover:text-white transition-colors border border-pharmacy-green-light"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                            </svg>
                            Sign Out
                        </button>
                    </div>
                </div>
            </aside>

            <button
                onClick={() => setIsSidebarOpen(prev => !prev)}
                aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                className={`hidden md:flex absolute top-1/2 -translate-y-1/2 z-30 h-9 w-4 rounded-r-full bg-pharmacy-green border border-l-0 border-pharmacy-green-light items-center justify-center text-pharmacy-cream/70 shadow-lg hover:bg-pharmacy-green-light hover:text-white transition-all duration-300 ${isSidebarOpen ? 'left-64' : 'left-0'
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

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="md:hidden flex items-center gap-3 bg-pharmacy-green text-white px-4 py-3 shrink-0 shadow-md">
                    <button
                        onClick={() => setIsMobileDrawerOpen(true)}
                        aria-label="Open menu"
                        className="p-1 rounded hover:bg-pharmacy-green-light transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
                        </svg>
                    </button>
                    <h2 className="text-base font-bold tracking-wide">William's Pharmacy</h2>
                </div>

                <main className="flex-1 overflow-hidden relative">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}