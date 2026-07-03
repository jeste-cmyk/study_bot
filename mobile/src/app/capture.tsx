import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { CATEGORIES, categoryStyle, colors, fonts, radius, scoreColor } from '@/theme';
import { Button, Txt } from '@/ui/primitives';
import { CloseIcon, PlusIcon, SparkleIcon } from '@/ui/icons';
import { useStore } from '@/store/useStore';
import type { Category, Difficulty, NoteKind } from '@/domain/types';
import {
  NOTE_REVIEW_PASS,
  reviewNoteDraft,
  type NoteReview,
} from '@/services/ai';

const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];
const NOTE_KINDS: Array<{ key: NoteKind; label: string; hint: string }> = [
  { key: 'question', label: 'Question', hint: 'A prompt and the answer you want to nail.' },
  { key: 'story', label: 'Story', hint: 'A personal story you can pull out on cue.' },
];

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addNote = useStore((s) => s.addNote);

  const [kind, setKind] = useState<NoteKind>('question');
  const [isDraft, setIsDraft] = useState(false);

  // Shared metadata
  const [category, setCategory] = useState<Category | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);

  // Question fields
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');

  // Story fields
  const [triggers, setTriggers] = useState<string[]>(['']);
  const [hook, setHook] = useState('');
  const [narrative, setNarrative] = useState('');
  const [takeaway, setTakeaway] = useState('');

  const [busy, setBusy] = useState(false);

  // "Improve with AI" review state
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<NoteReview | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const filledTriggers = triggers.map((t) => t.trim()).filter(Boolean);

  // Looser bar: enough content to be worth keeping around. A draft is for
  // incomplete notes, so this is all a draft needs (and what review needs).
  const hasAnyContent =
    kind === 'question'
      ? Boolean(text.trim() || reference.trim())
      : filledTriggers.length > 0 || [hook, narrative, takeaway].some((s) => s.trim());

  // Strict bar: complete enough to be marked "ready".
  const isComplete =
    kind === 'question'
      ? text.trim().length > 0
      : filledTriggers.length > 0 && [hook, narrative, takeaway].some((s) => s.trim());

  // Drafts can be saved while still incomplete; "ready" notes can't.
  const canSave = !busy && (isDraft ? hasAnyContent : isComplete);

  const canReview = !reviewing && hasAnyContent;

  const runReview = async () => {
    if (!canReview) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const result = await reviewNoteDraft(
        kind === 'question'
          ? { kind, question: text, reference: reference.trim() || null, category, company: null }
          : { kind, hook, narrative, takeaway, triggers: filledTriggers, category },
      );
      setReview(result);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Could not reach the reviewer.');
    } finally {
      setReviewing(false);
    }
  };

  const setTrigger = (i: number, value: string) =>
    setTriggers((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  const addTrigger = () => setTriggers((prev) => [...prev, '']);
  const removeTrigger = (i: number) =>
    setTriggers((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const resetBody = () => {
    setText('');
    setReference('');
    setTriggers(['']);
    setHook('');
    setNarrative('');
    setTakeaway('');
    setReview(null);
    setReviewError(null);
  };

  const save = async (addAnother: boolean) => {
    if (!canSave) return;
    setBusy(true);
    try {
      const status = isDraft ? 'draft' : 'ready';
      if (kind === 'question') {
        await addNote({
          kind: 'question',
          status,
          text,
          reference: reference.trim() || null,
          category,
          company: null,
          difficulty,
        });
      } else {
        await addNote({
          kind: 'story',
          status,
          hook,
          narrative,
          takeaway,
          triggers: filledTriggers,
          category,
          difficulty,
        });
      }
      if (addAnother) {
        resetBody();
      } else {
        router.back();
      }
    } catch (e) {
      Alert.alert(
        'Could not save',
        e instanceof Error ? e.message : 'Something went wrong saving this note.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CloseIcon size={22} color={colors.muted2} />
        </Pressable>
        <Txt variant="title">New note</Txt>
        <Pressable onPress={() => save(false)} hitSlop={10} disabled={!canSave}>
          <Txt variant="bodyStrong" style={{ color: canSave ? colors.accentInk : colors.faint }}>
            Save
          </Txt>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}>
        <ScrollView
          contentContainerStyle={{ padding: 18, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Note type */}
          <Txt variant="label" style={[styles.label, { marginTop: 4 }]}>
            NOTE TYPE
          </Txt>
          <View style={styles.segment}>
            {NOTE_KINDS.map((k) => {
              const on = kind === k.key;
              return (
                <Pressable
                  key={k.key}
                  onPress={() => setKind(k.key)}
                  style={[
                    styles.segmentBtn,
                    on
                      ? { backgroundColor: colors.ink }
                      : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
                  ]}>
                  <Txt
                    variant="bodyStrong"
                    style={{ fontSize: 13.5, color: on ? '#fff' : colors.textSecondary }}>
                    {k.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <Txt variant="small" style={{ marginTop: 7 }}>
            {NOTE_KINDS.find((k) => k.key === kind)?.hint}
          </Txt>

          {kind === 'question' ? (
            <QuestionFields
              text={text}
              setText={setText}
              reference={reference}
              setReference={setReference}
            />
          ) : (
            <StoryFields
              triggers={triggers}
              setTrigger={setTrigger}
              addTrigger={addTrigger}
              removeTrigger={removeTrigger}
              hook={hook}
              setHook={setHook}
              narrative={narrative}
              setNarrative={setNarrative}
              takeaway={takeaway}
              setTakeaway={setTakeaway}
            />
          )}

          {/* Category */}
          <Txt variant="label" style={styles.label}>
            CATEGORY
          </Txt>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((c) => {
              const cs = categoryStyle(c);
              const on = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(on ? null : c)}
                  style={[
                    styles.chip,
                    on
                      ? { backgroundColor: cs.bg }
                      : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
                  ]}>
                  <Txt variant="bodyStrong" style={{ fontSize: 12.5, color: on ? cs.fg : colors.muted2 }}>
                    {c}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          {/* Difficulty */}
          <Txt variant="label" style={styles.label}>
            DIFFICULTY
          </Txt>
          <View style={styles.diffRow}>
            {DIFFICULTIES.map((d) => {
              const on = difficulty === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => setDifficulty(on ? null : d)}
                  style={[
                    styles.diffChip,
                    on
                      ? { backgroundColor: colors.ink }
                      : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
                  ]}>
                  <Txt variant="bodyStrong" style={{ fontSize: 11.5, color: on ? '#fff' : colors.muted2 }}>
                    {d[0]}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          {/* Draft toggle */}
          <Pressable onPress={() => setIsDraft((v) => !v)} style={styles.draftRow}>
            <View style={[styles.checkbox, isDraft && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
              {isDraft ? <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.bold }}>✓</Txt> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" style={{ fontSize: 13.5 }}>
                Save as draft
              </Txt>
              <Txt variant="small" style={{ marginTop: 1 }}>
                Kept in your bank but left out of practice and exams until you mark it ready.
              </Txt>
            </View>
          </Pressable>

          {/* Improve with AI */}
          <Pressable
            onPress={runReview}
            disabled={!canReview}
            style={({ pressed }) => [
              styles.improveBtn,
              { opacity: canReview ? (pressed ? 0.85 : 1) : 0.5 },
            ]}>
            {reviewing ? (
              <ActivityIndicator size="small" color={colors.accentInk} />
            ) : (
              <SparkleIcon size={17} color={colors.accentInk} />
            )}
            <Txt variant="bodyStrong" style={{ fontSize: 13.5, color: colors.accentInk }}>
              {reviewing ? 'Reviewing…' : review ? 'Review again with AI' : 'Improve with AI'}
            </Txt>
          </Pressable>
          <Txt variant="small" style={{ marginTop: 7, lineHeight: 18 }}>
            Have the AI score this note and suggest what would make it stronger before you save.
          </Txt>

          {reviewError ? (
            <View style={styles.reviewError}>
              <Txt variant="small" color={colors.danger} style={{ lineHeight: 18 }}>
                {reviewError}
              </Txt>
            </View>
          ) : null}

          {review ? <ReviewResult review={review} /> : null}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <Button
              title="Save & add another"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => save(true)}
              disabled={!canSave}
            />
            <Button
              title={isDraft ? 'Save draft' : 'Save note'}
              style={{ flex: 1 }}
              loading={busy}
              onPress={() => save(false)}
              disabled={!canSave}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Question body
// ---------------------------------------------------------------------------

function QuestionFields({
  text,
  setText,
  reference,
  setReference,
}: {
  text: string;
  setText: (s: string) => void;
  reference: string;
  setReference: (s: string) => void;
}) {
  return (
    <>
      <Txt variant="label" style={styles.label}>
        QUESTION *
      </Txt>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="What's the question you want to practice?"
        placeholderTextColor={colors.faint}
        multiline
        autoFocus
        style={[styles.input, styles.questionInput]}
      />

      <Txt variant="label" style={styles.label}>
        ANSWER
      </Txt>
      <Txt variant="small" style={{ marginBottom: 8, lineHeight: 18 }}>
        The reference answer you’ll be graded against. Leave it blank to have the AI grade
        you on your own merits instead.
      </Txt>
      <TextInput
        value={reference}
        onChangeText={setReference}
        placeholder="The answer you want to nail…"
        placeholderTextColor={colors.faint}
        multiline
        style={[styles.input, styles.questionInput]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Story body
// ---------------------------------------------------------------------------

function StoryFields({
  triggers,
  setTrigger,
  addTrigger,
  removeTrigger,
  hook,
  setHook,
  narrative,
  setNarrative,
  takeaway,
  setTakeaway,
}: {
  triggers: string[];
  setTrigger: (i: number, v: string) => void;
  addTrigger: () => void;
  removeTrigger: (i: number) => void;
  hook: string;
  setHook: (s: string) => void;
  narrative: string;
  setNarrative: (s: string) => void;
  takeaway: string;
  setTakeaway: (s: string) => void;
}) {
  return (
    <>
      <Txt variant="label" style={styles.label}>
        TRIGGERS *
      </Txt>
      <Txt variant="small" style={{ marginBottom: 8, lineHeight: 18 }}>
        Topics that should remind you to tell this story (e.g. travel mishaps, bad bosses).
        You’ll practise each one separately.
      </Txt>
      {triggers.map((t, i) => (
        <View key={i} style={styles.triggerRow}>
          <TextInput
            value={t}
            onChangeText={(v) => setTrigger(i, v)}
            placeholder={`Trigger ${i + 1}`}
            placeholderTextColor={colors.faint}
            autoFocus={i === 0}
            style={[styles.input, { flex: 1 }]}
          />
          {triggers.length > 1 ? (
            <Pressable onPress={() => removeTrigger(i)} hitSlop={8} style={styles.triggerRemove}>
              <CloseIcon size={16} color={colors.muted2} />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable onPress={addTrigger} style={styles.addTrigger}>
        <PlusIcon size={15} color={colors.accentInk} />
        <Txt variant="bodyStrong" style={{ fontSize: 13, color: colors.accentInk }}>
          Add trigger
        </Txt>
      </Pressable>

      <Txt variant="label" style={styles.label}>
        THE HOOK
      </Txt>
      <TextInput
        value={hook}
        onChangeText={setHook}
        placeholder="One-sentence teaser…"
        placeholderTextColor={colors.faint}
        multiline
        style={[styles.input, styles.refInput]}
      />

      <Txt variant="label" style={styles.label}>
        THE CORE NARRATIVE
      </Txt>
      <TextInput
        value={narrative}
        onChangeText={setNarrative}
        placeholder="Bullet points of the main events — keep it brief…"
        placeholderTextColor={colors.faint}
        multiline
        style={[styles.input, styles.questionInput]}
      />

      <Txt variant="label" style={styles.label}>
        THE TAKEAWAY
      </Txt>
      <TextInput
        value={takeaway}
        onChangeText={setTakeaway}
        placeholder="The punchline or realization…"
        placeholderTextColor={colors.faint}
        multiline
        style={[styles.input, styles.refInput]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// AI review result
// ---------------------------------------------------------------------------

function ReviewResult({ review }: { review: NoteReview }) {
  const passed = review.score >= NOTE_REVIEW_PASS;
  const tint = scoreColor(review.score);

  return (
    <View style={[styles.reviewCard, { borderColor: passed ? '#C2E2CE' : '#EAD8AE' }]}>
      <View style={styles.reviewHead}>
        <View style={[styles.scoreBadge, { backgroundColor: tint }]}>
          <Txt style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 16 }}>
            {review.score}
          </Txt>
          <Txt style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.semibold, fontSize: 10 }}>
            /10
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label" style={{ marginBottom: 2 }}>
            {passed ? 'AI REVIEW · READY' : 'AI REVIEW · NEEDS WORK'}
          </Txt>
          <Txt variant="bodyStrong" style={{ fontSize: 14 }}>
            {review.verdict}
          </Txt>
        </View>
      </View>

      {passed && review.missing.length === 0 && review.questions.length === 0 ? (
        <Txt variant="small" style={{ marginTop: 12, lineHeight: 19 }}>
          This note is solid as-is. Save it whenever you’re ready.
        </Txt>
      ) : null}

      {review.missing.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Txt variant="label" style={{ marginBottom: 6 }}>
            WHAT’S MISSING
          </Txt>
          {review.missing.map((m, i) => (
            <View key={i} style={styles.bulletRow}>
              <Txt variant="small" style={{ color: tint, marginTop: 1 }}>
                •
              </Txt>
              <Txt variant="small" style={{ flex: 1, lineHeight: 19 }}>
                {m}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      {review.questions.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Txt variant="label" style={{ marginBottom: 6 }}>
            ANSWER THESE TO IMPROVE IT
          </Txt>
          {review.questions.map((q, i) => (
            <View key={i} style={styles.bulletRow}>
              <Txt variant="small" style={{ color: colors.accentInk, marginTop: 1 }}>
                ?
              </Txt>
              <Txt variant="small" style={{ flex: 1, lineHeight: 19 }}>
                {q}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}

      {review.improved ? (
        <View style={{ marginTop: 14 }}>
          <Txt variant="label" style={{ marginBottom: 6 }}>
            SUGGESTED VERSION
          </Txt>
          <View style={styles.improvedBox}>
            <Txt variant="small" style={{ lineHeight: 20, color: colors.text }}>
              {review.improved}
            </Txt>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
    backgroundColor: colors.surface,
  },
  label: { marginBottom: 8, marginTop: 16, letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  questionInput: { minHeight: 84, fontSize: 16, fontFamily: fonts.medium, textAlignVertical: 'top' },
  refInput: { minHeight: 60, textAlignVertical: 'top' },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  triggerRemove: { padding: 4 },
  addTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7CCE6',
    backgroundColor: colors.accentTint,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 7 },
  diffRow: { flexDirection: 'row', gap: 7 },
  diffChip: {
    width: 40,
    paddingVertical: 11,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    marginTop: 22,
    padding: 13,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  improveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7CCE6',
    backgroundColor: colors.accentTint,
  },
  reviewError: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F1C9C3',
    backgroundColor: '#FBECEA',
  },
  reviewCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
    minWidth: 46,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 5 },
  improvedBox: {
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
