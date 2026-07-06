/**
 * Bank search. Runs entirely client-side over the in-memory note list.
 *
 * A query is split into whitespace-separated terms; a note matches when *every*
 * term is found in *some* searchable field (AND across terms, OR across fields).
 * Each term matches a field by exact substring, or — when the term is long
 * enough — by a word within a small edit distance, so typos still hit.
 *
 * Beyond a yes/no, `matchNote` also reports where the match landed so the UI can
 * highlight the title and surface a quick-view excerpt of the body text.
 */
import { isStory, noteTitle, type Note } from '@/domain/types';

export interface MatchSpan {
  /** Inclusive start / exclusive end char offsets into the text being marked. */
  start: number;
  end: number;
}

export interface SearchHit {
  /** Human label of the field the snippet came from, e.g. "Answer". */
  field: string;
  /** A windowed excerpt of the field text, with ellipses when trimmed. */
  snippet: string;
  /** Ranges within `snippet` to highlight. */
  spans: MatchSpan[];
}

export interface NoteMatch {
  matched: boolean;
  /** Ranges within `noteTitle(note)` to highlight (empty when the title itself
   *  didn't match — the match was purely in body text). */
  titleSpans: MatchSpan[];
  /** Best non-title excerpt to surface as a quick view, or null when nothing but
   *  the (already-visible) title matched. */
  hit: SearchHit | null;
}

interface Field {
  label: string;
  text: string;
}

/** Everything search looks at for a note, title first. */
export function searchableFields(n: Note): Field[] {
  const fields: Field[] = [{ label: 'Title', text: noteTitle(n) }];
  if (isStory(n)) {
    fields.push({ label: 'Story', text: n.rawStory });
    fields.push({ label: 'Polished', text: n.storytelling });
    if (n.triggers.length) {
      fields.push({ label: 'Trigger', text: n.triggers.map((t) => t.text).join(' · ') });
    }
    if (n.conversationHooks.length) {
      fields.push({ label: 'Hook', text: n.conversationHooks.join(' · ') });
    }
  } else {
    if (n.company) fields.push({ label: 'Company', text: n.company });
    if (n.reference) fields.push({ label: 'Answer', text: n.reference });
  }
  if (n.tags.length) fields.push({ label: 'Tags', text: n.tags.join(' ') });
  return fields.filter((f) => f.text.trim().length > 0);
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Max edit distance tolerated for a term of the given length. Short terms are
 *  matched exactly — one typo in a 3-letter word is too much noise. */
function fuzzTolerance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/**
 * Levenshtein distance, bounded: bails out with `max + 1` as soon as the whole
 * remaining row exceeds `max`, so a non-match never costs a full DP pass.
 */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Find where `term` occurs in `text`: an exact substring if present, otherwise
 * the closest whole word within the fuzzy tolerance. Returns a char range in
 * `text`, or null when there's no acceptable match.
 */
function findTerm(term: string, text: string): MatchSpan | null {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(term);
  if (idx >= 0) return { start: idx, end: idx + term.length };

  const tol = fuzzTolerance(term.length);
  if (tol === 0) return null;

  const re = /\S+/g;
  let best: MatchSpan | null = null;
  let bestDist = tol + 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const d = boundedLevenshtein(term, m[0], tol);
    if (d <= tol && d < bestDist) {
      best = { start: m.index, end: m.index + m[0].length };
      bestDist = d;
      if (d === 0) break;
    }
  }
  return best;
}

const WINDOW = 96; // max chars shown in a quick-view snippet
const CONTEXT = 24; // chars of lead-in before the first match

/** Build a windowed, highlighted excerpt of `field` around its matching terms. */
function buildHit(field: Field, terms: string[]): SearchHit {
  const ranges = terms
    .map((t) => findTerm(t, field.text))
    .filter((r): r is MatchSpan => r !== null)
    .sort((a, b) => a.start - b.start);

  const first = ranges[0];
  const end = Math.min(field.text.length, Math.max(first.end, first.start - CONTEXT + WINDOW));
  const start = Math.max(0, end - WINDOW);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < field.text.length ? '…' : '';
  const snippet = prefix + field.text.slice(start, end) + suffix;
  const offset = prefix.length - start;

  const spans = ranges
    .filter((r) => r.start >= start && r.end <= end)
    .map((r) => ({ start: r.start + offset, end: r.end + offset }));

  return { field: field.label, snippet, spans };
}

/**
 * Match a single note against a query and describe where it hit. An empty query
 * matches everything with no highlights.
 */
export function matchNote(note: Note, query: string): NoteMatch {
  const terms = tokenize(query);
  if (terms.length === 0) return { matched: true, titleSpans: [], hit: null };

  const fields = searchableFields(note);

  // Every term must appear in at least one field.
  for (const term of terms) {
    if (!fields.some((f) => findTerm(term, f.text))) {
      return { matched: false, titleSpans: [], hit: null };
    }
  }

  const titleSpans = terms
    .map((t) => findTerm(t, fields[0].text))
    .filter((r): r is MatchSpan => r !== null);

  // Surface the body field that matches the most terms, for the quick view.
  let bestField: Field | null = null;
  let bestCount = 0;
  for (let i = 1; i < fields.length; i++) {
    const count = terms.filter((t) => findTerm(t, fields[i].text)).length;
    if (count > bestCount) {
      bestCount = count;
      bestField = fields[i];
    }
  }

  return {
    matched: true,
    titleSpans,
    hit: bestField ? buildHit(bestField, terms) : null,
  };
}

/** Notes matching `query`, original order preserved. */
export function searchNotes(notes: Note[], query: string): Note[] {
  return notes.filter((n) => matchNote(n, query).matched);
}
