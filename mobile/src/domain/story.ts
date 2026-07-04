/**
 * Story authoring helpers, shared by the capture and detail editors.
 *
 * A story is written as free text in one box (`rawStory`). New stories open
 * pre-seeded with {@link STORY_TEMPLATE} — guiding questions about *what
 * happened*, not how to tell it. "Analyze with AI" then appends its own
 * follow-up questions to the end of that box (see {@link appendQuestions}),
 * without ever touching the words the user already wrote.
 */

import type { StoryMode } from './types';

/** Seed prompts for a brand-new interview story — facts first, not storytelling. */
export const STORY_TEMPLATE = [
  'What was the situation? (where, when, who was involved)',
  '',
  'What was the obstacle or challenge?',
  '',
  'What did you do about it? (your specific actions)',
  '',
  'What was the result? (numbers, outcome, what changed)',
  '',
].join('\n');

/** Seed prompts for a brand-new personal story — the stuff that makes it fun to tell. */
export const STORY_TEMPLATE_PERSONAL = [
  'What happened? (set the scene — where were you, who was there)',
  '',
  'What was the surprising, funny, or awkward moment?',
  '',
  'How did it feel in the moment?',
  '',
  'How did it end — and why do you like telling this one?',
  '',
].join('\n');

/** The seed template for a story's mode. */
export function templateForMode(mode: StoryMode): string {
  return mode === 'personal' ? STORY_TEMPLATE_PERSONAL : STORY_TEMPLATE;
}

/** True when the raw box is empty or still one of the untouched seed templates. */
export function isSeedTemplate(rawStory: string): boolean {
  const t = rawStory.trim();
  return (
    t === '' ||
    t === STORY_TEMPLATE.trim() ||
    t === STORY_TEMPLATE_PERSONAL.trim()
  );
}

/** Heading that marks the AI-appended question block inside the raw box. */
export const QUESTION_BLOCK_HEADER = 'To strengthen this story, answer:';

/**
 * Strip a previously-appended question block so re-analyzing replaces it rather
 * than stacking a new block underneath the old one.
 */
export function stripQuestions(rawStory: string): string {
  const idx = rawStory.indexOf(QUESTION_BLOCK_HEADER);
  return idx === -1 ? rawStory : rawStory.slice(0, idx).replace(/\s+$/, '');
}

/**
 * Append the AI's follow-up questions to the end of the raw box. Any block from
 * a prior analyze pass is removed first. Returns the box unchanged (minus a
 * stale block) when there are no questions.
 */
export function appendQuestions(rawStory: string, questions: string[]): string {
  const base = stripQuestions(rawStory);
  const clean = questions.map((q) => q.trim()).filter(Boolean);
  if (clean.length === 0) return base;
  const block = [QUESTION_BLOCK_HEADER, ...clean.map((q) => `• ${q}`)].join('\n');
  return base ? `${base}\n\n${block}` : block;
}
