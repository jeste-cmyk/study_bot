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
import type { StoryMode } from '@/domain/types';

/**
 * How to grade an answer:
 * - `undefined` — the default interview/question grading (Mode A vs. reference,
 *   or Mode B where the AI also drafts a model answer).
 * - `delivery`  — a personal story told out loud: grade delivery + naturalness,
 *   not structure. `reference` holds the story's polished version (facts only).
 * - `recall`    — after telling a personal story, the user recalls its triggers
 *   and conversation directions. `reference` holds the saved cues to check against.
 */
export type EvaluationFocus = 'delivery' | 'recall';

export interface EvaluationInput {
  question: string;
  reference: string | null; // present ⇒ Mode A
  answer: string;
  category?: string | null;
  company?: string | null;
  focus?: EvaluationFocus;
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

/** The question draft being reviewed while a user is creating a note. */
export interface NoteReviewInput {
  question?: string;
  reference?: string | null;
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
// Story analysis ("Analyze with AI")
// ---------------------------------------------------------------------------

/** The raw story a user is authoring, sent for analysis. */
export interface StoryAnalysisInput {
  rawStory: string;
  /** Which coach to analyze with. Defaults to interview when omitted. */
  mode?: StoryMode;
  category?: string | null;
}

/**
 * What "Analyze with AI" produces from a raw story. The caller keeps the user's
 * raw text intact and only appends {@link StoryAnalysis.questions} to it; the
 * other fields populate the title, the storytelling box, the score and the
 * trigger list.
 */
export interface StoryAnalysis {
  /** A short, memorable title for the story. */
  title: string;
  /** A polished, spoken-aloud storytelling version of the raw account. */
  storytelling: string;
  /** Readiness score for the story as told (0–10). */
  score: number;
  /** Follow-up questions about missing details, appended to the raw box. */
  questions: string[];
  /** Prompts this story answers — interview questions, or conversational cues. */
  triggers: string[];
  /**
   * Personal mode only: ways to keep the conversation going after telling it.
   * Empty for interview stories.
   */
  conversationHooks: string[];
}

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

/** The default interview/question grader (Mode A vs. reference, or Mode B). */
function buildInterviewEvaluationPrompt(
  input: EvaluationInput,
  mode: 'A' | 'B',
): { sys: string; user: string } {
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

  return { sys, user };
}

/**
 * Personal-story graders. Two focuses:
 * - `delivery` — how naturally the story was told out loud (pacing, flow, how
 *   human and conversational it sounds), NOT interview structure or metrics.
 * - `recall`   — whether the user can recall, in their own words, when to bring
 *   the story up (its triggers) and where to take the conversation next.
 */
function buildStoryEvaluationPrompt(
  input: EvaluationInput,
  focus: EvaluationFocus,
): { sys: string; user: string } {
  const schema =
    '{ "score": number 1-10, "summary": short headline, "strengths": 1-2 sentences, "improvements": 1-2 sentences }';

  if (focus === 'recall') {
    const sys =
      'You are a conversation coach. After telling a personal story, someone ' +
      'should know WHEN they would naturally bring it up (its triggers) and WHERE ' +
      'they could steer the conversation afterwards (directions/hooks). They just ' +
      'tried to recall these from memory. Compare what they said to the saved cues ' +
      'below. Reward capturing the GIST in their own words (not verbatim); coach ' +
      'what they missed or could add. Respond ONLY with JSON matching the schema.';
    const user = [
      `STORY: ${input.question}`,
      `SAVED CUES (triggers = when to tell it; directions = where to take the chat):\n${input.reference ?? '(none saved)'}`,
      `WHAT THEY RECALLED:\n${input.answer}`,
      `Return JSON: ${schema}`,
    ].join('\n\n');
    return { sys, user };
  }

  const sys =
    'You are a storytelling delivery coach. Someone is practising telling a ' +
    'personal story out loud, as they would to a friend, from just its title. ' +
    'Grade DELIVERY and NATURALNESS — pacing, flow, vividness, and whether it ' +
    'would land in a real conversation — NOT interview structure, STAR, or ' +
    'metrics. Judge how they told it, not whether it matches a script; the ' +
    'reference is only there so you know the facts. Reward a natural, human, ' +
    'well-paced telling; flag rambling, a flat opening, or a weak ending. ' +
    'Respond ONLY with JSON matching the schema.';
  const user = [
    `STORY TITLE / PROMPT: ${input.question}`,
    input.reference
      ? `THEIR POLISHED VERSION (facts for reference, not a script to match):\n${input.reference}`
      : '',
    `HOW THEY TOLD IT:\n${input.answer}`,
    `Return JSON: ${schema}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { sys, user };
}

async function evaluateWithOpenAI(
  input: EvaluationInput,
  mode: 'A' | 'B',
): Promise<Evaluation> {
  const { sys, user } = input.focus
    ? buildStoryEvaluationPrompt(input, input.focus)
    : buildInterviewEvaluationPrompt(input, mode);

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

/** Render the question draft as the prompt body. */
function describeNote(input: NoteReviewInput): string {
  return [
    'Review this QUESTION note.',
    `QUESTION: ${input.question ?? '(empty)'}`,
    input.reference && input.reference.trim()
      ? `REFERENCE ANSWER:\n${input.reference}`
      : 'REFERENCE ANSWER: (empty — none written yet)',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Story analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a raw story into a title, a storytelling version, a score, follow-up
 * questions and trigger prompts. Mirrors the proxy → OpenAI → local-fallback
 * resolution used by {@link evaluateAnswer}.
 */
export async function analyzeStory(input: StoryAnalysisInput): Promise<StoryAnalysis> {
  if (env.aiProxyUrl) {
    const res = await fetch(`${env.aiProxyUrl.replace(/\/$/, '')}/analyze-story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Story analysis proxy failed (${res.status})`);
    return normalizeAnalysis(await res.json(), input.mode ?? 'interview');
  }

  if (env.openai.apiKey) {
    return analyzeStoryWithOpenAI(input);
  }

  return localAnalysis(input);
}

async function analyzeStoryWithOpenAI(input: StoryAnalysisInput): Promise<StoryAnalysis> {
  const mode: StoryMode = input.mode ?? 'interview';

  const sys =
    mode === 'personal'
      ? 'You are a storytelling coach for everyday conversation. Someone has ' +
        'written a rough account of something that happened to them and wants to ' +
        'tell it well to friends. Make it vivid, natural and well-paced to say ' +
        'out loud WITHOUT inventing facts. Respond ONLY with JSON matching the ' +
        'requested schema.'
      : 'You are an interview storytelling coach. A candidate has written a ' +
        'rough, factual account of something that happened to them. Turn it into ' +
        'an interview-ready story WITHOUT inventing facts. Respond ONLY with JSON ' +
        'matching the requested schema.';

  const schema =
    mode === 'personal'
      ? 'Return JSON: { ' +
        '"title": a short memorable title (max ~6 words), ' +
        '"storytelling": a vivid, casual, spoken-aloud version with a natural build and a satisfying ending, first person, paced for a real conversation (not a monologue), ' +
        '"score": number 0-10 for how well this story would land when told to friends, ' +
        '"questions": array of short questions about missing detail that would make it more vivid or funny (sensory detail, what someone said, how it felt) — empty if nothing is missing, ' +
        '"triggers": array of 2-4 conversational cues when this story naturally comes up (e.g. "when talk turns to travel disasters", "when someone mentions a bad boss"), ' +
        '"conversationHooks": array of 4-6 ways to keep the conversation going after telling it — a mix of questions to ask the other person, opinions you could share, and related OR unrelated threads to branch into }'
      : 'Return JSON: { ' +
        '"title": a short memorable title (max ~6 words), ' +
        '"storytelling": a polished, spoken-aloud version with a clear arc (situation → tension → action → result), 4-8 sentences, first person, ' +
        '"score": number 0-10 for how compelling and complete the story is as told, ' +
        '"questions": array of short questions about concrete details that are missing (metrics, stakes, your specific role) — empty if nothing is missing, ' +
        '"triggers": array of 2-4 interview prompts this story is a strong answer to (e.g. "Tell me about a time you led under pressure"), ' +
        '"conversationHooks": [] }';

  const user = [
    input.category ? `CATEGORY: ${input.category}` : '',
    "RAW STORY (the person's own notes — may contain guiding prompts they wrote against):",
    input.rawStory,
    schema,
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
      temperature: mode === 'personal' ? 0.7 : 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Story analyzer failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Story analyzer returned malformed JSON');
  }
  return normalizeAnalysis(parsed, mode);
}

function normalizeAnalysis(raw: any, mode: StoryMode): StoryAnalysis {
  const toLines = (v: any): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : String(v ?? '')
          .split('\n')
          .map((s) => s.replace(/^[-•\d.\s]+/, '').trim())
          .filter(Boolean);

  return {
    title: String(raw?.title ?? '').trim(),
    storytelling: String(raw?.storytelling ?? '').trim(),
    score: clampReviewScore(Number(raw?.score)),
    questions: toLines(raw?.questions),
    triggers: toLines(raw?.triggers),
    conversationHooks: mode === 'personal' ? toLines(raw?.conversationHooks) : [],
  };
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
  if (input.focus) return localStoryEvaluation(input, input.focus);

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
 * Deterministic personal-story grading for local-first mode (no AI key).
 * Delivery rewards a substantive, well-paced telling; recall rewards overlap
 * with the saved trigger/direction cues.
 */
function localStoryEvaluation(input: EvaluationInput, focus: EvaluationFocus): Evaluation {
  const words = input.answer.trim().split(/\s+/).filter(Boolean);
  const len = words.length;

  if (focus === 'recall') {
    let score = 4;
    if (len >= 15) score += 1;
    if (input.reference) score += overlapBonus(input.answer, input.reference);
    score = clampScore(score);
    const strong = score >= 7;
    return {
      score,
      summary: strong ? 'You know your cues' : 'Half the map is there',
      strengths: strong
        ? 'You named when this comes up and where the conversation can go next.'
        : 'You recalled some of it — a couple of cues came through.',
      improvements: strong
        ? 'Keep a spare direction in your back pocket so it never dead-ends.'
        : 'Name one or two more triggers, and a question you could ask to hand the conversation back. (Add an OpenAI key for tailored coaching.)',
      generatedReference: null,
    };
  }

  // delivery
  let score = 4;
  if (len >= 60) score += 2;
  else if (len >= 30) score += 1;
  if (len > 220) score -= 1; // rambling
  score = clampScore(score);
  const strong = score >= 7;
  return {
    score,
    summary: strong ? 'Natural and easy to follow' : 'Told it — now make it land',
    strengths:
      len >= 30
        ? 'Good, conversational flow — it sounds like you talking, not reciting.'
        : 'Clear start, but it went by fast — there is more story to enjoy here.',
    improvements:
      'Open on a hook, slow down on the best beat, and land a clean ending line. ' +
      'Say it like the person in front of you has never heard it. (Add an OpenAI key for tailored delivery coaching.)',
    generatedReference: null,
  };
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

/**
 * Deterministic story analysis for local-first mode (no AI key). Good enough to
 * exercise the Analyze flow: it drafts a title/storytelling scaffold from the
 * raw text and always asks for the specifics interviewers care about.
 */
function localAnalysis(input: StoryAnalysisInput): StoryAnalysis {
  const mode: StoryMode = input.mode ?? 'interview';

  // Drop any guiding prompts the user wrote against, then split into sentences.
  const clean = input.rawStory
    .split('\n')
    .filter((line) => !line.trim().endsWith('?'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = clean.split(/\s+/).filter(Boolean);

  const title =
    (sentences[0] ?? 'Untitled story')
      .replace(/[.!?]+$/, '')
      .split(/\s+/)
      .slice(0, 7)
      .join(' ') || 'Untitled story';

  const note =
    mode === 'personal'
      ? '(Add an OpenAI key for a tailored conversational rewrite.)'
      : '(Add an OpenAI key for a tailored storytelling rewrite.)';
  const storytelling = clean ? `${clean} ${note}` : '';

  let score = 3;
  if (words.length >= 40) score += 2;
  else if (words.length >= 20) score += 1;
  if (/\d/.test(clean)) score += 2; // a metric (interview) / a specific number (personal)
  score = clampReviewScore(score);

  if (mode === 'personal') {
    const questions: string[] = [];
    if (words.length < 40) {
      questions.push('What could you see, hear, or feel in the moment — one vivid detail?');
    }
    questions.push('What is the funniest or most surprising beat, and how do you land the ending?');

    const triggers = [
      'When talk turns to things going wrong on a trip.',
      'When someone shares an awkward or embarrassing moment.',
    ];
    const conversationHooks = [
      'Ask them: has anything like that ever happened to you?',
      'Share your take on why moments like that stick with us.',
      'Branch to a related story — the last time a plan fell apart.',
      'Pivot to an unrelated thread — what they have coming up next.',
    ];
    return { title, storytelling, score, questions, triggers, conversationHooks };
  }

  const questions: string[] = [];
  if (!/\d/.test(clean)) {
    questions.push('What was the measurable result — a number, %, or before/after?');
  }
  if (words.length < 40) {
    questions.push('What was the obstacle, and what specific action did you personally take?');
  }
  questions.push('What did the interviewer learn about you from this — the takeaway?');

  const triggers = [
    'Tell me about a time you faced a challenge.',
    'Describe a situation where you had to adapt.',
  ];

  return { title, storytelling, score, questions, triggers, conversationHooks: [] };
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
