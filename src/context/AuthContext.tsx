import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Define the exact shape of the authentication context
interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
}

// Initialize context without default values to enforce provider usage
const AuthContext = createContext<AuthState | undefined>(undefined);

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

  return (
    <AuthContext.Provider value={{ session, user, isLoading }}>
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