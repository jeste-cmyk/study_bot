# Recall — mobile app

Native iOS/Android app (Expo + React Native + TypeScript) for the **Interview
Question Bank & Practice** product described in the PRD at the repo root. It's
the "app móvil nativa" half of the product: a personal question bank with
on-demand practice (text or voice), AI feedback, and self-rated spaced
repetition, synced across devices via a user account.

The UI is built faithfully to the design exploration in `../design/`.

## Quick start

```bash
cd mobile
npm install
cp .env.example .env     # optional — the app runs without it (local mode)
npm start                # then press i / a, or scan the QR with Expo Go
```

- `npm run ios` / `npm run android` — open directly in a simulator/emulator.
- `npm run web` — run in the browser (react-native-web) for a quick look.

**Out of the box it runs in local mode**: a seeded question bank stored on the
device with a deterministic local AI fallback, so you can explore the whole flow
without provisioning anything. Sign in with any email/password.

## What's implemented (PRD MVP — RF-01…15, RF-19)

| Area | Screens / logic |
| --- | --- |
| Auth (RF-15) | `login` — email/password + Google, real Supabase or local |
| Capture (RF-01–03) | `capture` modal — question + optional reference + metadata |
| Bank (RF-19) | `(tabs)/bank` — list, search, multi-select category filter |
| Detail/edit (RF-19) | `question/[id]` — view + edit text/reference/metadata, SR state, history |
| Practice loop (RF-04, 07, 08, 14) | `practice` — on-demand queue, voice/text answer |
| Transcription (RF-09) | `services/ai.transcribeAudio` — Whisper |
| AI evaluation (RF-10, 11) | `services/ai.evaluateAnswer` — Mode A grade vs reference, Mode B drafts a model answer |
| Self-rating → SR (RF-05, 12, 13) | `domain/spacedRepetition` (SM-2) driven by the user's Again/Hard/Good/Easy |
| Home | `(tabs)/index` — what's due, streak, up-next |

Fase 2 items (attempt-history view RF-16, dashboards RF-17, sharing RF-18) are
intentionally out of scope, but the data model already records full attempt
history so they can be built without migration.

## Architecture

```
src/
  config/env.ts          typed env + isSupabaseConfigured / isAiConfigured flags
  theme/                 design tokens (colour, type, radius, category/status styles)
  domain/                pure logic — types, SM-2 engine, question selection
  services/              decoupled providers (swappable per PRD §6.2)
    auth.ts              AuthService: SupabaseAuth | LocalAuth
    repository.ts        Repository: SupabaseRepository | LocalRepository
    ai.ts                transcribeAudio + evaluateAnswer (OpenAI | proxy | local stub)
    supabaseClient.ts    shared client (null in local mode)
    seed.ts              local seed bank (mirrors the design)
  store/useStore.ts      Zustand — owns session + question bank, persists mutations
  ui/                    Logo, icons, TabBar, primitives (Txt/Card/Button/Pill)
  app/                   expo-router routes
supabase/schema.sql      Postgres tables + row-level security
```

The provider boundary is the key design point: `domain/` and the screens never
know whether they're talking to Supabase/OpenAI or the local fallback. Each
service picks its implementation from env at startup.

## Enabling real services

### Supabase (auth + cross-device sync)

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor (tables + RLS).
3. Enable Email and Google providers under Authentication.
4. Put the URL + anon key in `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
5. Restart the dev server. The app now uses real auth and syncs the bank.

### AI (Whisper + GPT)

Per the PRD the evaluator is GPT/Gemini (not Claude) and is a swappable module.
This app ships an OpenAI implementation.

```
EXPO_PUBLIC_OPENAI_API_KEY=sk-...
EXPO_PUBLIC_OPENAI_EVAL_MODEL=gpt-4o-mini
EXPO_PUBLIC_OPENAI_TRANSCRIBE_MODEL=whisper-1
```

> **Security:** a key in `.env` is bundled into the client — fine for a personal
> single-user build. For anything shared, stand up a tiny backend (e.g. a
> Supabase Edge Function) exposing `POST /transcribe` and `POST /evaluate`, and
> set `EXPO_PUBLIC_AI_PROXY_URL` to it. The AI module will call the proxy instead
> of OpenAI directly, keeping the key server-side. To swap to Gemini, replace the
> implementation inside `services/ai.ts` (or point the proxy at Gemini) — nothing
> else changes.

With no AI key set, `evaluateAnswer` uses a deterministic heuristic and
`transcribeAudio` returns a clearly-marked placeholder, so the loop stays usable.

## Spaced repetition

`domain/spacedRepetition.ts` is an SM-2 variant. Per PRD §4.4 the **user's
self-evaluation** (Again/Hard/Good/Easy) — not the AI score — sets the next
interval. The buttons preview their resulting interval live. New questions are
"new" (a fallback), distinct from "due" review items.

## Notes

- Open design question from the PRD (§12): Mode B's generated answer is **not**
  auto-saved as the reference — the user opts in with **Save as reference** on
  the feedback screen. Easy to flip if the user decides otherwise.
- `npx tsc --noEmit` is clean; the iOS bundle and web runtime were smoke-tested.
