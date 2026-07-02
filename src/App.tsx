import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Calendar from './Calendar';
import StaffManagement from './StaffManagement';
import StressTest from './StressTest';
import Login from './Login';
// Import the navigation guard we just created (using named export)
import { ProtectedRoute } from './components/ProtectedRoute';
import AppointmentModal from './AppointmentModal';

function TempModalPreview() {
    return (
        <div className="fixed inset-0 bg-pharmacy-cream">
            <AppointmentModal
                isOpen={true}
                onClose={() => {}}
                onSuccess={() => {}}
                selectedProfessionalId="1"
                professionals={[
                    { id: 1, full_name: 'Dr. Christopher Sciberras', specialty: 'Pediatrics', default_duration_minutes: 30 },
                ]}
            />
        </div>
    );
}

export default function App() {
    return (
        <Router>
            <Routes>
                {/* Public perimeter: Accessible without authentication */}
                <Route path="/login" element={<Login />} />
                <Route path="/__preview-modal" element={<TempModalPreview />} />
                
                {/* Secure perimeter: Encapsulated by the authentication navigation guard */}
                <Route element={<ProtectedRoute />}>
                    {/* UI Layout wrapper for all authenticated internal views */}
                    <Route element={<Layout />}>
                        <Route path="/" element={<Calendar />} />
                        <Route path="/staff" element={<StaffManagement />} />
                        <Route path="/stress-test" element={<StressTest />} />
                    </Route>
                </Route>

                {/* Traffic control: Catch all invalid URLs and redirect to the secure root */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Router>
    );
}