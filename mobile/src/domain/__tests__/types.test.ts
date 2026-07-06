import {
  isDue,
  lastScore,
  noteAttempts,
  noteReviewStatus,
  noteTitle,
  practiceMode,
  reviewStatus,
  storyReference,
} from '@/domain/types';
import {
  makeAttempt,
  makeQuestion,
  makeSR,
  makeStory,
  makeTrigger,
} from '@/test/factories';

const NOW = new Date('2026-07-01T12:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe('storyReference', () => {
  it('uses the polished storytelling version', () => {
    expect(storyReference({ storytelling: 'polished', rawStory: 'raw notes' })).toBe('polished');
  });

  it('falls back to the raw story when not yet analyzed', () => {
    expect(storyReference({ storytelling: '   ', rawStory: 'raw notes' })).toBe('raw notes');
  });
});

describe('noteTitle', () => {
  it('uses the question text', () => {
    expect(noteTitle(makeQuestion({ text: 'Why us?' }))).toBe('Why us?');
  });

  it('prefers the story title, then the first trigger, then a placeholder', () => {
    expect(noteTitle(makeStory({ title: 'The title' }))).toBe('The title');
    expect(
      noteTitle(makeStory({ title: '', triggers: [makeTrigger({ text: 'trig' })] })),
    ).toBe('trig');
    expect(noteTitle(makeStory({ title: '', triggers: [] }))).toBe('Untitled story');
  });
});

describe('noteAttempts', () => {
  it('pools story attempts across triggers, most recent first', () => {
    const old = makeAttempt({ createdAt: '2026-01-01T00:00:00.000Z' });
    const mid = makeAttempt({ createdAt: '2026-03-01T00:00:00.000Z' });
    const recent = makeAttempt({ createdAt: '2026-06-01T00:00:00.000Z' });
    const story = makeStory({
      triggers: [
        makeTrigger({ attempts: [mid, old] }),
        makeTrigger({ attempts: [recent] }),
      ],
    });
    expect(noteAttempts(story).map((a) => a.id)).toEqual([recent.id, mid.id, old.id]);
  });

  it('uses the story-level log for a personal story, ignoring trigger attempts', () => {
    const older = makeAttempt({ createdAt: '2026-02-01T00:00:00.000Z' });
    const newer = makeAttempt({ createdAt: '2026-05-01T00:00:00.000Z' });
    const story = makeStory({
      mode: 'personal',
      attempts: [newer, older],
      triggers: [makeTrigger({ attempts: [makeAttempt()] })],
    });
    expect(noteAttempts(story).map((a) => a.id)).toEqual([newer.id, older.id]);
  });
});

describe('practiceMode', () => {
  it('is A only when a non-blank reference exists', () => {
    expect(practiceMode({ reference: 'a model answer' })).toBe('A');
    expect(practiceMode({ reference: null })).toBe('B');
    expect(practiceMode({ reference: '   ' })).toBe('B');
  });
});

describe('reviewStatus', () => {
  it('classifies new / due / learning / scheduled', () => {
    const newQ = { sr: makeSR(), attempts: [] };
    expect(reviewStatus(newQ, NOW)).toBe('new');

    const due = {
      sr: makeSR({ reps: 2, dueAt: new Date(NOW.getTime() - DAY).toISOString() }),
      attempts: [makeAttempt()],
    };
    expect(reviewStatus(due, NOW)).toBe('due');

    const learning = {
      sr: makeSR({
        reps: 1,
        intervalDays: 1,
        dueAt: new Date(NOW.getTime() + DAY).toISOString(),
      }),
      attempts: [makeAttempt()],
    };
    expect(reviewStatus(learning, NOW)).toBe('learning');

    const scheduled = {
      sr: makeSR({
        reps: 4,
        intervalDays: 8,
        dueAt: new Date(NOW.getTime() + 8 * DAY).toISOString(),
      }),
      attempts: [makeAttempt()],
    };
    expect(reviewStatus(scheduled, NOW)).toBe('scheduled');
  });

  it('a lapsed item (reps reset by "again") is not "new" once attempted', () => {
    const lapsed = {
      sr: makeSR({
        reps: 0,
        intervalDays: 0,
        dueAt: new Date(NOW.getTime() + 10 * MINUTE).toISOString(),
      }),
      attempts: [makeAttempt({ rating: 'again' })],
    };
    expect(reviewStatus(lapsed, NOW)).toBe('learning');
  });
});

describe('noteReviewStatus', () => {
  const futureSR = (intervalDays: number) =>
    makeSR({
      reps: 1,
      intervalDays,
      dueAt: new Date(NOW.getTime() + intervalDays * DAY).toISOString(),
    });

  it('any due trigger makes the whole story due', () => {
    const story = makeStory({
      triggers: [
        makeTrigger({ sr: futureSR(8) }),
        makeTrigger({
          sr: makeSR({ reps: 1, dueAt: new Date(NOW.getTime() - DAY).toISOString() }),
        }),
      ],
    });
    expect(noteReviewStatus(story, NOW)).toBe('due');
  });

  it('all-new triggers → new; learning beats scheduled; empty story is new', () => {
    expect(noteReviewStatus(makeStory({ triggers: [makeTrigger()] }), NOW)).toBe('new');
    expect(
      noteReviewStatus(
        makeStory({
          triggers: [makeTrigger({ sr: futureSR(1) }), makeTrigger({ sr: futureSR(8) })],
        }),
        NOW,
      ),
    ).toBe('learning');
    expect(
      noteReviewStatus(
        makeStory({ triggers: [makeTrigger(), makeTrigger({ sr: futureSR(8) })] }),
        NOW,
      ),
    ).toBe('scheduled');
    expect(noteReviewStatus(makeStory({ triggers: [] }), NOW)).toBe('new');
  });

  it('a personal story maps its own schedule, ignoring trigger SR', () => {
    const story = makeStory({
      mode: 'personal',
      sr: makeSR({ reps: 2, dueAt: new Date(NOW.getTime() - DAY).toISOString() }),
      attempts: [makeAttempt()],
      triggers: [makeTrigger()], // brand-new trigger would read "new" under interview logic
    });
    expect(noteReviewStatus(story, NOW)).toBe('due');
  });
});

describe('isDue / lastScore', () => {
  it('isDue is inclusive of the exact due instant', () => {
    expect(isDue({ sr: makeSR({ dueAt: NOW.toISOString() }) }, NOW)).toBe(true);
    expect(
      isDue({ sr: makeSR({ dueAt: new Date(NOW.getTime() + 1).toISOString() }) }, NOW),
    ).toBe(false);
  });

  it('lastScore reads the most recent attempt or null', () => {
    expect(lastScore(makeQuestion())).toBeNull();
    const q = makeQuestion({
      attempts: [makeAttempt({ aiScore: 9 }), makeAttempt({ aiScore: 3 })],
    });
    expect(lastScore(q)).toBe(9);
  });
});
