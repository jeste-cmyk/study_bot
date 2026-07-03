/**
 * Authentication service (PRD §7.2 — email/Google from day one).
 *
 * Two interchangeable implementations behind one interface:
 *  - SupabaseAuth: real email/password + Google OAuth, when Supabase is configured.
 *  - LocalAuth:    a no-backend account stored in AsyncStorage, so the app is
 *                  fully usable for design review without provisioning anything.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { isSupabaseConfigured } from '@/config/env';
import { supabase } from './supabaseClient';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface AuthService {
  getUser(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<AuthUser>;
  signInWithGoogle(): Promise<AuthUser>;
  signOut(): Promise<void>;
}

const nameFromEmail = (email: string): string => {
  const local = email.split('@')[0] ?? 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
};

// ---------------------------------------------------------------------------
// Local (no backend)
// ---------------------------------------------------------------------------

const LOCAL_USER_KEY = 'recall:auth:user';

class LocalAuth implements AuthService {
  async getUser(): Promise<AuthUser | null> {
    const raw = await AsyncStorage.getItem(LOCAL_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  }

  private async persist(user: AuthUser): Promise<AuthUser> {
    await AsyncStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
    return user;
  }

  async signIn(email: string, _password: string): Promise<AuthUser> {
    // No real auth offline — derive a stable id from the email so the same
    // address always maps to the same local bank.
    const id = `local-${hash(email.toLowerCase())}`;
    return this.persist({ id, email, name: nameFromEmail(email) });
  }

  async signUp(email: string, password: string): Promise<AuthUser> {
    return this.signIn(email, password);
  }

  async signInWithGoogle(): Promise<AuthUser> {
    return this.persist({
      id: 'local-google-demo',
      email: 'jesus@gmail.com',
      name: 'Jesús',
    });
  }

  async signOut(): Promise<void> {
    await AsyncStorage.removeItem(LOCAL_USER_KEY);
  }
}

// Tiny stable string hash for deriving local ids.
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

class SupabaseAuth implements AuthService {
  private toUser(u: { id: string; email?: string | null; user_metadata?: any } | null): AuthUser | null {
    if (!u) return null;
    return {
      id: u.id,
      email: u.email ?? null,
      name: u.user_metadata?.full_name ?? (u.email ? nameFromEmail(u.email) : null),
    };
  }

  async getUser(): Promise<AuthUser | null> {
    const { data } = await supabase!.auth.getUser();
    return this.toUser(data.user ?? null);
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const user = this.toUser(data.user);
    if (!user) throw new Error('Sign-in returned no user');
    return user;
  }

  async signUp(email: string, password: string): Promise<AuthUser> {
    const { data, error } = await supabase!.auth.signUp({ email, password });
    if (error) throw error;
    const user = this.toUser(data.user);
    if (!user) throw new Error('Check your email to confirm your account.');
    return user;
  }

  async signInWithGoogle(): Promise<AuthUser> {
    const redirectTo = Linking.createURL('/auth-callback');
    const { data, error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error('Could not start Google sign-in');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      throw new Error('Google sign-in was cancelled');
    }
    // Exchange the returned tokens for a session.
    const params = new URL(result.url).hash.replace(/^#/, '');
    const sp = new URLSearchParams(params);
    const access_token = sp.get('access_token');
    const refresh_token = sp.get('refresh_token');
    if (!access_token || !refresh_token) throw new Error('Missing tokens from Google');
    const { data: sess, error: sErr } = await supabase!.auth.setSession({
      access_token,
      refresh_token,
    });
    if (sErr) throw sErr;
    const user = this.toUser(sess.user);
    if (!user) throw new Error('Google sign-in failed');
    return user;
  }

  async signOut(): Promise<void> {
    await supabase!.auth.signOut();
  }
}

export const auth: AuthService = isSupabaseConfigured ? new SupabaseAuth() : new LocalAuth();
export const authMode: 'supabase' | 'local' = isSupabaseConfigured ? 'supabase' : 'local';

// Silence "no listener" warnings on web for the auth-session redirect.
WebBrowser.maybeCompleteAuthSession();
