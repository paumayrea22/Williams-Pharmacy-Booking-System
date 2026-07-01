import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Navigation guard to prevent unauthorized access to internal pharmacy routes
export const ProtectedRoute = () => {
  const { session, isLoading } = useAuth();

  // Display a fallback UI while Supabase validates the JWT token in the background
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <p className="text-gray-500 font-medium">Authenticating workspace...</p>
      </div>
    );
  }

  // Intercept unauthenticated users and redirect them to the perimeter login gate
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // If the user has a valid session, render the requested child route components
  return <Outlet />;
};