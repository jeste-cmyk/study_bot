/**
 * The study session — the core practice loop, reused in two places:
 *
 *  - As the home tab (`showFilter`): lands you straight on the first question
 *    with a top menu to prioritise a question type.
 *  - As the focused `/practice?focus=` modal (`onExit`): drills into one
 *    question, with a close button back to wherever you came from.
 *
 * Operates on `PracticeItem`s from `buildQueue` (prompt/noteId/sr), so it works
 * for both questions and story triggers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

import {
  categoryStyle,
  colors,
  fonts,
  radius,
  RATING_STYLES,
  scoreColor,
  CATEGORIES,
  type RatingKey,
} from '@/theme';
import { Button, Card, Pill, Txt } from '@/ui/primitives';
import { ArrowRight, CloseIcon, MicIcon } from '@/ui/icons';
import { useStore } from '@/store/useStore';
import { buildQueue, type PracticeItem } from '@/domain/selection';
import { practiceMode, type AnswerMode } from '@/domain/types';
import { previewIntervals } from '@/domain/spacedRepetition';
import { evaluateAnswer, transcribeAudio, type Evaluation } from '@/services/ai';

/**
 * The practice flow. Questions and interview stories run answer → evaluating →
 * feedback. Personal stories add a second act after delivery feedback: recall →
 * recallEvaluating → recallFeedback, quizzing you on *when* to tell the story
 * and *where* to take the conversation, then a single self-rating.
 */
type Step =
  | 'answer'
  | 'evaluating'
  | 'feedback'
  | 'recall'
  | 'recallEvaluating'
  | 'recallFeedback';

/** The prompt shown for a personal story's recall step. */
const RECALL_QUESTION =
  'When would you bring this story up — and where could you take the conversation from here?';

/** A snapshot of the delivery answer, kept while the recall step reuses the input. */
interface DeliverySnapshot {
  inputMode: AnswerMode;
  answerText: string;
  transcript: string | null;
  audioUri: string | null;
  evaluation: Evaluation | null;
}

/** Pack a personal story's saved cues into a reference the recall grader checks against. */
function formatRecallReference(triggers: string[], hooks: string[]): string {
  const block = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : '';
  return [
    block('Triggers (when to tell it)', triggers),
    block('Directions (where to take the conversation)', hooks),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const CATEGORY_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  ...CATEGORIES.map((c) => ({ key: c, label: c === 'Technical' ? 'Tech' : c })),
];

export interface StudySessionProps {
  /** Jump a specific note to the front of the queue (deep-link from a question). */
  focus?: string;
  /** When provided, render a close button that calls this (modal mode). */
  onExit?: () => void;
  /** When true, render the category-priority menu at the top (home mode). */
  showFilter?: boolean;
}

export function StudySession({ focus, onExit, showFilter }: StudySessionProps) {
  const insets = useSafeAreaInsets();
  const recordAttempt = useStore((s) => s.recordAttempt);

  // Category priority filter (home mode). Empty = all categories.
  const [active, setActive] = useState<string[]>([]);
  const filterKey = active.slice().sort().join(',');

  // Snapshot the queue when the session starts or the filter changes — not when
  // attempts are recorded (reading questions via getState keeps it out of deps,
  // so the queue doesn't reshuffle mid-session).
  const queue = useMemo<PracticeItem[]>(() => {
    const notes = useStore.getState().notes;
    const filter = active.length > 0 ? { categories: active } : undefined;
    const all = buildQueue(notes, filter);
    if (focus) {
      const target = all.find((it) => it.noteId === focus);
      if (target) return [target, ...all.filter((it) => it.key !== target.key)];
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, focus]);

  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>('answer');
  const [inputMode, setInputMode] = useState<AnswerMode>('text');
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [recallEvaluation, setRecallEvaluation] = useState<Evaluation | null>(null);
  const [delivery, setDelivery] = useState<DeliverySnapshot | null>(null);
  const [saveRef, setSaveRef] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = queue[index];
  const mode = current ? practiceMode(current) : 'A';

  // Personal stories: told from the title, graded on delivery, then quizzed on
  // their triggers + conversation directions.
  const isPersonalStory =
    !!current && current.kind === 'story' && current.storyMode === 'personal';
  const recallTriggers = (current?.recallTriggers ?? []).filter((t) => t.trim());
  const recallHooks = (current?.conversationHooks ?? []).filter((h) => h.trim());
  const hasRecall = isPersonalStory && recallTriggers.length + recallHooks.length > 0;
  const inRecall =
    step === 'recall' || step === 'recallEvaluating' || step === 'recallFeedback';

  // Ask for mic permission up front; fall back to text if denied / web.
  useEffect(() => {
    (async () => {
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (granted) {
          await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          setVoiceAvailable(true);
          setInputMode('voice');
        }
      } catch {
        setVoiceAvailable(false);
      }
    })();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const resetForNext = () => {
    setStep('answer');
    setInputMode(voiceAvailable ? 'voice' : 'text');
    setAnswerText('');
    setTranscript(null);
    setAudioUri(null);
    setEvaluation(null);
    setRecallEvaluation(null);
    setDelivery(null);
    setSaveRef(false);
    setRecording(false);
    setElapsed(0);
    setError(null);
  };

  // Restart the session from the top whenever the priority filter changes.
  useEffect(() => {
    setIndex(0);
    resetForNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const toggleCategory = (key: string) => {
    if (key === 'all') return setActive([]);
    setActive((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const advance = () => {
    if (index + 1 < queue.length) {
      setIndex((i) => i + 1);
      resetForNext();
    } else if (onExit) {
      onExit();
    } else {
      // Home mode: loop back to a fresh pass over the queue.
      setIndex(0);
      resetForNext();
    }
  };

  // ---- recording -----------------------------------------------------------
  const startRecording = async () => {
    setError(null);
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e: any) {
      setError('Could not start recording — try typing instead.');
      setInputMode('text');
    }
  };

  const stopRecording = async (): Promise<string | null> => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    try {
      await recorder.stop();
      return recorder.uri ?? null;
    } catch {
      return null;
    }
  };

  // ---- submit + evaluate ---------------------------------------------------
  /** Grade one phase's answer. `delivery` covers questions, interview + personal
   *  stories; `recall` covers a personal story's triggers/directions quiz. */
  const evaluatePhase = async (phase: 'delivery' | 'recall', finalAnswer: string) => {
    if (!current) return;
    if (phase === 'recall') {
      setStep('recallEvaluating');
      try {
        const result = await evaluateAnswer({
          question: current.prompt,
          reference: formatRecallReference(recallTriggers, recallHooks),
          answer: finalAnswer,
          focus: 'recall',
        });
        setRecallEvaluation(result);
        setStep('recallFeedback');
      } catch (e: any) {
        setError(e?.message ?? 'Evaluation failed');
        setStep('recall');
      }
      return;
    }
    setStep('evaluating');
    try {
      const result = await evaluateAnswer({
        question: current.prompt,
        reference: current.reference,
        answer: finalAnswer,
        category: current.category,
        company: current.company,
        focus: isPersonalStory ? 'delivery' : undefined,
      });
      setEvaluation(result);
      setStep('feedback');
    } catch (e: any) {
      setError(e?.message ?? 'Evaluation failed');
      setStep('answer');
    }
  };

  const submit = async () => {
    const phase: 'delivery' | 'recall' = step === 'recall' ? 'recall' : 'delivery';
    if (inputMode === 'voice') {
      const uri = await stopRecording();
      setAudioUri(uri);
      setStep(phase === 'recall' ? 'recallEvaluating' : 'evaluating');
      try {
        const text = uri ? await transcribeAudio(uri) : '';
        setTranscript(text);
        setAnswerText(text);
        await evaluatePhase(phase, text);
      } catch (e: any) {
        setError(e?.message ?? 'Transcription failed');
        setStep(phase === 'recall' ? 'recall' : 'answer');
      }
    } else {
      if (answerText.trim().length === 0) {
        setError('Type an answer first, or switch to voice.');
        return;
      }
      await evaluatePhase(phase, answerText.trim());
    }
  };

  /** Delivery feedback → recall step: snapshot the told story, reset the input. */
  const startRecall = () => {
    setDelivery({
      inputMode,
      answerText,
      transcript: inputMode === 'voice' ? transcript : null,
      audioUri,
      evaluation,
    });
    setAnswerText('');
    setTranscript(null);
    setAudioUri(null);
    setRecording(false);
    setElapsed(0);
    setInputMode(voiceAvailable ? 'voice' : 'text');
    setError(null);
    setStep('recall');
  };

  /** Skip the recall quiz but still reveal the saved cues and let the user rate.
   *  `delivery` was already snapshotted on entering the recall step. */
  const skipRecall = () => {
    setRecallEvaluation(null);
    setStep('recallFeedback');
  };

  const rate = async (rating: RatingKey) => {
    if (!current) return;

    if (isPersonalStory) {
      // The self-rating sets the one schedule for the whole story. Record the
      // delivery attempt, folding any recall coaching into its notes.
      const d = delivery ?? {
        inputMode,
        answerText,
        transcript: inputMode === 'voice' ? transcript : null,
        audioUri,
        evaluation,
      };
      if (!d.evaluation) return;
      const merged: Evaluation = recallEvaluation
        ? {
            ...d.evaluation,
            improvements: [
              d.evaluation.improvements,
              `Triggers & directions — ${recallEvaluation.summary}. ${recallEvaluation.improvements}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          }
        : d.evaluation;
      await recordAttempt(current.noteId, null, {
        mode: d.inputMode,
        answerText: d.answerText,
        transcript: d.transcript,
        audioUri: d.audioUri,
        evaluation: merged,
        rating,
      });
      advance();
      return;
    }

    if (!evaluation) return;
    await recordAttempt(current.noteId, current.triggerId, {
      mode: inputMode,
      answerText,
      transcript: inputMode === 'voice' ? transcript : null,
      audioUri,
      evaluation,
      rating,
      saveReference: saveRef,
    });
    advance();
  };

  // ---- empty queue ---------------------------------------------------------
  if (!current) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {showFilter ? (
          <FilterMenu
            insets={insets}
            active={active}
            onToggle={toggleCategory}
            queueLength={0}
          />
        ) : null}
        <View style={styles.empty}>
          <Txt variant="h3" style={{ marginBottom: 6 }}>
            All caught up
          </Txt>
          <Txt variant="small" style={{ textAlign: 'center', marginBottom: 18 }}>
            {active.length > 0
              ? 'Nothing to practise in that type right now.'
              : 'Nothing is due right now. Capture a new question or come back later.'}
          </Txt>
          {active.length > 0 ? (
            <Button title="Clear filter" variant="secondary" onPress={() => setActive([])} />
          ) : onExit ? (
            <Button title="Done" onPress={onExit} />
          ) : null}
        </View>
      </View>
    );
  }

  const c = categoryStyle(current.category);
  const progress = (index + 1) / queue.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {showFilter ? (
        <FilterMenu
          insets={insets}
          active={active}
          onToggle={toggleCategory}
          queueLength={queue.length}
        />
      ) : (
        /* Focus top bar (modal mode) */
        <View style={[styles.topbar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onExit} hitSlop={10} style={{ width: 60 }}>
            <CloseIcon size={20} color={colors.muted2} />
          </Pressable>
          <View style={styles.progressWrap}>
            <Txt variant="mono">
              {index + 1} of {queue.length}
            </Txt>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
          </View>
          <View style={{ width: 60 }} />
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{
            padding: 18,
            paddingBottom: (onExit ? insets.bottom : 0) + 24,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Progress (home mode shows it inline; modal mode has it in the top bar) */}
          {showFilter ? (
            <View style={styles.homeProgress}>
              <Txt variant="mono">
                {index + 1} of {queue.length}
              </Txt>
              <View style={[styles.progressTrack, { flex: 1 }]}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
            </View>
          ) : null}

          {/* Mode badge */}
          {isPersonalStory ? (
            <View style={[styles.modeBadge, { backgroundColor: '#F2ECFB' }]}>
              <View style={[styles.modeDot, { backgroundColor: '#6A3FB0' }]} />
              <Txt variant="bodyStrong" style={{ fontSize: 12, color: '#6A3FB0' }}>
                {inRecall
                  ? 'Recall · when to tell it + where it goes'
                  : 'For friends · tell it from the title'}
              </Txt>
            </View>
          ) : (
            <View
              style={[
                styles.modeBadge,
                mode === 'A'
                  ? { backgroundColor: colors.accentTint }
                  : { backgroundColor: '#F2ECFB' },
              ]}>
              <View
                style={[
                  styles.modeDot,
                  { backgroundColor: mode === 'A' ? colors.accent : '#6A3FB0' },
                ]}
              />
              <Txt
                variant="bodyStrong"
                style={{ fontSize: 12, color: mode === 'A' ? colors.accentInk : '#6A3FB0' }}>
                {mode === 'A' ? 'Mode A · compare to your saved answer' : 'Mode B · AI drafts a model answer'}
              </Txt>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Pill label={current.category ?? 'General'} bg={c.bg} fg={c.fg} />
            <Txt variant="mono">
              {[current.company, current.difficulty].filter(Boolean).join(' · ')}
            </Txt>
          </View>

          <Txt style={styles.question}>{inRecall ? RECALL_QUESTION : current.prompt}</Txt>

          {isPersonalStory && !inRecall && step === 'answer' ? (
            <Txt variant="small" style={{ marginTop: -8, marginBottom: 18 }}>
              Tell it out loud the way you would to a friend — no script, just the story.
            </Txt>
          ) : null}
          {inRecall && step === 'recall' ? (
            <Txt variant="small" style={{ marginTop: -8, marginBottom: 18 }}>
              From memory: what topics make this story come up, and how could you keep the chat going after?
            </Txt>
          ) : null}

          {error ? (
            <Txt variant="small" color={colors.danger} style={{ marginBottom: 12 }}>
              {error}
            </Txt>
          ) : null}

          {step === 'evaluating' || step === 'recallEvaluating' ? (
            <Card style={{ alignItems: 'center', paddingVertical: 34, gap: 12 }}>
              <ActivityIndicator color={colors.accent} />
              <Txt variant="small">
                {step === 'recallEvaluating'
                  ? 'Checking your recall…'
                  : inputMode === 'voice'
                    ? 'Transcribing and scoring…'
                    : 'Scoring your answer…'}
              </Txt>
            </Card>
          ) : step === 'answer' || step === 'recall' ? (
            <AnswerStep
              inputMode={inputMode}
              setInputMode={setInputMode}
              voiceAvailable={voiceAvailable}
              answerText={answerText}
              setAnswerText={setAnswerText}
              recording={recording}
              elapsed={elapsed}
              onStart={startRecording}
              onSubmit={submit}
              onSkip={step === 'recall' ? skipRecall : advance}
              submitLabel={step === 'recall' ? 'Submit recall' : undefined}
              skipLabel={step === 'recall' ? 'Skip' : undefined}
              placeholder={
                step === 'recall'
                  ? 'e.g. this comes up when someone talks about… and I’d follow it with…'
                  : undefined
              }
            />
          ) : step === 'feedback' && isPersonalStory ? (
            evaluation && (
              <DeliveryFeedback
                evaluation={evaluation}
                inputMode={inputMode}
                answerText={answerText}
                sr={current.sr}
                onContinue={hasRecall ? startRecall : undefined}
                onRate={hasRecall ? undefined : rate}
              />
            )
          ) : step === 'recallFeedback' ? (
            <RecallFeedback
              evaluation={recallEvaluation}
              answerText={answerText}
              triggers={recallTriggers}
              hooks={recallHooks}
              sr={current.sr}
              onRate={rate}
            />
          ) : (
            evaluation && (
              <FeedbackStep
                evaluation={evaluation}
                mode={mode}
                inputMode={inputMode}
                answerText={answerText}
                reference={current.reference}
                saveRef={saveRef}
                setSaveRef={setSaveRef}
                sr={current.sr}
                onRate={rate}
              />
            )
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Top priority menu (home mode)
// ---------------------------------------------------------------------------

function FilterMenu({
  insets,
  active,
  onToggle,
  queueLength,
}: {
  insets: { top: number };
  active: string[];
  onToggle: (key: string) => void;
  queueLength: number;
}) {
  return (
    <View style={[styles.menu, { paddingTop: insets.top + 8 }]}>
      <View style={styles.menuHead}>
        <View>
          <Txt variant="h3">Study</Txt>
          <Txt variant="small" style={{ marginTop: 2 }}>
            {queueLength > 0
              ? `${queueLength} in your queue`
              : 'Pick a type below to focus'}
          </Txt>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 7, paddingHorizontal: 18, paddingBottom: 12 }}>
        {CATEGORY_CHIPS.map((f) => {
          const on = f.key === 'all' ? active.length === 0 : active.includes(f.key);
          return (
            <Pressable
              key={f.key}
              onPress={() => onToggle(f.key)}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: colors.accent, borderColor: colors.accent }
                  : { backgroundColor: colors.surface, borderColor: colors.borderStrong },
              ]}>
              <Txt
                variant="bodyStrong"
                style={{ fontSize: 12.5, color: on ? '#fff' : colors.textSecondary }}>
                {f.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Answer step
// ---------------------------------------------------------------------------

function AnswerStep({
  inputMode,
  setInputMode,
  voiceAvailable,
  answerText,
  setAnswerText,
  recording,
  elapsed,
  onStart,
  onSubmit,
  onSkip,
  submitLabel = 'Submit for feedback',
  skipLabel = 'Skip',
  placeholder = "Type your answer as you'd say it in the room…",
}: {
  inputMode: AnswerMode;
  setInputMode: (m: AnswerMode) => void;
  voiceAvailable: boolean;
  answerText: string;
  setAnswerText: (s: string) => void;
  recording: boolean;
  elapsed: number;
  onStart: () => void;
  onSubmit: () => void;
  onSkip: () => void;
  submitLabel?: string;
  skipLabel?: string;
  placeholder?: string;
}) {
  return (
    <>
      {/* Input tabs */}
      <View style={{ flexDirection: 'row', gap: 7, marginBottom: 14 }}>
        <Pressable
          onPress={() => voiceAvailable && setInputMode('voice')}
          style={[
            styles.tab,
            inputMode === 'voice'
              ? { backgroundColor: colors.ink }
              : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
            !voiceAvailable && { opacity: 0.4 },
          ]}>
          <Txt variant="bodyStrong" style={{ fontSize: 13, color: inputMode === 'voice' ? '#fff' : colors.textSecondary }}>
            Voice
          </Txt>
        </Pressable>
        <Pressable
          onPress={() => setInputMode('text')}
          style={[
            styles.tab,
            inputMode === 'text'
              ? { backgroundColor: colors.ink }
              : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
          ]}>
          <Txt variant="bodyStrong" style={{ fontSize: 13, color: inputMode === 'text' ? '#fff' : colors.textSecondary }}>
            Type instead
          </Txt>
        </Pressable>
      </View>

      {inputMode === 'voice' ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable
              onPress={onStart}
              style={[styles.recBtn, recording && { backgroundColor: '#FBECEA', borderColor: '#F1C9C3' }]}>
              {recording ? (
                <View style={styles.recSquare} />
              ) : (
                <MicIcon size={22} color={colors.danger} />
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              <WaveBars active={recording} />
            </View>
            <Txt style={{ fontFamily: fonts.monoSemibold, fontSize: 18, color: colors.ink }}>
              {fmt(elapsed)}
            </Txt>
          </View>
          <View style={styles.recHint}>
            <View style={[styles.modeDot, { backgroundColor: recording ? colors.danger : colors.faint }]} />
            <Txt variant="small" style={{ flex: 1 }}>
              {recording
                ? 'Recording — answer out loud as if in the room. Tap stop, then submit.'
                : 'Tap the mic and answer out loud. We transcribe with Whisper before scoring.'}
            </Txt>
          </View>
        </Card>
      ) : (
        <TextInput
          value={answerText}
          onChangeText={setAnswerText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          multiline
          style={styles.answerInput}
        />
      )}

      <View style={styles.answerActions}>
        <Button title={skipLabel} variant="secondary" onPress={onSkip} style={{ flex: 0.7 }} />
        <Button
          title={submitLabel}
          onPress={onSubmit}
          icon={<ArrowRight size={17} color="#fff" />}
          style={{ flex: 1.6 }}
        />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Feedback step
// ---------------------------------------------------------------------------

function FeedbackStep({
  evaluation,
  mode,
  inputMode,
  answerText,
  reference,
  saveRef,
  setSaveRef,
  sr,
  onRate,
}: {
  evaluation: Evaluation;
  mode: 'A' | 'B';
  inputMode: AnswerMode;
  answerText: string;
  reference: string | null;
  saveRef: boolean;
  setSaveRef: (b: boolean) => void;
  sr: PracticeItem['sr'];
  onRate: (r: RatingKey) => void;
}) {
  return (
    <>
      {/* Your answer */}
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <Txt variant="label">YOUR ANSWER</Txt>
          <View style={styles.smallTag}>
            <Txt variant="monoSmall" style={{ fontSize: 10 }}>
              {inputMode === 'voice' ? 'voice · transcribed' : 'text'}
            </Txt>
          </View>
        </View>
        <Txt variant="body" style={{ color: colors.text }}>
          {answerText || '—'}
        </Txt>
      </Card>

      {/* Score + AI evaluation */}
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <ScoreCircle score={evaluation.score} />
          <View style={{ flex: 1 }}>
            <Txt variant="label" style={{ marginBottom: 3 }}>
              AI EVALUATION
            </Txt>
            <Txt variant="title">{evaluation.summary}</Txt>
          </View>
        </View>
        {evaluation.strengths ? (
          <View style={{ marginBottom: 11 }}>
            <View style={styles.fbHead}>
              <View style={[styles.modeDot, { backgroundColor: colors.success }]} />
              <Txt variant="bodyStrong" style={{ fontSize: 12, color: colors.success }}>
                STRENGTHS
              </Txt>
            </View>
            <Txt variant="body" style={{ color: colors.text }}>
              {evaluation.strengths}
            </Txt>
          </View>
        ) : null}
        {evaluation.improvements ? (
          <View>
            <View style={styles.fbHead}>
              <View style={[styles.modeDot, { backgroundColor: colors.warn }]} />
              <Txt variant="bodyStrong" style={{ fontSize: 12, color: colors.warn }}>
                TO IMPROVE
              </Txt>
            </View>
            <Txt variant="body" style={{ color: colors.text }}>
              {evaluation.improvements}
            </Txt>
          </View>
        ) : null}
      </Card>

      {/* Reference (Mode A) or AI model answer (Mode B) */}
      {mode === 'A' && reference ? (
        <Card style={{ marginBottom: 12 }}>
          <Txt variant="label" style={{ marginBottom: 9 }}>
            YOUR SAVED REFERENCE · MODE A
          </Txt>
          <Txt variant="body" style={{ color: colors.text }}>
            {reference}
          </Txt>
        </Card>
      ) : evaluation.generatedReference ? (
        <Card style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 9 }}>
            <Txt variant="label" style={{ color: '#6A3FB0' }}>
              MODEL ANSWER · AI
            </Txt>
            <Pressable
              onPress={() => setSaveRef(!saveRef)}
              style={[
                styles.saveRefBtn,
                saveRef
                  ? { backgroundColor: colors.accent }
                  : { backgroundColor: colors.accentTint },
              ]}>
              <Txt
                variant="bodyStrong"
                style={{ fontSize: 11, color: saveRef ? '#fff' : colors.accentInk }}>
                {saveRef ? '✓ Saved as reference' : 'Save as reference'}
              </Txt>
            </Pressable>
          </View>
          <Txt variant="body" style={{ color: colors.text }}>
            {evaluation.generatedReference}
          </Txt>
        </Card>
      ) : null}

      {/* Self-rating */}
      <RatingGrid sr={sr} onRate={onRate} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Personal story — delivery feedback (act 1) + recall feedback (act 2)
// ---------------------------------------------------------------------------

/** The AI score + strengths/improvements card, reused across feedback screens. */
function EvaluationCard({ evaluation, label }: { evaluation: Evaluation; label: string }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <ScoreCircle score={evaluation.score} />
        <View style={{ flex: 1 }}>
          <Txt variant="label" style={{ marginBottom: 3 }}>
            {label}
          </Txt>
          <Txt variant="title">{evaluation.summary}</Txt>
        </View>
      </View>
      {evaluation.strengths ? (
        <View style={{ marginBottom: 11 }}>
          <View style={styles.fbHead}>
            <View style={[styles.modeDot, { backgroundColor: colors.success }]} />
            <Txt variant="bodyStrong" style={{ fontSize: 12, color: colors.success }}>
              STRENGTHS
            </Txt>
          </View>
          <Txt variant="body" style={{ color: colors.text }}>
            {evaluation.strengths}
          </Txt>
        </View>
      ) : null}
      {evaluation.improvements ? (
        <View>
          <View style={styles.fbHead}>
            <View style={[styles.modeDot, { backgroundColor: colors.warn }]} />
            <Txt variant="bodyStrong" style={{ fontSize: 12, color: colors.warn }}>
              TO IMPROVE
            </Txt>
          </View>
          <Txt variant="body" style={{ color: colors.text }}>
            {evaluation.improvements}
          </Txt>
        </View>
      ) : null}
    </Card>
  );
}

/** Read-only card showing what the user said in a phase. */
function SaidCard({
  label,
  inputMode,
  answerText,
}: {
  label: string;
  inputMode: AnswerMode;
  answerText: string;
}) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <Txt variant="label">{label}</Txt>
        <View style={styles.smallTag}>
          <Txt variant="monoSmall" style={{ fontSize: 10 }}>
            {inputMode === 'voice' ? 'voice · transcribed' : 'text'}
          </Txt>
        </View>
      </View>
      <Txt variant="body" style={{ color: colors.text }}>
        {answerText || '—'}
      </Txt>
    </Card>
  );
}

/**
 * Act 1 for a personal story: how you delivered it. If the story has triggers /
 * directions to recall, offer "Continue"; otherwise show the rating grid here.
 */
function DeliveryFeedback({
  evaluation,
  inputMode,
  answerText,
  sr,
  onContinue,
  onRate,
}: {
  evaluation: Evaluation;
  inputMode: AnswerMode;
  answerText: string;
  sr: PracticeItem['sr'];
  onContinue?: () => void;
  onRate?: (r: RatingKey) => void;
}) {
  return (
    <>
      <SaidCard label="HOW YOU TOLD IT" inputMode={inputMode} answerText={answerText} />
      <EvaluationCard evaluation={evaluation} label="DELIVERY · HOW IT LANDED" />
      {onContinue ? (
        <Button
          title="Next: when to tell it →"
          onPress={onContinue}
          icon={<ArrowRight size={17} color="#fff" />}
        />
      ) : onRate ? (
        <RatingGrid sr={sr} onRate={onRate} />
      ) : null}
    </>
  );
}

/**
 * Act 2 for a personal story: recall of its triggers + conversation directions.
 * Always reveals the saved cues, then the single self-rating for the story.
 */
function RecallFeedback({
  evaluation,
  answerText,
  triggers,
  hooks,
  sr,
  onRate,
}: {
  evaluation: Evaluation | null;
  answerText: string;
  triggers: string[];
  hooks: string[];
  sr: PracticeItem['sr'];
  onRate: (r: RatingKey) => void;
}) {
  return (
    <>
      {evaluation ? (
        <>
          <SaidCard label="WHAT YOU RECALLED" inputMode="text" answerText={answerText} />
          <EvaluationCard evaluation={evaluation} label="RECALL · CUES & DIRECTIONS" />
        </>
      ) : null}

      {triggers.length > 0 ? (
        <Card style={{ marginBottom: 12 }}>
          <Txt variant="label" style={{ marginBottom: 9 }}>
            TRIGGERS · WHEN TO TELL IT
          </Txt>
          {triggers.map((t, i) => (
            <View key={i} style={styles.cueRow}>
              <View style={[styles.modeDot, { backgroundColor: '#6A3FB0', marginTop: 7 }]} />
              <Txt variant="body" style={{ flex: 1, color: colors.text }}>
                {t}
              </Txt>
            </View>
          ))}
        </Card>
      ) : null}

      {hooks.length > 0 ? (
        <Card style={{ marginBottom: 12 }}>
          <Txt variant="label" style={{ marginBottom: 9 }}>
            DIRECTIONS · KEEP IT GOING
          </Txt>
          {hooks.map((h, i) => (
            <View key={i} style={styles.cueRow}>
              <View style={[styles.modeDot, { backgroundColor: colors.accent, marginTop: 7 }]} />
              <Txt variant="body" style={{ flex: 1, color: colors.text }}>
                {h}
              </Txt>
            </View>
          ))}
        </Card>
      ) : null}

      <RatingGrid sr={sr} onRate={onRate} />
    </>
  );
}

/** The Anki-style self-rating buttons that set the next review. */
function RatingGrid({
  sr,
  onRate,
}: {
  sr: PracticeItem['sr'];
  onRate: (r: RatingKey) => void;
}) {
  const previews = previewIntervals(sr);
  const ratings: RatingKey[] = ['again', 'hard', 'good', 'easy'];
  return (
    <>
      <Txt variant="title" style={{ marginTop: 4 }}>
        How did it actually go?
      </Txt>
      <Txt variant="small" style={{ marginBottom: 12 }}>
        Your call sets the next review — not the AI score.
      </Txt>
      <View style={styles.rateGrid}>
        {ratings.map((r) => {
          const rs = RATING_STYLES[r];
          return (
            <Pressable
              key={r}
              onPress={() => onRate(r)}
              style={[styles.rateBtn, { backgroundColor: rs.bg, borderColor: rs.border }]}>
              <Txt variant="bodyStrong" style={{ fontSize: 14, color: rs.fg }}>
                {rs.label}
              </Txt>
              <Txt style={{ fontFamily: fonts.mono, fontSize: 10.5, color: rs.fg, opacity: 0.75 }}>
                {previews[r]}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function ScoreCircle({ score }: { score: number }) {
  return (
    <View style={[styles.scoreCircle, { borderColor: scoreColor(score) }]}>
      <Txt style={{ fontFamily: fonts.monoSemibold, fontSize: 20, color: colors.ink }}>
        {score}
        <Txt style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.muted2 }}>/10</Txt>
      </Txt>
    </View>
  );
}

function WaveBars({ active }: { active: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [active]);

  const bars = Array.from({ length: 34 }, (_, i) => {
    if (!active) return 4;
    const h = 4 + Math.abs(Math.sin(i * 0.6 + tick * 0.5)) * 26;
    return Math.round(h);
  });

  return (
    <View style={styles.wave}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: h,
            backgroundColor: active ? colors.ink : colors.faint,
            borderRadius: 999,
          }}
        />
      ))}
    </View>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, paddingHorizontal: 40 },
  menu: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuHead: {
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  homeProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTrack: {
    width: 50,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 14,
  },
  modeDot: { width: 7, height: 7, borderRadius: 4 },
  question: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, lineHeight: 29, marginBottom: 18, color: colors.ink },
  tab: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: radius.sm },
  recBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FBECEA',
    borderWidth: 1,
    borderColor: '#F1C9C3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recSquare: { width: 16, height: 16, borderRadius: 4, backgroundColor: colors.danger },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32 },
  recHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  answerInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: 16,
    minHeight: 150,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  answerActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  smallTag: { backgroundColor: '#F0EEE9', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  fbHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 },
  cueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 5 },
  scoreCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveRefBtn: { marginLeft: 'auto', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 },
  rateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  rateBtn: {
    width: '47.5%',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 2,
  },
});
