import { matchNote, searchNotes, searchableFields, tokenize } from '@/domain/search';
import { makeQuestion, makeStory, makeTrigger } from '@/test/factories';

describe('tokenize', () => {
  it('lowercases and splits on whitespace, dropping empties', () => {
    expect(tokenize('  AWS   Lambda ')).toEqual(['aws', 'lambda']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('searchableFields', () => {
  it('covers question body: title, company, reference, tags', () => {
    const q = makeQuestion({
      text: 'Tell me about a conflict',
      company: 'Revolut',
      reference: 'I disagreed with a PM about scope.',
      tags: ['leadership', 'conflict'],
    });
    const labels = searchableFields(q).map((f) => f.label);
    expect(labels).toEqual(['Title', 'Company', 'Answer', 'Tags']);
  });

  it('covers story body: title, raw, polished, triggers, hooks, tags', () => {
    const s = makeStory({
      conversationHooks: ['ask about their on-call setup'],
      tags: ['ownership'],
    });
    const labels = searchableFields(s).map((f) => f.label);
    expect(labels).toEqual(['Title', 'Story', 'Polished', 'Trigger', 'Hook', 'Tags']);
  });

  it('omits empty fields', () => {
    const q = makeQuestion({ company: null, reference: null, tags: [] });
    expect(searchableFields(q).map((f) => f.label)).toEqual(['Title']);
  });
});

describe('matchNote — matching', () => {
  it('matches on the title', () => {
    const q = makeQuestion({ text: 'Describe a time you led a project' });
    expect(matchNote(q, 'project').matched).toBe(true);
  });

  it('matches on the company (question)', () => {
    const q = makeQuestion({ text: 'Why us?', company: 'Revolut' });
    expect(matchNote(q, 'revolut').matched).toBe(true);
  });

  it('matches on the reference answer body (question)', () => {
    const q = makeQuestion({ text: 'A challenge', reference: 'We migrated to Kubernetes.' });
    expect(matchNote(q, 'kubernetes').matched).toBe(true);
  });

  it('matches on rawStory, storytelling, and conversationHooks (story)', () => {
    const s = makeStory({
      title: 'Demo laptop',
      rawStory: 'Lost the bag at the airport gate.',
      storytelling: 'The airline misplaced my demo hardware.',
      conversationHooks: ['pivot to their incident response process'],
    });
    expect(matchNote(s, 'airport').matched).toBe(true);
    expect(matchNote(s, 'airline').matched).toBe(true);
    expect(matchNote(s, 'incident').matched).toBe(true);
  });

  it('matches on tags', () => {
    const q = makeQuestion({ text: 'Untagged prompt', tags: ['negotiation'] });
    expect(matchNote(q, 'negotiation').matched).toBe(true);
  });

  it('requires every term to match (AND), across different fields', () => {
    const q = makeQuestion({ text: 'Handling conflict', company: 'Revolut' });
    expect(matchNote(q, 'conflict revolut').matched).toBe(true);
    expect(matchNote(q, 'conflict google').matched).toBe(false);
  });

  it('does not match unrelated text', () => {
    const q = makeQuestion({ text: 'Tell me about yourself', reference: null });
    expect(matchNote(q, 'kubernetes').matched).toBe(false);
  });

  it('matches everything on an empty/whitespace query', () => {
    const q = makeQuestion();
    expect(matchNote(q, '').matched).toBe(true);
    expect(matchNote(q, '   ').matched).toBe(true);
  });
});

describe('matchNote — fuzzy tolerance', () => {
  it('tolerates a typo in a longer term', () => {
    const q = makeQuestion({ text: 'Working with Kubernetes clusters' });
    expect(matchNote(q, 'kubernetos').matched).toBe(true); // e→o
    expect(matchNote(q, 'leadrship').matched).toBe(false); // not present at all
  });

  it('tolerates one edit in a 4–6 char term', () => {
    const q = makeQuestion({ text: 'Deploying a lambda function' });
    expect(matchNote(q, 'lambde').matched).toBe(true);
  });

  it('does not fuzzy-match very short terms (≤3 chars)', () => {
    const q = makeQuestion({ text: 'Working with cats' });
    // "car" is edit-distance 1 from "cat" but too short to fuzzy-match.
    expect(matchNote(q, 'car').matched).toBe(false);
    expect(matchNote(q, 'cat').matched).toBe(true);
  });
});

describe('matchNote — highlight info', () => {
  it('reports title spans covering the matched term', () => {
    const q = makeQuestion({ text: 'Describe a conflict' });
    const { titleSpans } = matchNote(q, 'conflict');
    expect(titleSpans).toHaveLength(1);
    const [span] = titleSpans;
    expect('Describe a conflict'.slice(span.start, span.end).toLowerCase()).toBe('conflict');
  });

  it('leaves title spans empty when only the body matched', () => {
    const q = makeQuestion({ text: 'A challenge', reference: 'We used Kubernetes.' });
    const m = matchNote(q, 'kubernetes');
    expect(m.titleSpans).toEqual([]);
    expect(m.hit).not.toBeNull();
    expect(m.hit?.field).toBe('Answer');
  });

  it('builds a snippet whose spans mark the matched term', () => {
    const q = makeQuestion({
      text: 'A challenge',
      reference:
        'Early in the project we had to migrate the whole platform to Kubernetes without downtime.',
    });
    const { hit } = matchNote(q, 'kubernetes');
    expect(hit).not.toBeNull();
    const { snippet, spans } = hit!;
    expect(spans).toHaveLength(1);
    expect(snippet.slice(spans[0].start, spans[0].end).toLowerCase()).toBe('kubernetes');
  });

  it('ellipsizes a long field around the match', () => {
    const long = 'x'.repeat(200) + ' kubernetes ' + 'y'.repeat(200);
    const q = makeQuestion({ text: 'A challenge', reference: long });
    const { hit } = matchNote(q, 'kubernetes');
    expect(hit!.snippet.startsWith('…')).toBe(true);
    expect(hit!.snippet.endsWith('…')).toBe(true);
    expect(hit!.snippet.length).toBeLessThan(long.length);
  });

  it('no hit when the match is title-only', () => {
    const q = makeQuestion({ text: 'Kubernetes migration', reference: null });
    const m = matchNote(q, 'kubernetes');
    expect(m.titleSpans).toHaveLength(1);
    expect(m.hit).toBeNull();
  });
});

describe('searchNotes', () => {
  it('filters while preserving original order', () => {
    const a = makeQuestion({ text: 'Alpha kubernetes' });
    const b = makeQuestion({ text: 'Beta only' });
    const c = makeStory({ title: 'Gamma', rawStory: 'ran on kubernetes' });
    const result = searchNotes([a, b, c], 'kubernetes');
    expect(result.map((n) => n.id)).toEqual([a.id, c.id]);
  });

  it('returns all notes for an empty query', () => {
    const notes = [makeQuestion(), makeStory(), makeQuestion()];
    expect(searchNotes(notes, '')).toHaveLength(3);
  });

  it('matches across a story trigger', () => {
    const s = makeStory({
      title: 'Untitled',
      rawStory: 'nothing here',
      storytelling: 'nothing here',
      triggers: [makeTrigger({ text: 'a time you disagreed with your manager' })],
    });
    expect(searchNotes([s], 'disagreed')).toHaveLength(1);
  });
});
