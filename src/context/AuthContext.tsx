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