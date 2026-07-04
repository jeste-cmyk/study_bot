import type { ReviewStatus } from '@/theme';

export type Category = 'Behavioral' | 'Case' | 'Technical' | 'Fit';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type AnswerMode = 'voice' | 'text';
export type Rating = 'again' | 'hard' | 'good' | 'easy';

/** A note is either a Q&A `question` or a personal `story`. */
export type NoteKind = 'question' | 'story';
/** `draft` notes are saved but excluded from practice/exams until marked ready. */
export type NoteStatus = 'ready' | 'draft';
/**
 * Which coach a story is authored for:
 * - `interview` — a professional STAR-style answer graded on impact.
 * - `personal`  — a story told to friends, graded on how well it lands, with
 *                 conversation directions for keeping the chat going.
 */
export type StoryMode = 'interview' | 'personal';

/** Spaced-repetition state for a question (SM-2 variant). */
export interface SRState {
  reps: number; // successful reps in a row
  intervalDays: number; // current interval (0 = same-day relearn)
  ease: number; // SM-2 ease factor
  dueAt: string; // ISO timestamp of next review
  lastReviewedAt: string | null;
  history: number[]; // past intervals (for progress / future algorithms)
}

/** One practice attempt against a question or a single story trigger. */
export interface Attempt {
  id: string;
  questionId: string; // owning note id
  triggerId: string | null; // story trigger id when the note is a story, else null
  mode: AnswerMode;
  answerText: string; // typed text, or the transcript of a voice answer
  transcript: string | null;
  audioUri: string | null;
  aiScore: number; // 1–10
  aiSummary: string; // short headline ("Solid, lead with impact")
  strengths: string;
  improvements: string;
  generatedReference: string | null; // Mode B: the model answer the AI drafted
  rating: Rating; // the user's self-evaluation (drives SR)
  createdAt: string;
}

export interface Question {
  id: string;
  userId: string;
  kind: 'question';
  status: NoteStatus;
  text: string;
  reference: string | null; // reference answer — null until the user/AI fills it (Mode B)
  category: Category | null;
  company: string | null;
  difficulty: Difficulty | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sr: SRState;
  attempts: Attempt[]; // most-recent first
}

/**
 * A story is practised one trigger at a time, so each trigger owns its own SR
 * state and attempt history. The hook + narrative + takeaway form the shared
 * reference answer all triggers are graded against.
 */
export interface StoryTrigger {
  id: string;
  text: string; // the prompt/topic that should remind you to tell this story
  sr: SRState;
  attempts: Attempt[]; // most-recent first
}

export interface Story {
  id: string;
  userId: string;
  kind: 'story';
  status: NoteStatus;
  /** Which coach authored/scores this story. */
  mode: StoryMode;
  /** Short title — filled by AI on analyze, editable by hand. */
  title: string;
  /** Box 1: the user's own account, seeded with guiding prompts. AI never
   *  rewrites this; it only appends follow-up questions to the end. */
  rawStory: string;
  /** Box 2: the AI's polished storytelling version. Editable, and the
   *  reference a story's triggers are graded against. */
  storytelling: string;
  /** AI-assigned readiness score (0–10), editable. `null` until analyzed. */
  score: number | null;
  /** AI-generated prompts; each is drilled separately with its own SR state. */
  triggers: StoryTrigger[];
  /**
   * Personal mode only: ways to keep the conversation going after telling the
   * story — questions to ask, opinions to float, related/unrelated pivots.
   * Empty for interview stories.
   */
  conversationHooks: string[];
  category: Category | null;
  difficulty: Difficulty | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type Note = Question | Story;

export const isQuestion = (n: Note): n is Question => n.kind === 'question';
export const isStory = (n: Note): n is Story => n.kind === 'story';

/**
 * The reference a story's triggers are graded against: the polished
 * storytelling version, falling back to the user's raw account if they haven't
 * analyzed it yet.
 */
export function storyReference(
  s: Pick<Story, 'storytelling' | 'rawStory'>,
): string {
  return s.storytelling.trim() || s.rawStory.trim();
}

/** A short title for list/preview rows, regardless of note kind. */
export function noteTitle(n: Note): string {
  if (isStory(n)) return n.title || n.triggers[0]?.text || 'Untitled story';
  return n.text;
}

/** All attempts for a note, most-recent first (stories pool across triggers). */
export function noteAttempts(n: Note): Attempt[] {
  if (isStory(n)) {
    return n.triggers
      .flatMap((t) => t.attempts)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return n.attempts;
}

/** Which evaluation mode applies, derived from whether a reference exists. */
export type PracticeMode = 'A' | 'B';

export const practiceMode = (q: { reference: string | null }): PracticeMode =>
  q.reference && q.reference.trim().length > 0 ? 'A' : 'B';

export const lastScore = (n: Note): number | null => {
  const attempts = noteAttempts(n);
  return attempts.length > 0 ? attempts[0].aiScore : null;
};

/** Map an SR + attempt history to one of the design's status chips. */
export function reviewStatus(
  q: { sr: SRState; attempts: Attempt[] },
  now = new Date(),
): ReviewStatus {
  if (q.sr.reps === 0 && q.attempts.length === 0) return 'new';
  if (new Date(q.sr.dueAt).getTime() <= now.getTime()) return 'due';
  if (q.sr.intervalDays <= 3) return 'learning';
  return 'scheduled';
}

/** Note-level status: for stories, aggregate the most-urgent trigger. */
export function noteReviewStatus(n: Note, now = new Date()): ReviewStatus {
  if (isQuestion(n)) return reviewStatus(n, now);
  if (n.triggers.length === 0) return 'new';
  const statuses = n.triggers.map((t) => reviewStatus(t, now));
  if (statuses.includes('due')) return 'due';
  if (statuses.every((s) => s === 'new')) return 'new';
  if (statuses.includes('learning')) return 'learning';
  return 'scheduled';
}

export const isDue = (q: { sr: SRState }, now = new Date()): boolean =>
  new Date(q.sr.dueAt).getTime() <= now.getTime();
