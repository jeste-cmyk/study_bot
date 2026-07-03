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
  Story,
  StoryTrigger,
} from '@/domain/types';
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
 * Normalise notes loaded from storage so older records (saved before stories /
 * drafts existed) keep working without a migration.
 */
function normalizeNote(raw: any): Note {
  if (raw?.kind === 'story') {
    const story = raw as Story;
    return {
      ...story,
      status: story.status ?? 'ready',
      triggers: (story.triggers ?? []).map((t) => ({
        ...t,
        attempts: (t.attempts ?? []).map((a) => ({ ...a, triggerId: a.triggerId ?? t.id })),
      })),
    };
  }
  const q = raw as Question;
  return {
    ...q,
    kind: 'question',
    status: q.status ?? 'ready',
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
  hook: string;
  narrative: string;
  takeaway: string;
  triggers: StoryTrigger[];
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

  if (r.kind === 'story' && r.story) {
    return {
      ...base,
      kind: 'story',
      hook: r.story.hook,
      narrative: r.story.narrative,
      takeaway: r.story.takeaway,
      triggers: r.story.triggers ?? [],
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
      text: n.hook, // store the hook in `text` for search/preview
      reference: null,
      category: n.category,
      company: null,
      difficulty: n.difficulty,
      tags: n.tags,
      sr: null,
      story: {
        hook: n.hook,
        narrative: n.narrative,
        takeaway: n.takeaway,
        triggers: n.triggers,
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
    sr: n.sr,
    story: null,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
};

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
    if (error) throw error;
    return (data as NoteRow[]).map(rowToNote);
  }

  async createNote(n: Note): Promise<void> {
    const { error } = await this.db.from('questions').insert(noteToRow(n));
    if (error) throw error;
  }

  async updateNote(n: Note): Promise<void> {
    const { error } = await this.db
      .from('questions')
      .update(noteToRow(n))
      .eq('id', n.id);
    if (error) throw error;
  }

  async deleteNote(_userId: string, id: string): Promise<void> {
    const { error } = await this.db.from('questions').delete().eq('id', id);
    if (error) throw error;
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
    if (error) throw error;
    // Persist the recomputed SR state onto the question row.
    const { error: uErr } = await this.db
      .from('questions')
      .update({ sr, updated_at: new Date().toISOString() })
      .eq('id', attempt.questionId);
    if (uErr) throw uErr;
  }
}

export const repository: Repository = isSupabaseConfigured
  ? new SupabaseRepository()
  : new LocalRepository();
