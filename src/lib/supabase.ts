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