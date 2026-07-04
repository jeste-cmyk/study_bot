/**
 * Seed bank used in local-first mode so the app opens onto a realistic state
 * (mirrors the questions in the design exploration). Intervals are relative to
 * "now" so a few questions are always due today. Includes one example Story so
 * the story flow is visible without authoring one first.
 */
import type { Attempt, Note, Question, Rating, Story } from '@/domain/types';
import { initialSR } from '@/domain/spacedRepetition';
import { uid } from './id';

interface SeedSpec {
  text: string;
  reference: string | null;
  category: Question['category'];
  company: string;
  difficulty: Question['difficulty'];
  tags: string[];
  reps: number;
  intervalDays: number;
  dueInDays: number; // negative = overdue
  lastScore: number | null;
  lastRating: Rating | null;
}

const SPECS: SeedSpec[] = [
  {
    text: 'Tell me about a time you influenced a team without authority.',
    reference:
      'Result first: cut a cross-team decision cycle ~40%. Built a shared scorecard, ran a lightweight weekly ritual, made trade-offs visible — both leads bought in.',
    category: 'Behavioral',
    company: 'Revolut',
    difficulty: 'Medium',
    tags: ['leadership'],
    reps: 4,
    intervalDays: 8,
    dueInDays: 0,
    lastScore: 6,
    lastRating: 'hard',
  },
  {
    text: 'How would you cut delivery times for Mercado Envíos in Lima?',
    reference: null,
    category: 'Case',
    company: 'Mercado Libre',
    difficulty: 'Hard',
    tags: ['ops', 'logistics'],
    reps: 3,
    intervalDays: 5,
    dueInDays: 0,
    lastScore: 5,
    lastRating: 'again',
  },
  {
    text: 'Why Revolut, and why this role specifically?',
    reference:
      'Tie my ops + analytics background to Revolut’s LatAm expansion. Specific: their unit-economics rigor matches how I think; name a concrete bet I would push.',
    category: 'Fit',
    company: 'Revolut',
    difficulty: 'Easy',
    tags: ['motivation'],
    reps: 6,
    intervalDays: 9,
    dueInDays: 0,
    lastScore: 8,
    lastRating: 'good',
  },
  {
    text: 'Estimate the daily ride requests inDrive handles in Lima.',
    reference: null,
    category: 'Case',
    company: 'inDrive',
    difficulty: 'Hard',
    tags: ['estimation'],
    reps: 2,
    intervalDays: 2,
    dueInDays: 2,
    lastScore: 4,
    lastRating: 'hard',
  },
  {
    text: 'Write SQL for the top 3 couriers by on-time rate per zone.',
    reference:
      'Window function: RANK() OVER (PARTITION BY zone ORDER BY on_time_rate DESC); filter rank <= 3; guard against low-volume couriers with a min-deliveries threshold.',
    category: 'Technical',
    company: 'Mercado Libre',
    difficulty: 'Medium',
    tags: ['sql'],
    reps: 5,
    intervalDays: 6,
    dueInDays: 6,
    lastScore: 7,
    lastRating: 'good',
  },
  {
    text: 'Describe a project that failed and what you learned.',
    reference:
      'Own the call, not the blame. What broke, the leading indicator I missed, and the system I changed so it cannot recur.',
    category: 'Behavioral',
    company: 'Rappi',
    difficulty: 'Medium',
    tags: ['failure'],
    reps: 7,
    intervalDays: 11,
    dueInDays: 11,
    lastScore: 8,
    lastRating: 'easy',
  },
  {
    text: 'How do you prioritize when ops, growth and support all want eng time?',
    reference: null,
    category: 'Behavioral',
    company: 'inDrive',
    difficulty: 'Hard',
    tags: ['prioritization'],
    reps: 0,
    intervalDays: 0,
    dueInDays: 0,
    lastScore: null,
    lastRating: null,
  },
  {
    text: 'Size the TAM for inDrive entering a new mid-size city.',
    reference: null,
    category: 'Case',
    company: 'inDrive',
    difficulty: 'Hard',
    tags: ['estimation', 'tam'],
    reps: 0,
    intervalDays: 0,
    dueInDays: 0,
    lastScore: null,
    lastRating: null,
  },
];

const DAY = 24 * 60 * 60 * 1000;

function seedQuestions(userId: string, now: Date): Question[] {
  return SPECS.map((s, i) => {
    const createdAt = new Date(now.getTime() - (30 - i) * DAY).toISOString();
    const dueAt = new Date(now.getTime() + s.dueInDays * DAY).toISOString();
    const lastReviewedAt =
      s.reps > 0 ? new Date(now.getTime() - 5 * DAY).toISOString() : null;

    const id = uid('q-');
    const attempts: Attempt[] =
      s.reps > 0 && s.lastScore != null && s.lastRating
        ? [
            {
              id: uid('att-'),
              questionId: id,
              triggerId: null,
              mode: i % 2 === 0 ? 'voice' : 'text',
              answerText:
                'Practiced answer from a previous session — re-record to see fresh AI feedback.',
              transcript: null,
              audioUri: null,
              aiScore: s.lastScore,
              aiSummary: s.lastScore >= 8 ? 'Strong' : s.lastScore >= 5 ? 'Solid' : 'Thin',
              strengths: 'Concrete example with a clear outcome.',
              improvements: 'Lead with the result and quantify the win.',
              generatedReference: null,
              rating: s.lastRating,
              createdAt: lastReviewedAt ?? createdAt,
            },
          ]
        : [];

    return {
      id,
      userId,
      kind: 'question',
      status: 'ready',
      text: s.text,
      reference: s.reference,
      category: s.category,
      company: s.company,
      difficulty: s.difficulty,
      tags: s.tags,
      createdAt,
      updatedAt: createdAt,
      sr: {
        ...initialSR(now),
        reps: s.reps,
        intervalDays: s.intervalDays,
        dueAt,
        lastReviewedAt,
        history: s.reps > 0 ? [s.intervalDays] : [],
      },
      attempts,
    } satisfies Question;
  });
}

function seedStory(userId: string, now: Date): Story {
  const createdAt = new Date(now.getTime() - 12 * DAY).toISOString();
  const triggerTexts = [
    'Travel mishaps / things going wrong abroad',
    'A time you had to improvise under pressure',
    'Working with a difficult stakeholder',
  ];
  return {
    id: uid('s-'),
    userId,
    kind: 'story',
    status: 'ready',
    mode: 'interview',
    title: 'The vanished demo laptop',
    rawStory:
      'Flying to a conference in Bogotá, the airline lost the bag with my demo hardware an hour before I went on stage. I borrowed a colleague’s laptop and rebuilt the demo environment from a cloud backup in about 40 minutes. Then I re-sequenced the talk to lead with the live numbers instead of the device.',
    storytelling:
      'An hour before my conference talk in Bogotá, the airline lost the bag with my demo laptop. Rather than panic, I borrowed a colleague’s machine and rebuilt the entire demo environment from a cloud backup in 40 minutes. I re-sequenced the talk on the fly to open with the live numbers instead of the hardware — and the audience never knew anything had gone wrong. It taught me that preparation is a system, not a suitcase: keep the critical path reproducible from anywhere.',
    score: 8,
    triggers: triggerTexts.map((t) => ({
      id: uid('tr-'),
      text: t,
      sr: initialSR(now),
      attempts: [],
    })),
    conversationHooks: [],
    category: 'Behavioral',
    difficulty: 'Medium',
    tags: ['story', 'resilience'],
    createdAt,
    updatedAt: createdAt,
  };
}

function seedPersonalStory(userId: string, now: Date): Story {
  const createdAt = new Date(now.getTime() - 8 * DAY).toISOString();
  const triggerTexts = [
    'When talk turns to travel disasters',
    'When someone mentions getting lost somewhere',
  ];
  return {
    id: uid('s-'),
    userId,
    kind: 'story',
    status: 'ready',
    mode: 'personal',
    title: 'The overnight bus to nowhere',
    rawStory:
      'On a trip through Peru I fell asleep on an overnight bus and woke up at the last stop, three hours past my town, in a place I had never heard of. The driver just laughed. I ended up sharing breakfast with a family who ran the little bus-stop café and they drove me back.',
    storytelling:
      'So I’m on this overnight bus in Peru, completely knocked out, and I wake up to the driver tapping my shoulder — last stop, everyone off. Except this isn’t my town. I’m three hours past it, in a place I’ve genuinely never heard of, and it’s 5am. The driver just laughs at me and drives off. But the family running the little café at the bus stop takes one look at me, feeds me the best breakfast of the whole trip, and then the dad just… drives me back. Turns out getting hopelessly lost was the best thing that happened on that trip.',
    score: 8,
    triggers: triggerTexts.map((t) => ({
      id: uid('tr-'),
      text: t,
      sr: initialSR(now),
      attempts: [],
    })),
    conversationHooks: [
      'Ask them: what’s the most lost you’ve ever been somewhere?',
      'Share your take on how the best travel moments are never the planned ones.',
      'Branch to a related story — a time a stranger unexpectedly helped you out.',
      'Pivot to an unrelated thread — where they’d travel next if they could.',
    ],
    category: null,
    difficulty: 'Easy',
    tags: ['story', 'travel'],
    createdAt,
    updatedAt: createdAt,
  };
}

export function seedNotes(userId: string, now = new Date()): Note[] {
  return [
    seedStory(userId, now),
    seedPersonalStory(userId, now),
    ...seedQuestions(userId, now),
  ];
}
