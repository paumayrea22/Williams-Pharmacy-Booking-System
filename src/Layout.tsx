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
