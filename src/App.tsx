import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Calendar from './Calendar';
import Login from './Login';
import { ProtectedRoute } from './components/ProtectedRoute';
import { PharmacistOnlyRoute } from './components/PharmacistOnlyRoute';

// Secondary modules are code-split so a fresh login only downloads the Calendar bundle up front
const StaffManagement = lazy(() => import('./StaffManagement'));
const DoctorLeaveManagement = lazy(() => import('./DoctorLeaveManagement'));
const StressTest = lazy(() => import('./StressTest'));

const ModuleLoadingFallback = () => (
    <div className="flex h-full w-full items-center justify-center bg-pharmacy-cream">
        <p className="text-pharmacy-muted font-medium">Loading module...</p>
    </div>
);

export default function App() {
    return (
        <Router>
            <Routes>
                {/* Public perimeter: Accessible without authentication */}
                <Route path="/login" element={<Login />} />

                {/* Secure perimeter: Encapsulated by the authentication navigation guard */}
                <Route element={<ProtectedRoute />}>
                    {/* UI Layout wrapper for all authenticated internal views */}
                    <Route element={<Layout />}>
                        <Route path="/" element={<Calendar />} />
                        <Route element={<PharmacistOnlyRoute />}>
                            <Route path="/staff" element={<Suspense fallback={<ModuleLoadingFallback />}><StaffManagement /></Suspense>} />
                        </Route>
                        <Route path="/leaves" element={<Suspense fallback={<ModuleLoadingFallback />}><DoctorLeaveManagement /></Suspense>} />
                        <Route path="/stress-test" element={<Suspense fallback={<ModuleLoadingFallback />}><StressTest /></Suspense>} />
                    </Route>
                </Route>

                {/* Traffic control: Catch all invalid URLs and redirect to the secure root */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Router>
    );
}
