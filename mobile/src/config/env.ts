/**
 * Centralised, typed access to runtime configuration.
 *
 * Everything comes from `EXPO_PUBLIC_*` env vars (see `.env.example`). We read
 * them once here so the rest of the app never touches `process.env` directly and
 * so we can expose simple `isConfigured` flags that the service layer uses to
 * decide between a real provider and the local fallback.
 */

const str = (v: string | undefined): string => (v ?? '').trim();

export const env = {
  supabase: {
    url: str(process.env.EXPO_PUBLIC_SUPABASE_URL),
    anonKey: str(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  },
  openai: {
    apiKey: str(process.env.EXPO_PUBLIC_OPENAI_API_KEY),
    evalModel: str(process.env.EXPO_PUBLIC_OPENAI_EVAL_MODEL) || 'gpt-4o-mini',
    transcribeModel:
      str(process.env.EXPO_PUBLIC_OPENAI_TRANSCRIBE_MODEL) || 'whisper-1',
  },
  aiProxyUrl: str(process.env.EXPO_PUBLIC_AI_PROXY_URL),
} as const;

/** Supabase auth + sync are available. Otherwise we run local-first. */
export const isSupabaseConfigured = Boolean(env.supabase.url && env.supabase.anonKey);

/** A real AI backend is reachable (either OpenAI directly or via a proxy). */
export const isAiConfigured = Boolean(env.openai.apiKey || env.aiProxyUrl);
