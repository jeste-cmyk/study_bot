/**
 * Question selection (PRD §4.3).
 *
 * On-demand, one at a time. Priority order:
 *   1. Due items (oldest due first).
 *   2. Optionally narrowed by category / company before an interview.
 *   3. Fallback when nothing is due: brand-new items, else the whole bank.
 *
 * A note expands into one or more `PracticeItem`s: a question is a single item,
 * a story is one item *per trigger* (the trigger is the prompt, the story's
 * storytelling version is the reference). Draft notes are never practised.
 */
import {
  isQuestion,
  isDue,
  storyReference,
  type Attempt,
  type Category,
  type Difficulty,
  type Note,
  type NoteKind,
  type SRState,
} from './types';

export interface PracticeFilter {
  categories?: string[]; // empty / undefined = all
  company?: string | null;
}

/** A single practisable unit, decoupled from whether it came from a question or a story trigger. */
export interface PracticeItem {
  key: string; // unique queue key (noteId, or `${noteId}:${triggerId}`)
  noteId: string;
  triggerId: string | null; // null for questions
  kind: NoteKind;
  prompt: string; // the question text, or the story trigger text
  reference: string | null; // question reference, or the story's combined reference
  category: Category | null;
  company: string | null;
  difficulty: Difficulty | null;
  sr: SRState;
  attempts: Attempt[];
}

/** Expand the bank into practisable items, skipping drafts. */
export function toPracticeItems(notes: Note[]): PracticeItem[] {
  const items: PracticeItem[] = [];
  for (const n of notes) {
    if (n.status === 'draft') continue;
    if (isQuestion(n)) {
      items.push({
        key: n.id,
        noteId: n.id,
        triggerId: null,
        kind: 'question',
        prompt: n.text,
        reference: n.reference,
        category: n.category,
        company: n.company,
        difficulty: n.difficulty,
        sr: n.sr,
        attempts: n.attempts,
      });
    } else {
      const reference = storyReference(n);
      for (const t of n.triggers) {
        items.push({
          key: `${n.id}:${t.id}`,
          noteId: n.id,
          triggerId: t.id,
          kind: 'story',
          prompt: t.text,
          reference,
          category: n.category,
          company: null,
          difficulty: n.difficulty,
          sr: t.sr,
          attempts: t.attempts,
        });
      }
    }
  }
  return items;
}

function matchesFilter(item: PracticeItem, filter?: PracticeFilter): boolean {
  if (!filter) return true;
  if (filter.categories && filter.categories.length > 0) {
    if (!item.category || !filter.categories.includes(item.category)) return false;
  }
  if (filter.company && item.company !== filter.company) return false;
  return true;
}

const byDueAsc = (a: PracticeItem, b: PracticeItem) =>
  new Date(a.sr.dueAt).getTime() - new Date(b.sr.dueAt).getTime();

/**
 * An item is "due for review" when it has been practised before and its next
 * review date has passed. Never-practised items are "new" (a fallback), not due.
 */
const isDueForReview = (item: PracticeItem, now: Date): boolean =>
  item.attempts.length > 0 && isDue(item, now);

/** The ordered list of items to practise now. */
export function buildQueue(
  notes: Note[],
  filter?: PracticeFilter,
  now = new Date(),
): PracticeItem[] {
  const pool = toPracticeItems(notes).filter((it) => matchesFilter(it, filter));

  const due = pool.filter((it) => isDueForReview(it, now)).sort(byDueAsc);
  if (due.length > 0) return due;

  // Nothing due → offer new items first, otherwise everything (oldest-due first).
  const fresh = pool.filter((it) => it.attempts.length === 0);
  if (fresh.length > 0) return fresh.sort(byDueAsc);

  return [...pool].sort(byDueAsc);
}

export const dueCount = (notes: Note[], now = new Date()): number =>
  toPracticeItems(notes).filter((it) => isDueForReview(it, now)).length;
