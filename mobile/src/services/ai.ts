/**
 * AI service — transcription (Whisper) + answer evaluation (GPT).
 *
 * Per the PRD (§6.2) this is a single decoupled module so the provider can be
 * swapped without touching the rest of the app. Resolution order:
 *   1. `EXPO_PUBLIC_AI_PROXY_URL` set  → POST to your backend (recommended).
 *   2. `EXPO_PUBLIC_OPENAI_API_KEY` set → call OpenAI directly from the device.
 *   3. Neither                         → deterministic local fallback so the
 *                                        practice loop still runs for review.
 *
 * Mode A (reference exists): grade the answer against the user's saved answer.
 * Mode B (no reference):     draft a model answer AND grade against it.
 */
import { env, isAiConfigured } from '@/config/env';

export interface EvaluationInput {
  question: string;
  reference: string | null; // present ⇒ Mode A
  answer: string;
  category?: string | null;
  company?: string | null;
}

export interface Evaluation {
  score: number; // 1–10
  summary: string; // short headline
  strengths: string;
  improvements: string;
  generatedReference: string | null; // Mode B only
}

export const aiEnabled = isAiConfigured;

// ---------------------------------------------------------------------------
// Note review ("Improve with AI")
// ---------------------------------------------------------------------------

/** The draft being reviewed while a user is creating a note. */
export interface NoteReviewInput {
  kind: 'question' | 'story';
  // Question fields
  question?: string;
  reference?: string | null;
  // Story fields
  hook?: string;
  narrative?: string;
  takeaway?: string;
  triggers?: string[];
  // Shared metadata
  category?: string | null;
  company?: string | null;
}

export interface NoteReview {
  score: number; // 0–10
  verdict: string; // short headline, shown regardless of score
  /** What the note is missing — populated when the score is below 7. */
  missing: string[];
  /** Clarifying questions whose answers would let the note improve. */
  questions: string[];
  /** A rewritten, stronger version of the note's main answer/content. */
  improved: string | null;
}

/** A note scoring at or above this is considered strong enough to keep as-is. */
export const NOTE_REVIEW_PASS = 7;

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export async function transcribeAudio(uri: string): Promise<string> {
  if (env.aiProxyUrl) {
    const form = new FormData();
    // React Native FormData accepts a { uri, name, type } file part.
    form.append('file', { uri, name: 'answer.m4a', type: 'audio/m4a' } as any);
    const res = await fetch(`${env.aiProxyUrl.replace(/\/$/, '')}/transcribe`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error(`Transcription proxy failed (${res.status})`);
    const data = await res.json();
    return (data.text ?? '').trim();
  }

  if (env.openai.apiKey) {
    const form = new FormData();
    form.append('file', { uri, name: 'answer.m4a', type: 'audio/m4a' } as any);
    form.append('model', env.openai.transcribeModel);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openai.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Whisper failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    return (data.text ?? '').trim();
  }

  // Local fallback — we can't transcribe offline, so return a clearly-marked
  // placeholder that keeps the practice loop usable during design review.
  return localTranscriptStub();
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export async function evaluateAnswer(input: EvaluationInput): Promise<Evaluation> {
  const mode = input.reference ? 'A' : 'B';

  if (env.aiProxyUrl) {
    const res = await fetch(`${env.aiProxyUrl.replace(/\/$/, '')}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, mode }),
    });
    if (!res.ok) throw new Error(`Evaluation proxy failed (${res.status})`);
    return normalizeEvaluation(await res.json(), mode);
  }

  if (env.openai.apiKey) {
    return evaluateWithOpenAI(input, mode);
  }

  return localEvaluation(input, mode);
}

async function evaluateWithOpenAI(
  input: EvaluationInput,
  mode: 'A' | 'B',
): Promise<Evaluation> {
  const sys =
    'You are an exacting interview coach. Grade the candidate answer on a 1-10 ' +
    'scale and give terse, specific, actionable feedback. Respond ONLY with JSON ' +
    'matching the requested schema. Be concrete; reference what the candidate ' +
    'actually said.';

  const schema =
    mode === 'A'
      ? '{ "score": number 1-10, "summary": short headline, "strengths": 1-2 sentences, "improvements": 1-2 sentences }'
      : '{ "score": number 1-10, "summary": short headline, "strengths": 1-2 sentences, "improvements": 1-2 sentences, "generatedReference": a strong structured model answer (3-5 sentences) }';

  const user = [
    `QUESTION: ${input.question}`,
    input.category ? `CATEGORY: ${input.category}` : '',
    input.company ? `COMPANY: ${input.company}` : '',
    mode === 'A'
      ? `REFERENCE ANSWER (the candidate's own saved ideal):\n${input.reference}`
      : 'No reference answer exists yet — draft an ideal one as `generatedReference`.',
    `CANDIDATE ANSWER:\n${input.answer}`,
    `Return JSON: ${schema}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: env.openai.evalModel,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Evaluator failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Evaluator returned malformed JSON');
  }
  return normalizeEvaluation(parsed, mode);
}

/**
 * Review an in-progress note and grade how interview-ready it is. Mirrors the
 * proxy → OpenAI → local-fallback resolution used by {@link evaluateAnswer}.
 */
export async function reviewNoteDraft(input: NoteReviewInput): Promise<NoteReview> {
  if (env.aiProxyUrl) {
    const res = await fetch(`${env.aiProxyUrl.replace(/\/$/, '')}/review-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Note review proxy failed (${res.status})`);
    return normalizeReview(await res.json());
  }

  if (env.openai.apiKey) {
    return reviewNoteWithOpenAI(input);
  }

  return localReview(input);
}

async function reviewNoteWithOpenAI(input: NoteReviewInput): Promise<NoteReview> {
  const sys =
    'You are an exacting interview coach reviewing a note a candidate is about ' +
    'to save to their practice bank. Judge how complete, specific and ' +
    'interview-ready it is on a 0-10 scale (10 = a model answer/story). If it ' +
    'scores below 7, be concrete about what is missing and either rewrite it or ' +
    'ask the questions whose answers would make it strong. Respond ONLY with JSON ' +
    'matching the requested schema.';

  const user = [
    describeNote(input),
    input.category ? `CATEGORY: ${input.category}` : '',
    input.company ? `COMPANY: ${input.company}` : '',
    'Return JSON: { ' +
      '"score": number 0-10, ' +
      '"verdict": short one-line headline, ' +
      '"missing": array of short bullet strings naming what is absent or weak (empty if score >= 7), ' +
      '"questions": array of short questions whose answers would improve the note (empty if none needed), ' +
      '"improved": a stronger rewritten version of the answer/content as a single string (null if the note is already strong) }',
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: env.openai.evalModel,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Note reviewer failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Note reviewer returned malformed JSON');
  }
  return normalizeReview(parsed);
}

/** Render the draft as the prompt body, shaped by note kind. */
function describeNote(input: NoteReviewInput): string {
  if (input.kind === 'story') {
    return [
      'Review this STORY note (a personal anecdote the candidate wants to tell on cue).',
      input.triggers?.length ? `TRIGGERS: ${input.triggers.join('; ')}` : '',
      input.hook ? `HOOK: ${input.hook}` : 'HOOK: (empty)',
      input.narrative ? `CORE NARRATIVE:\n${input.narrative}` : 'CORE NARRATIVE: (empty)',
      input.takeaway ? `TAKEAWAY: ${input.takeaway}` : 'TAKEAWAY: (empty)',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    'Review this QUESTION note.',
    `QUESTION: ${input.question ?? '(empty)'}`,
    input.reference && input.reference.trim()
      ? `REFERENCE ANSWER:\n${input.reference}`
      : 'REFERENCE ANSWER: (empty — none written yet)',
  ].join('\n');
}

function normalizeReview(raw: any): NoteReview {
  const toLines = (v: any): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : String(v ?? '')
          .split('\n')
          .map((s) => s.replace(/^[-•\d.\s]+/, '').trim())
          .filter(Boolean);

  const improved = String(raw?.improved ?? '').trim();
  return {
    score: clampReviewScore(Number(raw?.score)),
    verdict: String(raw?.verdict ?? 'Reviewed').trim(),
    missing: toLines(raw?.missing),
    questions: toLines(raw?.questions),
    improved: improved || null,
  };
}

const clampReviewScore = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : 5;

function normalizeEvaluation(raw: any, mode: 'A' | 'B'): Evaluation {
  const score = clampScore(Number(raw?.score));
  return {
    score,
    summary: String(raw?.summary ?? 'Evaluated').trim(),
    strengths: String(raw?.strengths ?? '').trim(),
    improvements: String(raw?.improvements ?? '').trim(),
    generatedReference:
      mode === 'B' ? String(raw?.generatedReference ?? '').trim() || null : null,
  };
}

const clampScore = (n: number): number =>
  Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : 6;

// ---------------------------------------------------------------------------
// Local fallback (no key configured)
// ---------------------------------------------------------------------------

function localTranscriptStub(): string {
  return (
    'So in my last role two teams disagreed on priorities, and since I did not ' +
    'own either team I set up a shared dashboard and a short weekly sync. Within ' +
    'a month both teams were aligned and we shipped what mattered. (Add an OpenAI ' +
    'key to enable real Whisper transcription.)'
  );
}

/** Cheap, deterministic heuristic so the loop is exercisable without a key. */
function localEvaluation(input: EvaluationInput, mode: 'A' | 'B'): Evaluation {
  const words = input.answer.trim().split(/\s+/).filter(Boolean);
  const len = words.length;

  // Reward a substantive answer; reward overlap with the reference (Mode A).
  let score = 4;
  if (len >= 40) score += 2;
  else if (len >= 20) score += 1;

  if (mode === 'A' && input.reference) {
    score += overlapBonus(input.answer, input.reference);
  } else {
    score += 1; // Mode B: give benefit of the doubt, model answer follows
  }
  score = clampScore(score);

  const summary =
    score >= 8 ? 'Strong, well-structured' : score >= 5 ? 'Solid, lead with impact' : 'Thin — add specifics';

  const strengths =
    len >= 20
      ? 'Concrete example with a clear arc. You named the people and the tension well.'
      : 'Good instinct, but the answer is short — there is a real story to tell here.';

  const improvements =
    'Open with the result, then the situation — your impact landed late. ' +
    'Quantify the win and tie it to a metric that matters.';

  const generatedReference =
    mode === 'B'
      ? buildModelAnswer(input)
      : null;

  return { score, summary, strengths, improvements, generatedReference };
}

/**
 * Heuristic note review for when no AI backend is configured. Scores on
 * completeness + substance so the "Improve with AI" flow is exercisable in
 * local-first mode.
 */
function localReview(input: NoteReviewInput): NoteReview {
  const wordCount = (s?: string | null) =>
    (s ?? '').trim().split(/\s+/).filter(Boolean).length;
  const missing: string[] = [];
  const questions: string[] = [];

  let score = 3;
  let improved: string | null = null;

  if (input.kind === 'question') {
    const refWords = wordCount(input.reference);
    if (!input.question || input.question.trim().length < 8) {
      missing.push('The question is empty or too vague to practise against.');
    }
    if (refWords === 0) {
      missing.push('No reference answer — the AI will have to improvise when you practise.');
      questions.push('What are the 2–3 key points your ideal answer must hit?');
      questions.push('Do you have a concrete example or metric that proves your point?');
    } else {
      score += refWords >= 60 ? 4 : refWords >= 30 ? 3 : 1;
      if (refWords < 30) {
        missing.push('The reference answer is thin — add specifics, numbers, and an outcome.');
      }
      if (!/\d/.test(input.reference ?? '')) {
        missing.push('No quantified impact — add a metric that shows the result mattered.');
      }
    }
    if (!input.category) missing.push('No category set — it helps target practice and exams.');
    if (refWords > 0 && refWords < 30) {
      improved = buildImprovedAnswer(input);
    }
  } else {
    const triggers = (input.triggers ?? []).filter((t) => t.trim());
    if (triggers.length === 0) {
      missing.push('No triggers — add the topics that should remind you to tell this story.');
    }
    if (!input.hook?.trim()) {
      missing.push('Missing a hook — one sharp opening line that earns attention.');
    } else score += 2;
    if (wordCount(input.narrative) < 20) {
      missing.push('The narrative is too brief — sketch the situation, the tension, and what you did.');
      questions.push('What was the obstacle, and what specific action did you take?');
    } else score += 3;
    if (!input.takeaway?.trim()) {
      missing.push('No takeaway — end on the lesson or the result you want remembered.');
      questions.push('What is the one thing the interviewer should remember afterwards?');
    } else score += 2;
  }

  score = clampReviewScore(score);

  const verdict =
    score >= 8
      ? 'Strong and interview-ready'
      : score >= NOTE_REVIEW_PASS
        ? 'Solid — a little polish left'
        : missing.length
          ? 'Needs more before it lands'
          : 'A start — keep building it';

  // Above the bar: drop the nitpicks and let it stand.
  if (score >= NOTE_REVIEW_PASS) {
    return { score, verdict, missing: [], questions: [], improved: null };
  }
  return {
    score,
    verdict,
    missing,
    questions,
    improved,
  };
}

function buildImprovedAnswer(input: NoteReviewInput): string {
  return (
    'Lead with the result, then the context: "We did X, which moved <metric> by ' +
    'Y%." Walk through the situation, the specific action you owned, and the ' +
    'measurable outcome. Close by tying it back to the question. ' +
    '(Add an OpenAI key for a tailored rewrite.)'
  );
}

function overlapBonus(answer: string, reference: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const a = tokens(answer);
  const r = tokens(reference);
  if (r.size === 0) return 0;
  let hits = 0;
  a.forEach((w) => {
    if (r.has(w)) hits += 1;
  });
  const ratio = hits / r.size;
  return ratio > 0.4 ? 3 : ratio > 0.2 ? 2 : ratio > 0.1 ? 1 : 0;
}

function buildModelAnswer(input: EvaluationInput): string {
  return (
    `Frame ${input.company ? input.company + "'s" : 'the'} situation as one scarce ` +
    'resource against competing demands. 1) Tie each ask to a metric that matters ' +
    'this quarter. 2) Score by impact × effort × reversibility. 3) Make the ' +
    'trade-off visible in one shared view. 4) Set a cadence so "no" means "not now." ' +
    'Close with the concrete outcome you would expect. (Add an OpenAI key for a ' +
    'tailored model answer.)'
  );
}
