import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Calendar from './Calendar';
import StaffManagement from './StaffManagement';
import DoctorLeaveManagement from './DoctorLeaveManagement';
import StressTest from './StressTest';
import Login from './Login';
import { ProtectedRoute } from './components/ProtectedRoute';

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
                        <Route path="/staff" element={<StaffManagement />} />
                        <Route path="/leaves" element={<DoctorLeaveManagement />} />
                        <Route path="/stress-test" element={<StressTest />} />
                    </Route>
                </Route>

                {/* Traffic control: Catch all invalid URLs and redirect to the secure root */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Router>
    );
}