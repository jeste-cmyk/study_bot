/**
 * Spaced-repetition engine (SM-2 variant).
 *
 * Per the PRD (§4.4): the user's *self-evaluation* — not the AI score — drives
 * the next interval. So `schedule()` takes a `Rating` (the Anki-style
 * Again/Hard/Good/Easy button the user taps after seeing the AI feedback).
 */
import type { Rating, SRState } from './types';

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const RELEARN_MINUTES = 10; // "Again" → see it again in ~10 minutes

export function initialSR(now = new Date()): SRState {
  return {
    reps: 0,
    intervalDays: 0,
    ease: DEFAULT_EASE,
    dueAt: now.toISOString(), // brand-new questions are immediately practiseable
    lastReviewedAt: null,
    history: [],
  };
}

const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
const addMinutes = (d: Date, mins: number) => new Date(d.getTime() + mins * 60 * 1000);
const clampEase = (e: number) => Math.max(MIN_EASE, e);

interface Scheduled {
  sr: SRState;
  intervalDays: number; // 0 means the relearn step (minutes, not days)
}

/** Pure scheduler: given current SR state + a rating, compute the next state. */
export function schedule(prev: SRState, rating: Rating, now = new Date()): SRState {
  const { sr } = computeNext(prev, rating, now);
  return sr;
}

function computeNext(prev: SRState, rating: Rating, now: Date): Scheduled {
  let reps = prev.reps;
  let ease = prev.ease;
  let intervalDays: number;
  let dueAt: Date;

  switch (rating) {
    case 'again':
      reps = 0;
      ease = clampEase(ease - 0.2);
      intervalDays = 0;
      dueAt = addMinutes(now, RELEARN_MINUTES);
      break;
    case 'hard':
      reps += 1;
      ease = clampEase(ease - 0.15);
      intervalDays = reps <= 1 ? 1 : Math.max(1, Math.round(prev.intervalDays * 1.2));
      dueAt = addDays(now, intervalDays);
      break;
    case 'good':
      reps += 1;
      if (reps <= 1) intervalDays = 1;
      else if (reps === 2) intervalDays = 3;
      else intervalDays = Math.max(1, Math.round(prev.intervalDays * ease));
      dueAt = addDays(now, intervalDays);
      break;
    case 'easy':
    default:
      reps += 1;
      ease = ease + 0.15;
      intervalDays = reps <= 1 ? 3 : Math.max(1, Math.round(prev.intervalDays * ease * 1.3));
      dueAt = addDays(now, intervalDays);
      break;
  }

  return {
    intervalDays,
    sr: {
      reps,
      intervalDays,
      ease,
      dueAt: dueAt.toISOString(),
      lastReviewedAt: now.toISOString(),
      history: [...prev.history, intervalDays],
    },
  };
}

/** Human label for an interval, used on the self-rating buttons + detail rail. */
export function formatInterval(days: number): string {
  if (days <= 0) return `< ${RELEARN_MINUTES} min`;
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 mo' : `${months} mo`;
}

/** Preview the interval each rating would produce — shown under the buttons. */
export function previewIntervals(
  prev: SRState,
  now = new Date(),
): Record<Rating, string> {
  const ratings: Rating[] = ['again', 'hard', 'good', 'easy'];
  return ratings.reduce(
    (acc, r) => {
      acc[r] = formatInterval(computeNext(prev, r, now).intervalDays);
      return acc;
    },
    {} as Record<Rating, string>,
  );
}
