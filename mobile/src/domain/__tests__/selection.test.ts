import { buildQueue, dueCount, toPracticeItems } from '@/domain/selection';
import {
  makeAttempt,
  makeQuestion,
  makeSR,
  makeStory,
  makeTrigger,
} from '@/test/factories';

const NOW = new Date('2026-07-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

describe('toPracticeItems', () => {
  it('skips drafts of both kinds', () => {
    const notes = [
      makeQuestion({ status: 'draft' }),
      makeStory({ status: 'draft' }),
      makeQuestion(),
    ];
    expect(toPracticeItems(notes)).toHaveLength(1);
  });

  it('expands a story into one item per trigger sharing the combined reference', () => {
    const story = makeStory({ triggers: [makeTrigger(), makeTrigger()] });
    const items = toPracticeItems([story]);
    expect(items).toHaveLength(2);
    for (const [i, item] of items.entries()) {
      expect(item.key).toBe(`${story.id}:${story.triggers[i].id}`);
      expect(item.noteId).toBe(story.id);
      expect(item.triggerId).toBe(story.triggers[i].id);
      expect(item.kind).toBe('story');
      expect(item.prompt).toBe(story.triggers[i].text);
      expect(item.reference).toContain(`Hook: ${story.hook}`);
      expect(item.reference).toContain(story.narrative);
      expect(item.reference).toContain(`Takeaway: ${story.takeaway}`);
      expect(item.company).toBeNull();
    }
  });

  it('maps a question to a single item keyed by the note id', () => {
    const q = makeQuestion({ reference: 'ref', company: 'Revolut' });
    const [item] = toPracticeItems([q]);
    expect(item.key).toBe(q.id);
    expect(item.triggerId).toBeNull();
    expect(item.prompt).toBe(q.text);
    expect(item.reference).toBe('ref');
    expect(item.company).toBe('Revolut');
  });
});

describe('buildQueue', () => {
  const practisedDue = (dueInDays: number) =>
    makeQuestion({
      sr: makeSR({ reps: 2, dueAt: daysFromNow(dueInDays) }),
      attempts: [makeAttempt()],
    });

  it('returns only due items, oldest due first', () => {
    const oldest = practisedDue(-5);
    const newer = practisedDue(-1);
    const notDue = practisedDue(3);
    const queue = buildQueue([newer, notDue, oldest], undefined, NOW);
    expect(queue.map((it) => it.noteId)).toEqual([oldest.id, newer.id]);
  });

  it('treats never-practised overdue items as new, not due', () => {
    const neverPractised = makeQuestion({ sr: makeSR({ dueAt: daysFromNow(-10) }) });
    const scheduled = practisedDue(5);
    const queue = buildQueue([neverPractised, scheduled], undefined, NOW);
    // nothing is due-for-review → falls back to the fresh item
    expect(queue.map((it) => it.noteId)).toEqual([neverPractised.id]);
  });

  it('falls back to the whole pool when everything was practised and nothing is due', () => {
    const a = practisedDue(2);
    const b = practisedDue(1);
    const queue = buildQueue([a, b], undefined, NOW);
    expect(queue.map((it) => it.noteId)).toEqual([b.id, a.id]);
  });

  it('filters by category, dropping uncategorised items', () => {
    const behavioral = makeQuestion({ category: 'Behavioral' });
    const uncategorised = makeQuestion({ category: null });
    const technical = makeQuestion({ category: 'Technical' });
    const queue = buildQueue(
      [behavioral, uncategorised, technical],
      { categories: ['Behavioral'] },
      NOW,
    );
    expect(queue.map((it) => it.noteId)).toEqual([behavioral.id]);
  });

  it('filters by company, which excludes story items (stories have no company)', () => {
    const revolut = makeQuestion({ company: 'Revolut' });
    const rappi = makeQuestion({ company: 'Rappi' });
    const story = makeStory();
    const queue = buildQueue([revolut, rappi, story], { company: 'Revolut' }, NOW);
    expect(queue.map((it) => it.noteId)).toEqual([revolut.id]);
  });

  it('an empty categories array means "all categories"', () => {
    const q = makeQuestion({ category: null });
    expect(buildQueue([q], { categories: [] }, NOW)).toHaveLength(1);
  });
});

describe('dueCount', () => {
  it('counts due story triggers individually and ignores unpractised ones', () => {
    const dueTrigger = () =>
      makeTrigger({
        sr: makeSR({ reps: 1, dueAt: daysFromNow(-1) }),
        attempts: [makeAttempt()],
      });
    const story = makeStory({
      triggers: [dueTrigger(), dueTrigger(), makeTrigger()], // third is new
    });
    const dueQuestion = makeQuestion({
      sr: makeSR({ reps: 1, dueAt: daysFromNow(-2) }),
      attempts: [makeAttempt()],
    });
    expect(dueCount([story, dueQuestion], NOW)).toBe(3);
  });
});
