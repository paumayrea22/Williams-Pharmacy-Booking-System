/// <reference types="vite/client" />

// Strict typing for Vite environment variables to ensure compile-time safety
interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }