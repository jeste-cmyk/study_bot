import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env, isSupabaseConfigured } from '@/config/env';

/**
 * Storage adapter that defers to AsyncStorage on a real client (native, or the
 * browser) but no-ops during Expo Router's web server-render pass, where there
 * is no `window` and the web build of AsyncStorage throws on access. The guard
 * is per-call so persistence still works everywhere it actually runs.
 */
const sessionStorage = {
  getItem: (key: string) =>
    typeof window === 'undefined' ? Promise.resolve(null) : AsyncStorage.getItem(key),
  setItem: (key: string, value: string) =>
    typeof window === 'undefined' ? Promise.resolve() : AsyncStorage.setItem(key, value),
  removeItem: (key: string) =>
    typeof window === 'undefined' ? Promise.resolve() : AsyncStorage.removeItem(key),
};

/**
 * A single shared Supabase client, or `null` when the app is running
 * local-first (no Supabase env configured). Session is persisted in
 * AsyncStorage so the user stays signed in across launches.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(env.supabase.url, env.supabase.anonKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
