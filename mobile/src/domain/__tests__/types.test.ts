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
  it('joins hook, narrative and takeaway into labelled sections', () => {
    expect(storyReference({ hook: 'h', narrative: 'n', takeaway: 't' })).toBe(
      'Hook: h\n\nCore narrative:\nn\n\nTakeaway: t',
    );
  });

  it('omits empty sections', () => {
    expect(storyReference({ hook: 'h', narrative: '', takeaway: '' })).toBe('Hook: h');
  });
});

describe('noteTitle', () => {
  it('uses the question text', () => {
    expect(noteTitle(makeQuestion({ text: 'Why us?' }))).toBe('Why us?');
  });

  it('prefers the story hook, then the first trigger, then a placeholder', () => {
    expect(noteTitle(makeStory({ hook: 'The hook' }))).toBe('The hook');
    expect(
      noteTitle(makeStory({ hook: '', triggers: [makeTrigger({ text: 'trig' })] })),
    ).toBe('trig');
    expect(noteTitle(makeStory({ hook: '', triggers: [] }))).toBe('Untitled story');
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
