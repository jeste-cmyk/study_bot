/**
 * App state (Zustand). Owns the auth session and the canonical note bank
 * (questions + stories), and is the single place mutations flow through to the
 * repository.
 */
import { create } from 'zustand';

import { auth, authMode, type AuthUser } from '@/services/auth';
import { repository } from '@/services/repository';
import { uid } from '@/services/id';
import type { Evaluation } from '@/services/ai';
import type {
  Attempt,
  AnswerMode,
  Category,
  Difficulty,
  Note,
  NoteStatus,
  Question,
  Rating,
  Story,
  StoryMode,
  StoryTrigger,
} from '@/domain/types';
import { isStory, notePhotos } from '@/domain/types';
import { initialSR, schedule } from '@/domain/spacedRepetition';
import { photoStore } from '@/services/photos';

export interface NewQuestionInput {
  kind: 'question';
  status?: NoteStatus;
  text: string;
  reference?: string | null;
  category?: Category | null;
  company?: string | null;
  difficulty?: Difficulty | null;
  tags?: string[];
  photos?: string[];
}

export interface NewStoryInput {
  kind: 'story';
  status?: NoteStatus;
  mode?: StoryMode;
  title?: string;
  rawStory: string;
  storytelling?: string;
  score?: number | null;
  triggers?: string[]; // AI-generated prompts, one per trigger
  conversationHooks?: string[];
  category?: Category | null;
  difficulty?: Difficulty | null;
  tags?: string[];
  photos?: string[];
}

export type NewNoteInput = NewQuestionInput | NewStoryInput;

export interface UpdateQuestionPatch {
  text?: string;
  reference?: string | null;
  category?: Category | null;
  company?: string | null;
  difficulty?: Difficulty | null;
  status?: NoteStatus;
  tags?: string[];
  photos?: string[];
}

export interface UpdateStoryPatch {
  mode?: StoryMode;
  title?: string;
  rawStory?: string;
  storytelling?: string;
  score?: number | null;
  triggers?: { id?: string; text: string }[]; // id present = keep its SR/attempts
  conversationHooks?: string[];
  category?: Category | null;
  difficulty?: Difficulty | null;
  status?: NoteStatus;
  tags?: string[];
  photos?: string[];
}

export type UpdateNotePatch = UpdateQuestionPatch | UpdateStoryPatch;

export interface RecordAttemptInput {
  mode: AnswerMode;
  answerText: string;
  transcript?: string | null;
  audioUri?: string | null;
  evaluation: Evaluation;
  rating: Rating;
  saveReference?: boolean; // Mode B: adopt the AI's model answer as the reference (questions only)
}

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface StoreState {
  status: AuthStatus;
  user: AuthUser | null;
  notes: Note[];
  authMode: typeof authMode;

  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;

  getNote: (id: string) => Note | undefined;
  addNote: (input: NewNoteInput) => Promise<Note>;
  updateNote: (id: string, patch: UpdateNotePatch) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  recordAttempt: (
    noteId: string,
    triggerId: string | null,
    input: RecordAttemptInput,
  ) => Promise<void>;
}

const trimOrNull = (s?: string | null): string | null =>
  s && s.trim() ? s.trim() : null;

const newTrigger = (text: string, now: Date): StoryTrigger => ({
  id: uid('tr-'),
  text: text.trim(),
  sr: initialSR(now),
  attempts: [],
});

export const useStore = create<StoreState>((set, get) => ({
  status: 'loading',
  user: null,
  notes: [],
  authMode,

  async bootstrap() {
    const user = await auth.getUser();
    if (!user) {
      set({ status: 'signed-out', user: null, notes: [] });
      return;
    }
    const notes = await repository.load(user.id);
    set({ status: 'signed-in', user, notes });
  },

  async signIn(email, password) {
    const user = await auth.signIn(email, password);
    const notes = await repository.load(user.id);
    set({ status: 'signed-in', user, notes });
  },

  async signUp(email, password) {
    const user = await auth.signUp(email, password);
    const notes = await repository.load(user.id);
    set({ status: 'signed-in', user, notes });
  },

  async signInWithGoogle() {
    const user = await auth.signInWithGoogle();
    const notes = await repository.load(user.id);
    set({ status: 'signed-in', user, notes });
  },

  async signOut() {
    await auth.signOut();
    set({ status: 'signed-out', user: null, notes: [] });
  },

  getNote(id) {
    return get().notes.find((n) => n.id === id);
  },

  async addNote(input) {
    const user = get().user;
    if (!user) throw new Error('Not signed in');
    const now = new Date();
    const iso = now.toISOString();
    const status: NoteStatus = input.status ?? 'ready';

    let note: Note;
    if (input.kind === 'story') {
      note = {
        id: uid('s-'),
        userId: user.id,
        kind: 'story',
        status,
        mode: input.mode ?? 'interview',
        title: (input.title ?? '').trim(),
        rawStory: input.rawStory.trim(),
        storytelling: (input.storytelling ?? '').trim(),
        score: input.score ?? null,
        triggers: (input.triggers ?? [])
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => newTrigger(t, now)),
        conversationHooks: (input.conversationHooks ?? [])
          .map((h) => h.trim())
          .filter(Boolean),
        sr: initialSR(now),
        attempts: [],
        category: input.category ?? null,
        difficulty: input.difficulty ?? null,
        tags: input.tags ?? [],
        photos: input.photos ?? [],
        createdAt: iso,
        updatedAt: iso,
      };
    } else {
      note = {
        id: uid('q-'),
        userId: user.id,
        kind: 'question',
        status,
        text: input.text.trim(),
        reference: trimOrNull(input.reference),
        category: input.category ?? null,
        company: trimOrNull(input.company),
        difficulty: input.difficulty ?? null,
        tags: input.tags ?? [],
        photos: input.photos ?? [],
        createdAt: iso,
        updatedAt: iso,
        sr: initialSR(now),
        attempts: [],
      };
    }

    set({ notes: [note, ...get().notes] });
    await repository.createNote(note);
    return note;
  },

  async updateNote(id, patch) {
    const note = get().getNote(id);
    if (!note) return;
    const now = new Date().toISOString();

    let updated: Note;
    if (isStory(note)) {
      const p = patch as UpdateStoryPatch;
      const triggers: StoryTrigger[] = p.triggers
        ? p.triggers
            .map((t) => {
              const text = t.text.trim();
              if (!text) return null;
              const existing = t.id
                ? note.triggers.find((x) => x.id === t.id)
                : undefined;
              return existing
                ? { ...existing, text }
                : newTrigger(text, new Date());
            })
            .filter((t): t is StoryTrigger => t !== null)
        : note.triggers;
      updated = {
        ...note,
        mode: p.mode !== undefined ? p.mode : note.mode,
        title: p.title !== undefined ? p.title.trim() : note.title,
        rawStory: p.rawStory !== undefined ? p.rawStory.trim() : note.rawStory,
        storytelling:
          p.storytelling !== undefined ? p.storytelling.trim() : note.storytelling,
        score: p.score !== undefined ? p.score : note.score,
        triggers,
        conversationHooks:
          p.conversationHooks !== undefined
            ? p.conversationHooks.map((h) => h.trim()).filter(Boolean)
            : note.conversationHooks,
        category: p.category !== undefined ? p.category : note.category,
        difficulty: p.difficulty !== undefined ? p.difficulty : note.difficulty,
        status: p.status ?? note.status,
        tags: p.tags ?? note.tags,
        photos: p.photos ?? note.photos,
        updatedAt: now,
      };
    } else {
      const p = patch as UpdateQuestionPatch;
      updated = {
        ...note,
        text: p.text?.trim() ?? note.text,
        reference:
          p.reference !== undefined ? trimOrNull(p.reference) : note.reference,
        category: p.category !== undefined ? p.category : note.category,
        company: p.company !== undefined ? trimOrNull(p.company) : note.company,
        difficulty: p.difficulty !== undefined ? p.difficulty : note.difficulty,
        status: p.status ?? note.status,
        tags: p.tags ?? note.tags,
        photos: p.photos ?? note.photos,
        updatedAt: now,
      };
    }

    set({ notes: get().notes.map((x) => (x.id === id ? updated : x)) });
    await repository.updateNote(updated);
  },

  async deleteNote(id) {
    const user = get().user;
    if (!user) return;
    const note = get().getNote(id);
    set({ notes: get().notes.filter((x) => x.id !== id) });
    // Reclaim the note's attached photos now that nothing references them.
    if (note) void Promise.all(notePhotos(note).map((ref) => photoStore.remove(ref)));
    await repository.deleteNote(user.id, id);
  },

  async recordAttempt(noteId, triggerId, input) {
    const note = get().getNote(noteId);
    if (!note) throw new Error('Note not found');
    const now = new Date();

    const attempt: Attempt = {
      id: uid('att-'),
      questionId: noteId,
      triggerId,
      mode: input.mode,
      answerText: input.answerText,
      transcript: input.transcript ?? null,
      audioUri: input.audioUri ?? null,
      aiScore: input.evaluation.score,
      aiSummary: input.evaluation.summary,
      strengths: input.evaluation.strengths,
      improvements: input.evaluation.improvements,
      generatedReference: input.evaluation.generatedReference,
      rating: input.rating,
      createdAt: now.toISOString(),
    };

    if (isStory(note)) {
      // Personal stories are practised as one card → schedule at the story level.
      // Interview stories still drill one trigger at a time.
      const updated: Story =
        note.mode === 'personal'
          ? {
              ...note,
              sr: schedule(note.sr, input.rating, now),
              attempts: [attempt, ...note.attempts],
              updatedAt: now.toISOString(),
            }
          : {
              ...note,
              triggers: note.triggers.map((t) =>
                t.id === triggerId
                  ? {
                      ...t,
                      sr: schedule(t.sr, input.rating, now),
                      attempts: [attempt, ...t.attempts],
                    }
                  : t,
              ),
              updatedAt: now.toISOString(),
            };
      set({ notes: get().notes.map((x) => (x.id === noteId ? updated : x)) });
      // Story attempts/SR live inside the note → a single note write persists them.
      await repository.updateNote(updated);
      return;
    }

    const sr = schedule(note.sr, input.rating, now);
    const adoptReference =
      input.saveReference && input.evaluation.generatedReference
        ? input.evaluation.generatedReference
        : note.reference;
    const updated: Question = {
      ...note,
      reference: adoptReference,
      sr,
      attempts: [attempt, ...note.attempts],
      updatedAt: now.toISOString(),
    };
    set({ notes: get().notes.map((x) => (x.id === noteId ? updated : x)) });
    await repository.addAttempt(attempt, sr);
    await repository.updateNote(updated);
  },
}));
