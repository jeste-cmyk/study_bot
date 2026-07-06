/**
 * Data repository (PRD §8 — Users have Notes; questions have Attempts and an SR
 * state, stories have triggers that each carry their own SR + attempts).
 * One interface, two implementations:
 *
 *  - LocalRepository:    AsyncStorage, seeded on first run. Used when Supabase
 *                        is not configured. Fully functional, single-device.
 *  - SupabaseRepository: Postgres with row-level security, synced across
 *                        devices. Used when Supabase env vars are present.
 *
 * The store owns the canonical in-memory `Note[]`; the repository persists
 * mutations and loads on sign-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSupabaseConfigured } from '@/config/env';
import type {
  Attempt,
  Note,
  Question,
  SRState,
  StoryMode,
  StoryTrigger,
} from '@/domain/types';
import { initialSR } from '@/domain/spacedRepetition';
import { supabase } from './supabaseClient';
import { seedNotes } from './seed';

export interface Repository {
  load(userId: string): Promise<Note[]>;
  createNote(n: Note): Promise<void>;
  updateNote(n: Note): Promise<void>; // note fields + sr/attempts for stories
  deleteNote(userId: string, id: string): Promise<void>;
  addAttempt(attempt: Attempt, sr: SRState): Promise<void>; // question relational attempt
}

/**
 * Migrate a story's content fields, upgrading legacy records (which stored
 * `hook`/`narrative`/`takeaway`) to the free-text `title`/`rawStory`/
 * `storytelling`/`score` shape. Nothing is lost: the three legacy sections are
 * combined into the raw box, and the old labelled reference becomes the
 * storytelling version.
 */
function migrateStoryContent(raw: any): {
  mode: StoryMode;
  title: string;
  rawStory: string;
  storytelling: string;
  score: number | null;
  conversationHooks: string[];
} {
  const mode: StoryMode = raw?.mode === 'personal' ? 'personal' : 'interview';
  const conversationHooks = Array.isArray(raw?.conversationHooks)
    ? raw.conversationHooks.map((h: unknown) => String(h)).filter(Boolean)
    : [];
  const isNew =
    typeof raw?.rawStory === 'string' ||
    typeof raw?.storytelling === 'string' ||
    typeof raw?.title === 'string';
  if (isNew) {
    return {
      mode,
      title: String(raw.title ?? ''),
      rawStory: String(raw.rawStory ?? ''),
      storytelling: String(raw.storytelling ?? ''),
      score: typeof raw.score === 'number' ? raw.score : null,
      conversationHooks,
    };
  }
  const hook = String(raw?.hook ?? '').trim();
  const narrative = String(raw?.narrative ?? '').trim();
  const takeaway = String(raw?.takeaway ?? '').trim();
  const rawStory = [hook, narrative, takeaway].filter(Boolean).join('\n\n');
  const storytelling = [
    hook,
    narrative,
    takeaway ? `Takeaway: ${takeaway}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { mode, title: hook, rawStory, storytelling, score: null, conversationHooks };
}

/**
 * The story-level schedule + delivery attempts (personal mode). Absent on
 * legacy records → start fresh so the story is immediately practiseable.
 */
function migrateStorySchedule(raw: any): { sr: SRState; attempts: Attempt[] } {
  const sr: SRState =
    raw?.sr && typeof raw.sr === 'object'
      ? (raw.sr as SRState)
      : initialSR(raw?.createdAt ? new Date(raw.createdAt) : undefined);
  const attempts: Attempt[] = Array.isArray(raw?.attempts)
    ? raw.attempts.map((a: Attempt) => ({ ...a, triggerId: a.triggerId ?? null }))
    : [];
  return { sr, attempts };
}

/**
 * Normalise notes loaded from storage so older records (saved before stories /
 * drafts / the free-text story rewrite existed) keep working without a
 * migration.
 */
function normalizeNote(raw: any): Note {
  if (raw?.kind === 'story') {
    const { mode, title, rawStory, storytelling, score, conversationHooks } =
      migrateStoryContent(raw);
    return {
      id: raw.id,
      userId: raw.userId,
      kind: 'story',
      status: raw.status ?? 'ready',
      mode,
      title,
      rawStory,
      storytelling,
      score,
      triggers: (raw.triggers ?? []).map((t: StoryTrigger) => ({
        ...t,
        attempts: (t.attempts ?? []).map((a) => ({ ...a, triggerId: a.triggerId ?? t.id })),
      })),
      conversationHooks,
      ...migrateStorySchedule(raw),
      category: raw.category ?? null,
      difficulty: raw.difficulty ?? null,
      tags: raw.tags ?? [],
      photos: Array.isArray(raw.photos) ? raw.photos.map(String) : [],
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
  const q = raw as Question;
  return {
    ...q,
    kind: 'question',
    status: q.status ?? 'ready',
    photos: Array.isArray(q.photos) ? q.photos.map(String) : [],
    attempts: (q.attempts ?? []).map((a) => ({ ...a, triggerId: a.triggerId ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Local
// ---------------------------------------------------------------------------

const keyFor = (userId: string) => `recall:questions:${userId}`;

class LocalRepository implements Repository {
  private async read(userId: string): Promise<Note[]> {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as any[]).map(normalizeNote) : [];
  }

  private async write(userId: string, notes: Note[]): Promise<void> {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(notes));
  }

  async load(userId: string): Promise<Note[]> {
    const existing = await this.read(userId);
    if (existing.length > 0) return existing;
    const seeded = seedNotes(userId);
    await this.write(userId, seeded);
    return seeded;
  }

  async createNote(n: Note): Promise<void> {
    const all = await this.read(n.userId);
    await this.write(n.userId, [n, ...all]);
  }

  async updateNote(n: Note): Promise<void> {
    const all = await this.read(n.userId);
    await this.write(
      n.userId,
      all.map((x) => (x.id === n.id ? { ...n } : x)),
    );
  }

  async deleteNote(userId: string, id: string): Promise<void> {
    const all = await this.read(userId);
    await this.write(
      userId,
      all.filter((x) => x.id !== id),
    );
  }

  async addAttempt(): Promise<void> {
    // No-op for local: updateNote already persisted the embedded attempt.
  }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type StoryPayload = {
  mode?: StoryMode;
  title: string;
  rawStory: string;
  storytelling: string;
  score: number | null;
  triggers: StoryTrigger[];
  conversationHooks?: string[];
  sr?: SRState; // story-level schedule (personal mode)
  attempts?: Attempt[]; // story-level delivery attempts (personal mode)
};

type NoteRow = {
  id: string;
  user_id: string;
  kind: 'question' | 'story' | null;
  status: 'ready' | 'draft' | null;
  text: string | null;
  reference: string | null;
  category: string | null;
  company: string | null;
  difficulty: string | null;
  tags: string[] | null;
  photos: string[] | null;
  sr: SRState | null;
  story: StoryPayload | null;
  created_at: string;
  updated_at: string;
  attempts?: AttemptRow[];
};

type AttemptRow = {
  id: string;
  question_id: string;
  mode: string;
  answer_text: string;
  transcript: string | null;
  audio_uri: string | null;
  ai_score: number;
  ai_summary: string;
  strengths: string;
  improvements: string;
  generated_reference: string | null;
  rating: string;
  created_at: string;
};

const rowToAttempt = (r: AttemptRow): Attempt => ({
  id: r.id,
  questionId: r.question_id,
  triggerId: null,
  mode: r.mode as Attempt['mode'],
  answerText: r.answer_text,
  transcript: r.transcript,
  audioUri: r.audio_uri,
  aiScore: r.ai_score,
  aiSummary: r.ai_summary,
  strengths: r.strengths,
  improvements: r.improvements,
  generatedReference: r.generated_reference,
  rating: r.rating as Attempt['rating'],
  createdAt: r.created_at,
});

const rowToNote = (r: NoteRow): Note => {
  const base = {
    id: r.id,
    userId: r.user_id,
    status: (r.status ?? 'ready') as Note['status'],
    category: r.category as Question['category'],
    difficulty: r.difficulty as Question['difficulty'],
    tags: r.tags ?? [],
    photos: r.photos ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

  if (r.kind === 'story' && r.story) {
    const { mode, title, rawStory, storytelling, score, conversationHooks } =
      migrateStoryContent(r.story);
    return {
      ...base,
      kind: 'story',
      mode,
      title,
      rawStory,
      storytelling,
      score,
      triggers: (r.story.triggers ?? []).map((t) => ({
        ...t,
        attempts: (t.attempts ?? []).map((a) => ({ ...a, triggerId: a.triggerId ?? t.id })),
      })),
      conversationHooks,
      ...migrateStorySchedule({ ...r.story, createdAt: r.created_at }),
    };
  }

  return {
    ...base,
    kind: 'question',
    text: r.text ?? '',
    reference: r.reference,
    company: r.company,
    sr: r.sr as SRState,
    attempts: (r.attempts ?? [])
      .map(rowToAttempt)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
  };
};

const noteToRow = (n: Note): Omit<NoteRow, 'attempts'> => {
  if (n.kind === 'story') {
    return {
      id: n.id,
      user_id: n.userId,
      kind: 'story',
      status: n.status,
      text: n.title, // store the title in `text` for search/preview
      reference: null,
      category: n.category,
      company: null,
      difficulty: n.difficulty,
      tags: n.tags,
      photos: n.photos,
      sr: null,
      story: {
        mode: n.mode,
        title: n.title,
        rawStory: n.rawStory,
        storytelling: n.storytelling,
        score: n.score,
        triggers: n.triggers,
        conversationHooks: n.conversationHooks,
        sr: n.sr,
        attempts: n.attempts,
      },
      created_at: n.createdAt,
      updated_at: n.updatedAt,
    };
  }
  return {
    id: n.id,
    user_id: n.userId,
    kind: 'question',
    status: n.status,
    text: n.text,
    reference: n.reference,
    category: n.category,
    company: n.company,
    difficulty: n.difficulty,
    tags: n.tags,
    photos: n.photos,
    sr: n.sr,
    story: null,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
};

/**
 * Supabase/PostgREST rejects with a plain `{ message, code, details, hint }`
 * object, not an `Error`. Screens that surface `e instanceof Error ? e.message`
 * would otherwise swallow it behind a generic message, so wrap it into a real
 * Error that preserves the Postgres detail (e.g. a missing column after a
 * skipped schema migration).
 */
function asError(error: { message?: string; details?: string; hint?: string; code?: string }): Error {
  const parts = [error.message, error.details, error.hint].filter(Boolean);
  const err = new Error(parts.join(' — ') || 'Supabase request failed');
  if (error.code) (err as Error & { code?: string }).code = error.code;
  return err;
}

class SupabaseRepository implements Repository {
  private get db() {
    if (!supabase) throw new Error('Supabase is not configured');
    return supabase;
  }

  async load(userId: string): Promise<Note[]> {
    const { data, error } = await this.db
      .from('questions')
      .select('*, attempts(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw asError(error);
    return (data as NoteRow[]).map(rowToNote);
  }

  async createNote(n: Note): Promise<void> {
    const { error } = await this.db.from('questions').insert(noteToRow(n));
    if (error) throw asError(error);
  }

  async updateNote(n: Note): Promise<void> {
    const { error } = await this.db
      .from('questions')
      .update(noteToRow(n))
      .eq('id', n.id);
    if (error) throw asError(error);
  }

  async deleteNote(_userId: string, id: string): Promise<void> {
    const { error } = await this.db.from('questions').delete().eq('id', id);
    if (error) throw asError(error);
  }

  async addAttempt(attempt: Attempt, sr: SRState): Promise<void> {
    const { error } = await this.db.from('attempts').insert({
      id: attempt.id,
      question_id: attempt.questionId,
      mode: attempt.mode,
      answer_text: attempt.answerText,
      transcript: attempt.transcript,
      audio_uri: attempt.audioUri,
      ai_score: attempt.aiScore,
      ai_summary: attempt.aiSummary,
      strengths: attempt.strengths,
      improvements: attempt.improvements,
      generated_reference: attempt.generatedReference,
      rating: attempt.rating,
      created_at: attempt.createdAt,
    });
    if (error) throw asError(error);
    // Persist the recomputed SR state onto the question row.
    const { error: uErr } = await this.db
      .from('questions')
      .update({ sr, updated_at: new Date().toISOString() })
      .eq('id', attempt.questionId);
    if (uErr) throw asError(uErr);
  }
}

export const repository: Repository = isSupabaseConfigured
  ? new SupabaseRepository()
  : new LocalRepository();
