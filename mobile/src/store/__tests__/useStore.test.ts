/**
 * Store-level tests: the full local-first flow (auth → seed → mutations)
 * running against the in-memory AsyncStorage mock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStore } from '@/store/useStore';
import { isQuestion, isStory } from '@/domain/types';
import type { Evaluation } from '@/services/ai';

// Hoisted by jest above the imports → forces local-first mode.
jest.mock('@/config/env', () => ({
  env: {
    supabase: { url: '', anonKey: '' },
    openai: { apiKey: '', evalModel: 'gpt-4o-mini', transcribeModel: 'whisper-1' },
    aiProxyUrl: '',
  },
  isSupabaseConfigured: false,
  isAiConfigured: false,
}));

const EVALUATION: Evaluation = {
  score: 7,
  summary: 'Solid',
  strengths: 'clear outcome',
  improvements: 'quantify the win',
  generatedReference: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  useStore.setState({ status: 'loading', user: null, notes: [] });
});

describe('auth lifecycle (local mode)', () => {
  it('bootstrap without a stored user signs out', async () => {
    await useStore.getState().bootstrap();
    expect(useStore.getState().status).toBe('signed-out');
    expect(useStore.getState().notes).toEqual([]);
  });

  it('signIn derives a stable id from the email and seeds the bank', async () => {
    await useStore.getState().signIn('didi@example.com', 'pw');
    const { status, user, notes } = useStore.getState();
    expect(status).toBe('signed-in');
    expect(user?.email).toBe('didi@example.com');
    expect(user?.name).toBe('Didi');
    expect(notes.length).toBeGreaterThan(0);

    // Same email → same local identity → same bank after a "restart".
    const firstId = user!.id;
    useStore.setState({ status: 'loading', user: null, notes: [] });
    await useStore.getState().bootstrap();
    expect(useStore.getState().status).toBe('signed-in');
    expect(useStore.getState().user?.id).toBe(firstId);
  });

  it('signOut clears the session and the next bootstrap stays signed out', async () => {
    await useStore.getState().signIn('didi@example.com', 'pw');
    await useStore.getState().signOut();
    expect(useStore.getState().status).toBe('signed-out');
    await useStore.getState().bootstrap();
    expect(useStore.getState().status).toBe('signed-out');
  });
});

describe('note mutations', () => {
  beforeEach(async () => {
    await useStore.getState().signIn('didi@example.com', 'pw');
  });

  it('addNote(question) trims, defaults to ready, and prepends', async () => {
    const note = await useStore
      .getState()
      .addNote({ kind: 'question', text: '  Why us?  ', reference: '  ref  ' });
    expect(isQuestion(note) && note.text).toBe('Why us?');
    expect(isQuestion(note) && note.reference).toBe('ref');
    expect(note.status).toBe('ready');
    expect(useStore.getState().notes[0].id).toBe(note.id);
  });

  it('addNote(story) trims content and creates one trigger per non-empty prompt', async () => {
    const note = await useStore.getState().addNote({
      kind: 'story',
      status: 'draft',
      title: '  My story  ',
      rawStory: '  what happened  ',
      storytelling: '  polished  ',
      score: 6,
      triggers: ['  first  ', '', '   ', 'second'],
    });
    if (!isStory(note)) throw new Error('expected a story');
    expect(note.status).toBe('draft');
    expect(note.title).toBe('My story');
    expect(note.rawStory).toBe('what happened');
    expect(note.storytelling).toBe('polished');
    expect(note.score).toBe(6);
    expect(note.triggers.map((t) => t.text)).toEqual(['first', 'second']);
    expect(note.triggers.every((t) => t.attempts.length === 0)).toBe(true);
  });

  it('updateNote(story) keeps SR/attempts for kept triggers and drops removed ones', async () => {
    const story = await useStore.getState().addNote({
      kind: 'story',
      rawStory: 'what happened',
      triggers: ['keep me', 'drop me'],
    });
    if (!isStory(story)) throw new Error('expected a story');
    const [keep, drop] = story.triggers;

    // Give the kept trigger history so we can see it survive the edit.
    await useStore.getState().recordAttempt(story.id, keep.id, {
      mode: 'text',
      answerText: 'a',
      evaluation: EVALUATION,
      rating: 'good',
    });

    await useStore.getState().updateNote(story.id, {
      triggers: [{ id: keep.id, text: 'kept, renamed' }, { text: 'brand new' }],
    });

    const updated = useStore.getState().getNote(story.id);
    if (!updated || !isStory(updated)) throw new Error('expected a story');
    expect(updated.triggers).toHaveLength(2);
    const [kept, fresh] = updated.triggers;
    expect(kept.id).toBe(keep.id);
    expect(kept.text).toBe('kept, renamed');
    expect(kept.attempts).toHaveLength(1);
    expect(kept.sr.reps).toBe(1);
    expect(fresh.id).not.toBe(drop.id);
    expect(fresh.attempts).toHaveLength(0);
    expect(updated.triggers.find((t) => t.id === drop.id)).toBeUndefined();
  });

  it('deleteNote removes the note', async () => {
    const note = await useStore.getState().addNote({ kind: 'question', text: 'bye' });
    await useStore.getState().deleteNote(note.id);
    expect(useStore.getState().getNote(note.id)).toBeUndefined();
  });
});

describe('recordAttempt', () => {
  beforeEach(async () => {
    await useStore.getState().signIn('didi@example.com', 'pw');
  });

  it('prepends the attempt and advances the SR state of a question', async () => {
    const note = await useStore.getState().addNote({ kind: 'question', text: 'q' });
    await useStore.getState().recordAttempt(note.id, null, {
      mode: 'text',
      answerText: 'my answer',
      evaluation: EVALUATION,
      rating: 'good',
    });
    const updated = useStore.getState().getNote(note.id);
    if (!updated || !isQuestion(updated)) throw new Error('expected a question');
    expect(updated.attempts).toHaveLength(1);
    expect(updated.attempts[0].rating).toBe('good');
    expect(updated.sr.reps).toBe(1);
    expect(updated.sr.intervalDays).toBe(1);
  });

  it('adopts the generated reference when saveReference is set (Mode B → A)', async () => {
    const note = await useStore.getState().addNote({ kind: 'question', text: 'q' });
    await useStore.getState().recordAttempt(note.id, null, {
      mode: 'text',
      answerText: 'my answer',
      evaluation: { ...EVALUATION, generatedReference: 'the model answer' },
      rating: 'good',
      saveReference: true,
    });
    const updated = useStore.getState().getNote(note.id);
    expect(updated && isQuestion(updated) && updated.reference).toBe('the model answer');
  });

  it('only touches the practised trigger of a story', async () => {
    const story = await useStore.getState().addNote({
      kind: 'story',
      rawStory: 'what happened',
      triggers: ['one', 'two'],
    });
    if (!isStory(story)) throw new Error('expected a story');
    const [first, second] = story.triggers;

    await useStore.getState().recordAttempt(story.id, first.id, {
      mode: 'voice',
      answerText: 'spoken answer',
      transcript: 'spoken answer',
      evaluation: EVALUATION,
      rating: 'easy',
    });

    const updated = useStore.getState().getNote(story.id);
    if (!updated || !isStory(updated)) throw new Error('expected a story');
    const practised = updated.triggers.find((t) => t.id === first.id)!;
    const untouched = updated.triggers.find((t) => t.id === second.id)!;
    expect(practised.attempts).toHaveLength(1);
    expect(practised.attempts[0].triggerId).toBe(first.id);
    expect(practised.sr.reps).toBe(1);
    expect(untouched.attempts).toHaveLength(0);
    expect(untouched.sr.reps).toBe(0);
  });
});
