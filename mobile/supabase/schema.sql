-- Recall — Supabase schema (PRD §8).
-- Run this in the Supabase SQL editor once. Auth users come from Supabase Auth
-- (email/password + Google). Row-level security scopes every row to its owner,
-- satisfying the privacy requirement (NFR: data restricted to the account).

-- ---------------------------------------------------------------------------
-- questions: the user's personal note bank. Holds both `question` notes (Q&A)
-- and `story` notes (personal stories). SR state is stored as JSONB so the
-- scheduling algorithm can evolve without migrations.
--
-- A story has no top-level SR (each of its triggers is scheduled separately);
-- its hook / narrative / takeaway / triggers — including each trigger's own SR
-- and attempt history — live in the `story` JSONB column. The `text` column
-- holds the story's hook so search/preview work uniformly across kinds.
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'question' check (kind in ('question', 'story')),
  status      text not null default 'ready'    check (status in ('ready', 'draft')),
  text        text,
  reference   text,
  category    text,
  company     text,
  difficulty  text,
  tags        text[] not null default '{}',
  photos      text[] not null default '{}', -- attached image URIs (any note kind)
  sr          jsonb,         -- null for story notes
  story       jsonb,         -- null for question notes
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Migrate an existing table created before stories / drafts / photos existed.
alter table public.questions
  add column if not exists kind   text not null default 'question',
  add column if not exists status text not null default 'ready',
  add column if not exists story  jsonb,
  add column if not exists photos text[] not null default '{}';
alter table public.questions alter column text drop not null;
alter table public.questions alter column sr   drop not null;

create index if not exists questions_user_idx on public.questions (user_id);
-- Fast "what's due" lookups: order by the dueAt inside the SR JSON.
create index if not exists questions_due_idx
  on public.questions (user_id, ((sr->>'dueAt')));

-- ---------------------------------------------------------------------------
-- attempts: full practice history per question (PRD §8 — not only the latest).
-- ---------------------------------------------------------------------------
create table if not exists public.attempts (
  id                  text primary key,
  question_id         text not null references public.questions (id) on delete cascade,
  mode                text not null check (mode in ('voice', 'text')),
  answer_text         text not null default '',
  transcript          text,
  audio_uri           text,
  ai_score            int  not null,
  ai_summary          text not null default '',
  strengths           text not null default '',
  improvements        text not null default '',
  generated_reference text,
  rating              text not null check (rating in ('again', 'hard', 'good', 'easy')),
  created_at          timestamptz not null default now()
);

create index if not exists attempts_question_idx on public.attempts (question_id);

-- ---------------------------------------------------------------------------
-- Row-level security: a user can only see/modify their own bank.
-- ---------------------------------------------------------------------------
alter table public.questions enable row level security;
alter table public.attempts  enable row level security;

drop policy if exists "questions are owner-only" on public.questions;
create policy "questions are owner-only" on public.questions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Attempts inherit ownership through their question.
drop policy if exists "attempts are owner-only" on public.attempts;
create policy "attempts are owner-only" on public.attempts
  for all using (
    exists (
      select 1 from public.questions q
      where q.id = attempts.question_id and q.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.questions q
      where q.id = attempts.question_id and q.user_id = auth.uid()
    )
  );
