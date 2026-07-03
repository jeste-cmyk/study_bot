import {
  formatInterval,
  initialSR,
  previewIntervals,
  schedule,
} from '@/domain/spacedRepetition';
import type { SRState } from '@/domain/types';

const NOW = new Date('2026-07-01T12:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const dueAtMs = (sr: SRState) => new Date(sr.dueAt).getTime();

describe('initialSR', () => {
  it('starts immediately due with default ease and no history', () => {
    const sr = initialSR(NOW);
    expect(sr.reps).toBe(0);
    expect(sr.intervalDays).toBe(0);
    expect(sr.ease).toBe(2.5);
    expect(sr.dueAt).toBe(NOW.toISOString());
    expect(sr.lastReviewedAt).toBeNull();
    expect(sr.history).toEqual([]);
  });
});

describe('schedule', () => {
  it('"good" walks the 1 → 3 → interval×ease ladder', () => {
    let sr = initialSR(NOW);

    sr = schedule(sr, 'good', NOW);
    expect(sr.reps).toBe(1);
    expect(sr.intervalDays).toBe(1);
    expect(dueAtMs(sr)).toBe(NOW.getTime() + 1 * DAY);

    sr = schedule(sr, 'good', NOW);
    expect(sr.reps).toBe(2);
    expect(sr.intervalDays).toBe(3);

    sr = schedule(sr, 'good', NOW);
    expect(sr.reps).toBe(3);
    // round(3 × 2.5) = 8; "good" never changes ease
    expect(sr.intervalDays).toBe(8);
    expect(sr.ease).toBe(2.5);
    expect(sr.history).toEqual([1, 3, 8]);
  });

  it('"again" resets reps, drops ease and reschedules in ~10 minutes', () => {
    const prev = { ...initialSR(NOW), reps: 5, intervalDays: 12, history: [1, 3, 12] };
    const sr = schedule(prev, 'again', NOW);
    expect(sr.reps).toBe(0);
    expect(sr.intervalDays).toBe(0);
    expect(sr.ease).toBeCloseTo(2.3);
    expect(dueAtMs(sr)).toBe(NOW.getTime() + 10 * MINUTE);
    expect(sr.history).toEqual([1, 3, 12, 0]);
  });

  it('ease never drops below the 1.3 floor', () => {
    let sr = initialSR(NOW);
    for (let i = 0; i < 10; i++) sr = schedule(sr, 'again', NOW);
    expect(sr.ease).toBe(1.3);
  });

  it('"hard" uses a 1-day first step then grows the interval by 1.2×', () => {
    const first = schedule(initialSR(NOW), 'hard', NOW);
    expect(first.reps).toBe(1);
    expect(first.intervalDays).toBe(1);
    expect(first.ease).toBeCloseTo(2.35);

    const prev = { ...initialSR(NOW), reps: 2, intervalDays: 10 };
    const later = schedule(prev, 'hard', NOW);
    expect(later.intervalDays).toBe(12); // round(10 × 1.2)
  });

  it('"easy" boosts ease and applies the 1.3× bonus with the boosted ease', () => {
    const first = schedule(initialSR(NOW), 'easy', NOW);
    expect(first.intervalDays).toBe(3);
    expect(first.ease).toBeCloseTo(2.65);

    const later = schedule(first, 'easy', NOW);
    // ease boosts to 2.8 first, then round(3 × 2.8 × 1.3) = 11
    expect(later.ease).toBeCloseTo(2.8);
    expect(later.intervalDays).toBe(11);
  });

  it('stamps lastReviewedAt and never mutates the previous state', () => {
    const prev = initialSR(NOW);
    const frozen = JSON.parse(JSON.stringify(prev));
    const sr = schedule(prev, 'good', NOW);
    expect(sr.lastReviewedAt).toBe(NOW.toISOString());
    expect(prev).toEqual(frozen);
  });
});

describe('formatInterval', () => {
  it.each([
    [0, '< 10 min'],
    [1, '1 day'],
    [29, '29 days'],
    [30, '1 mo'],
    [60, '2 mo'],
  ])('formats %i days as "%s"', (days, label) => {
    expect(formatInterval(days)).toBe(label);
  });
});

describe('previewIntervals', () => {
  it('previews all four ratings for a brand-new item without mutating it', () => {
    const prev = initialSR(NOW);
    const frozen = JSON.parse(JSON.stringify(prev));
    expect(previewIntervals(prev, NOW)).toEqual({
      again: '< 10 min',
      hard: '1 day',
      good: '1 day',
      easy: '3 days',
    });
    expect(prev).toEqual(frozen);
  });
});
