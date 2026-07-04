/**
 * LocalRepository behavior: seeding, persistence round-trips, and the
 * normalisation path that keeps pre-story/pre-draft records loadable.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { repository } from '@/services/repository';
import { isQuestion, isStory } from '@/domain/types';
import { makeQuestion } from '@/test/factories';

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

const USER = 'u-test';
const KEY = `recall:questions:${USER}`;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('seeding', () => {
  it('seeds a realistic bank on first load and persists it', async () => {
    const first = await repository.load(USER);
    const stories = first.filter(isStory);
    expect(stories).toHaveLength(2);
    expect(stories.map((s) => s.mode).sort()).toEqual(['interview', 'personal']);
    expect(first.filter(isQuestion)).toHaveLength(8);
    expect(first.every((n) => n.userId === USER)).toBe(true);

    const second = await repository.load(USER);
    expect(second.map((n) => n.id)).toEqual(first.map((n) => n.id));
  });
});

describe('legacy record normalisation', () => {
  it('upgrades pre-story/pre-draft records on load', async () => {
    const legacyQuestion = {
      // no `kind`, no `status`, attempt without `triggerId` — the original schema
      id: 'q-legacy',
      userId: USER,
      text: 'Old question?',
      reference: null,
      category: null,
      company: null,
      difficulty: null,
      tags: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      sr: {
        reps: 1,
        intervalDays: 1,
        ease: 2.5,
        dueAt: '2025-01-02T00:00:00.000Z',
        lastReviewedAt: '2025-01-01T00:00:00.000Z',
        history: [1],
      },
      attempts: [{ id: 'att-legacy', questionId: 'q-legacy', rating: 'good' }],
    };
    const legacyStory = {
      id: 's-legacy',
      userId: USER,
      kind: 'story',
      hook: 'h',
      narrative: 'n',
      takeaway: 't',
      triggers: [
        {
          id: 'tr-legacy',
          text: 'trigger',
          sr: legacyQuestion.sr,
          attempts: [{ id: 'att-s', questionId: 's-legacy' }],
        },
      ],
      category: null,
      difficulty: null,
      tags: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    await AsyncStorage.setItem(KEY, JSON.stringify([legacyQuestion, legacyStory]));

    const notes = await repository.load(USER);
    const q = notes.find((n) => n.id === 'q-legacy');
    const s = notes.find((n) => n.id === 's-legacy');

    expect(q && isQuestion(q)).toBe(true);
    if (!q || !isQuestion(q)) return;
    expect(q.status).toBe('ready');
    expect(q.attempts[0].triggerId).toBeNull();

    expect(s && isStory(s)).toBe(true);
    if (!s || !isStory(s)) return;
    expect(s.status).toBe('ready');
    expect(s.triggers[0].attempts[0].triggerId).toBe('tr-legacy');
    // Legacy hook/narrative/takeaway migrate into the free-text fields.
    expect(s.title).toBe('h');
    expect(s.rawStory).toBe('h\n\nn\n\nt');
    expect(s.storytelling).toContain('Takeaway: t');
    expect(s.score).toBeNull();
    // Records with no mode default to interview with no conversation hooks.
    expect(s.mode).toBe('interview');
    expect(s.conversationHooks).toEqual([]);
    // The obsolete fields are dropped.
    expect((s as unknown as { hook?: string }).hook).toBeUndefined();
  });
});

describe('CRUD round-trip', () => {
  it('createNote / updateNote / deleteNote persist across loads', async () => {
    const seeded = await repository.load(USER);

    const note = makeQuestion({ userId: USER, text: 'Brand new question?' });
    await repository.createNote(note);
    let notes = await repository.load(USER);
    expect(notes).toHaveLength(seeded.length + 1);
    expect(notes[0].id).toBe(note.id); // prepended

    await repository.updateNote({ ...note, text: 'Edited question?' });
    notes = await repository.load(USER);
    const updated = notes.find((n) => n.id === note.id);
    expect(updated && isQuestion(updated) && updated.text).toBe('Edited question?');

    await repository.deleteNote(USER, note.id);
    notes = await repository.load(USER);
    expect(notes.find((n) => n.id === note.id)).toBeUndefined();
    expect(notes).toHaveLength(seeded.length);
  });

  it('keeps each user\'s bank isolated', async () => {
    await repository.load(USER);
    const other = await repository.load('u-other');
    const note = makeQuestion({ userId: USER });
    await repository.createNote(note);
    expect(await repository.load('u-other')).toHaveLength(other.length);
  });
});
