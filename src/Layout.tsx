import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from './lib/supabase';
import { useAuth } from './context/AuthContext';

export default function Layout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { username, role } = useAuth(); // Sealed role read from app_metadata, never user_metadata

    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

    const displayUsername = username ?? 'User';
    const displayRole = role ? role.toUpperCase() : 'STAFF';

    const handleSignOut = async () => {
        // Destroy the JWT token on the server and clear local storage
        await supabase.auth.signOut();
        // ProtectedRoute will detect the dropped session, but we force navigation for UX
        navigate('/login');
    };

    const closeMobileDrawer = () => setIsMobileDrawerOpen(false);

    return (
        <div className="relative flex h-screen w-screen bg-pharmacy-cream overflow-hidden font-sans">

            {/* Dimmed backdrop behind the mobile drawer; tapping it closes the menu */}
            {isMobileDrawerOpen && (
                <div
                    onClick={closeMobileDrawer}
                    aria-hidden="true"
                    className="fixed inset-0 z-30 bg-black/40 md:hidden"
                ></div>
            )}

            {/* Navigation sidebar: overlay drawer on mobile, horizontally collapsible in-flow panel on desktop */}
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
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                                    location.pathname === '/' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                }`}
                            >
                                Calendar
                            </Link>

                            {/* Link to the staff management module */}
                            <Link
                                to="/staff"
                                onClick={closeMobileDrawer}
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                                    location.pathname === '/staff' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                }`}
                            >
                                Staff Management
                            </Link>

                            {/* Link to the dynamic doctor vacations management module */}
                            <Link
                                to="/leaves"
                                onClick={closeMobileDrawer}
                                className={`px-4 py-3 rounded-lg text-sm font-semibold transition-colors ${
                                    location.pathname === '/leaves' ? 'bg-pharmacy-green-light text-white shadow-inner' : 'text-pharmacy-cream/70 hover:bg-pharmacy-green-light/60 hover:text-white'
                                }`}
                            >
                                Doctor Leaves
                            </Link>
                        </nav>
                    </div>

                    <div className="p-4">
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

            {/* Semicircular toggle button attached to the panel edge to collapse/expand (desktop only) */}
            <button
                onClick={() => setIsSidebarOpen(prev => !prev)}
                aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                className={`hidden md:flex absolute top-1/2 -translate-y-1/2 z-30 h-9 w-4 rounded-r-full bg-pharmacy-green border border-l-0 border-pharmacy-green-light items-center justify-center text-pharmacy-cream/70 shadow-lg hover:bg-pharmacy-green-light hover:text-white transition-all duration-300 ${
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

            {/* Mobile top bar + dynamic container injected by React Router (Outlet) */}
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