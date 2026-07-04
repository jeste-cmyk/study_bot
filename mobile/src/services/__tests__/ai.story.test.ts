/**
 * analyzeStory in local-first mode (no AI key): it must always return a usable
 * title, storytelling scaffold, score, triggers and follow-up questions so the
 * Analyze flow is exercisable offline.
 */
import { analyzeStory } from '@/services/ai';

// Hoisted by jest above the imports → forces the local fallback.
jest.mock('@/config/env', () => ({
  env: {
    supabase: { url: '', anonKey: '' },
    openai: { apiKey: '', evalModel: 'gpt-4o-mini', transcribeModel: 'whisper-1' },
    aiProxyUrl: '',
  },
  isSupabaseConfigured: false,
  isAiConfigured: false,
}));

describe('analyzeStory (local fallback)', () => {
  it('drafts a title, storytelling and triggers from the raw story', async () => {
    const a = await analyzeStory({
      rawStory:
        'The airline lost my demo laptop an hour before the talk. I rebuilt the ' +
        'environment from a backup in 40 minutes and led with the live numbers.',
    });
    expect(a.title.length).toBeGreaterThan(0);
    expect(a.storytelling).toContain('airline lost');
    expect(a.triggers.length).toBeGreaterThan(0);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(10);
  });

  it('rewards a story that already has a metric with a higher score', async () => {
    const withNumber = await analyzeStory({ rawStory: 'We cut latency by 40% across the fleet after a long push of work.' });
    const withoutNumber = await analyzeStory({ rawStory: 'We made the system faster after a long push of work here.' });
    expect(withNumber.score).toBeGreaterThan(withoutNumber.score);
    // Missing a metric → the AI asks for one.
    expect(withoutNumber.questions.join(' ')).toMatch(/result|number|%/i);
  });

  it('ignores guiding prompt lines the user wrote against', async () => {
    const a = await analyzeStory({ rawStory: 'What was the situation?\nI led a stalled migration to done.' });
    expect(a.storytelling).not.toContain('What was the situation?');
  });

  it('interview mode returns no conversation hooks', async () => {
    const a = await analyzeStory({ rawStory: 'I shipped a big project on time.', mode: 'interview' });
    expect(a.conversationHooks).toEqual([]);
  });

  it('personal mode returns conversation directions to keep the chat going', async () => {
    const a = await analyzeStory({
      rawStory: 'I fell asleep on a bus in Peru and woke up hours past my stop.',
      mode: 'personal',
    });
    expect(a.conversationHooks.length).toBeGreaterThan(0);
    expect(a.triggers.length).toBeGreaterThan(0);
    // Personal follow-ups chase vividness, not metrics.
    expect(a.questions.join(' ')).not.toMatch(/metric|%/i);
  });
});
