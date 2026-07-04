import {
  QUESTION_BLOCK_HEADER,
  STORY_TEMPLATE,
  STORY_TEMPLATE_PERSONAL,
  appendQuestions,
  isSeedTemplate,
  stripQuestions,
  templateForMode,
} from '@/domain/story';

describe('STORY_TEMPLATE', () => {
  it('asks about what happened, not how to tell it', () => {
    expect(STORY_TEMPLATE).toContain('What was the situation?');
    expect(STORY_TEMPLATE).toContain('What was the result?');
  });
});

describe('templateForMode / isSeedTemplate', () => {
  it('picks the interview or personal seed by mode', () => {
    expect(templateForMode('interview')).toBe(STORY_TEMPLATE);
    expect(templateForMode('personal')).toBe(STORY_TEMPLATE_PERSONAL);
  });

  it('recognises an untouched box (empty or either template) as a seed', () => {
    expect(isSeedTemplate('')).toBe(true);
    expect(isSeedTemplate('   ')).toBe(true);
    expect(isSeedTemplate(STORY_TEMPLATE)).toBe(true);
    expect(isSeedTemplate(STORY_TEMPLATE_PERSONAL)).toBe(true);
    expect(isSeedTemplate('Something I actually wrote.')).toBe(false);
  });
});

describe('appendQuestions', () => {
  it('appends a labelled block to the end of the raw story', () => {
    const out = appendQuestions('I shipped the thing.', ['How big was the team?', 'What metric moved?']);
    expect(out).toBe(
      `I shipped the thing.\n\n${QUESTION_BLOCK_HEADER}\n• How big was the team?\n• What metric moved?`,
    );
  });

  it('replaces a prior question block instead of stacking on re-analyze', () => {
    const first = appendQuestions('My story.', ['Q1?']);
    const second = appendQuestions(first, ['Q2?', 'Q3?']);
    expect(second).toBe(`My story.\n\n${QUESTION_BLOCK_HEADER}\n• Q2?\n• Q3?`);
    // Only one header survives — the old block was stripped first.
    expect(second.match(new RegExp(QUESTION_BLOCK_HEADER, 'g'))).toHaveLength(1);
  });

  it('drops a stale block and adds nothing when there are no questions', () => {
    const withBlock = appendQuestions('My story.', ['Q1?']);
    expect(appendQuestions(withBlock, [])).toBe('My story.');
    expect(stripQuestions(withBlock)).toBe('My story.');
  });

  it('preserves the user’s own text verbatim', () => {
    const raw = 'Line one.\nLine two with detail.';
    expect(appendQuestions(raw, ['Anything else?'])).toContain(raw);
  });
});
