/**
 * Tiny factories for domain objects so tests build realistic notes without
 * repeating 15-field literals. Every field can be overridden per test.
 */
import type {
  Attempt,
  Question,
  SRState,
  Story,
  StoryTrigger,
} from '@/domain/types';
import { initialSR } from '@/domain/spacedRepetition';

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

export const T0 = new Date('2026-01-01T00:00:00.000Z');

export function makeSR(overrides: Partial<SRState> = {}): SRState {
  return { ...initialSR(T0), ...overrides };
}

export function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: nextId('att-'),
    questionId: 'q-1',
    triggerId: null,
    mode: 'text',
    answerText: 'an answer',
    transcript: null,
    audioUri: null,
    aiScore: 7,
    aiSummary: 'Solid',
    strengths: 'clear outcome',
    improvements: 'quantify the win',
    generatedReference: null,
    rating: 'good',
    createdAt: T0.toISOString(),
    ...overrides,
  };
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: nextId('q-'),
    userId: 'u1',
    kind: 'question',
    status: 'ready',
    text: 'Tell me about a challenge.',
    reference: null,
    category: null,
    company: null,
    difficulty: null,
    tags: [],
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    sr: makeSR(),
    attempts: [],
    ...overrides,
  };
}

export function makeTrigger(overrides: Partial<StoryTrigger> = {}): StoryTrigger {
  return {
    id: nextId('tr-'),
    text: 'a trigger prompt',
    sr: makeSR(),
    attempts: [],
    ...overrides,
  };
}

export function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: nextId('s-'),
    userId: 'u1',
    kind: 'story',
    status: 'ready',
    hook: 'The demo laptop vanished an hour before the talk.',
    narrative: '• lost bag\n• rebuilt env\n• led with numbers',
    takeaway: 'Preparation is a system.',
    triggers: [makeTrigger()],
    category: null,
    difficulty: null,
    tags: [],
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    ...overrides,
  };
}
