/**
 * The story authoring surface — shared by the capture screen (new story) and
 * the note detail screen (editing a saved one) so a story always opens into the
 * same experience: a title, the raw free-text box (Box 1), an "Analyze with AI"
 * action, the polished storytelling box (Box 2), an editable score, and the
 * AI-generated trigger list.
 *
 * The component is controlled: the parent owns the values and setters. Analyze
 * is handled here — it fills the title / storytelling / score / triggers and
 * appends its follow-up questions to the end of the raw box, never rewriting
 * the words the user already typed.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, fonts, radius, scoreColor } from '@/theme';
import { Txt } from '@/ui/primitives';
import { CloseIcon, PlusIcon, SparkleIcon } from '@/ui/icons';
import type { Category, StoryMode } from '@/domain/types';
import { appendQuestions, isSeedTemplate, templateForMode } from '@/domain/story';
import { analyzeStory } from '@/services/ai';

export type EditableTrigger = { id?: string; text: string };

const MODES: { key: StoryMode; label: string; hint: string }[] = [
  {
    key: 'interview',
    label: 'Interview',
    hint: 'A professional answer — structured, with impact and a clear point.',
  },
  {
    key: 'personal',
    label: 'For friends',
    hint: 'A story told in conversation — vivid, casual, easy to keep talking about.',
  },
];

interface StoryEditorProps {
  mode: StoryMode;
  setMode: (m: StoryMode) => void;
  title: string;
  setTitle: (s: string) => void;
  rawStory: string;
  setRawStory: (s: string) => void;
  storytelling: string;
  setStorytelling: (s: string) => void;
  score: number | null;
  setScore: (n: number | null) => void;
  triggers: EditableTrigger[];
  setTriggers: (t: EditableTrigger[]) => void;
  conversationHooks: string[];
  setConversationHooks: (h: string[]) => void;
  /** Passed to the analyzer for context; not edited here. */
  category: Category | null;
  autoFocusRaw?: boolean;
}

/** Union of the current triggers with AI-generated ones, preserving SR by id. */
function mergeTriggers(
  existing: EditableTrigger[],
  generated: string[],
): EditableTrigger[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set(existing.map((t) => norm(t.text)).filter(Boolean));
  const merged = existing.filter((t) => t.text.trim());
  for (const g of generated) {
    if (g.trim() && !seen.has(norm(g))) {
      merged.push({ text: g.trim() });
      seen.add(norm(g));
    }
  }
  return merged.length ? merged : [{ text: '' }];
}

export function StoryEditor(props: StoryEditorProps) {
  const {
    mode,
    setMode,
    title,
    setTitle,
    rawStory,
    setRawStory,
    storytelling,
    setStorytelling,
    score,
    setScore,
    triggers,
    setTriggers,
    conversationHooks,
    setConversationHooks,
    category,
    autoFocusRaw,
  } = props;

  const personal = mode === 'personal';

  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);

  const canAnalyze = !analyzing && rawStory.trim().length > 0;

  const switchMode = (next: StoryMode) => {
    if (next === mode) return;
    // Only reseed the raw box when the user hasn't written anything of their own.
    if (isSeedTemplate(rawStory)) setRawStory(templateForMode(next));
    setMode(next);
  };

  const runAnalyze = async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError(null);
    try {
      const a = await analyzeStory({ rawStory, mode, category });
      if (a.title) setTitle(a.title);
      setStorytelling(a.storytelling);
      setScore(a.score);
      setRawStory(appendQuestions(rawStory, a.questions));
      setTriggers(mergeTriggers(triggers, a.triggers));
      setConversationHooks(a.conversationHooks);
      setAnalyzed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the analyzer.');
    } finally {
      setAnalyzing(false);
    }
  };

  const setTriggerText = (i: number, text: string) =>
    setTriggers(triggers.map((t, idx) => (idx === i ? { ...t, text } : t)));
  const addTrigger = () => setTriggers([...triggers, { text: '' }]);
  const removeTrigger = (i: number) =>
    setTriggers(triggers.length === 1 ? triggers : triggers.filter((_, idx) => idx !== i));

  const setHookText = (i: number, text: string) =>
    setConversationHooks(conversationHooks.map((h, idx) => (idx === i ? text : h)));
  const addHook = () => setConversationHooks([...conversationHooks, '']);
  const removeHook = (i: number) =>
    setConversationHooks(conversationHooks.filter((_, idx) => idx !== i));

  const bumpScore = (delta: number) => {
    const base = score ?? 0;
    setScore(Math.max(0, Math.min(10, base + delta)));
  };

  return (
    <>
      {/* Mode — interview vs conversational */}
      <Txt variant="label" style={[styles.label, { marginTop: 4 }]}>
        STORY FOR
      </Txt>
      <View style={styles.segment}>
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => switchMode(m.key)}
              style={[
                styles.segmentBtn,
                on
                  ? { backgroundColor: colors.ink }
                  : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
              ]}>
              <Txt
                variant="bodyStrong"
                style={{ fontSize: 13.5, color: on ? '#fff' : colors.textSecondary }}>
                {m.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <Txt variant="small" style={{ marginTop: 7, lineHeight: 18 }}>
        {MODES.find((m) => m.key === mode)?.hint}
      </Txt>

      {/* Title (AI-filled) */}
      <Txt variant="label" style={styles.label}>
        TITLE
      </Txt>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="The AI names this when you analyze — or write your own"
        placeholderTextColor={colors.faint}
        style={[styles.input, styles.titleInput]}
      />

      {/* Box 1 — the raw account */}
      <Txt variant="label" style={styles.label}>
        YOUR STORY *
      </Txt>
      <Txt variant="small" style={{ marginBottom: 8, lineHeight: 18 }}>
        {personal
          ? 'Just what happened — the moment, the people, how it felt. The AI won’t rewrite this box; it only adds follow-up questions at the end.'
          : 'Just what happened — the facts. The AI won’t rewrite this box; it only adds follow-up questions at the end.'}
      </Txt>
      <TextInput
        value={rawStory}
        onChangeText={setRawStory}
        placeholder="What happened?"
        placeholderTextColor={colors.faint}
        multiline
        autoFocus={autoFocusRaw}
        style={[styles.input, styles.rawInput]}
      />

      {/* Analyze with AI */}
      <Pressable
        onPress={runAnalyze}
        disabled={!canAnalyze}
        style={({ pressed }) => [
          styles.analyzeBtn,
          { opacity: canAnalyze ? (pressed ? 0.85 : 1) : 0.5 },
        ]}>
        {analyzing ? (
          <ActivityIndicator size="small" color={colors.accentInk} />
        ) : (
          <SparkleIcon size={17} color={colors.accentInk} />
        )}
        <Txt variant="bodyStrong" style={{ fontSize: 13.5, color: colors.accentInk }}>
          {analyzing ? 'Analyzing…' : analyzed ? 'Analyze again with AI' : 'Analyze with AI'}
        </Txt>
      </Pressable>
      <Txt variant="small" style={{ marginTop: 7, lineHeight: 18 }}>
        {personal
          ? 'Rewrites your notes as a story to tell out loud, scores how well it lands, suggests when it comes up, and gives you ways to keep the conversation going.'
          : 'Turns your notes into a storytelling version, scores it, generates triggers, and asks for any missing details.'}
      </Txt>

      {error ? (
        <View style={styles.errorBox}>
          <Txt variant="small" color={colors.danger} style={{ lineHeight: 18 }}>
            {error}
          </Txt>
        </View>
      ) : null}

      {/* Box 2 — the storytelling version */}
      <Txt variant="label" style={styles.label}>
        STORYTELLING VERSION
      </Txt>
      <TextInput
        value={storytelling}
        onChangeText={setStorytelling}
        placeholder="Analyze to draft this — or write it yourself. This is what you’re graded against."
        placeholderTextColor={colors.faint}
        multiline
        style={[styles.input, styles.storyInput]}
      />

      {/* Score (editable) */}
      <Txt variant="label" style={styles.label}>
        SCORE
      </Txt>
      <View style={styles.scoreRow}>
        <View style={[styles.scoreBadge, { backgroundColor: scoreColor(score) }]}>
          <Txt style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 16 }}>
            {score == null ? '—' : score}
          </Txt>
          <Txt style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.semibold, fontSize: 10 }}>
            /10
          </Txt>
        </View>
        <Pressable onPress={() => bumpScore(-1)} hitSlop={8} style={styles.stepBtn}>
          <Txt variant="bodyStrong" style={{ fontSize: 18, color: colors.textSecondary }}>
            −
          </Txt>
        </Pressable>
        <Pressable onPress={() => bumpScore(1)} hitSlop={8} style={styles.stepBtn}>
          <Txt variant="bodyStrong" style={{ fontSize: 18, color: colors.textSecondary }}>
            +
          </Txt>
        </Pressable>
        <Txt variant="small" style={{ flex: 1, marginLeft: 4, lineHeight: 17 }}>
          {score == null ? 'Set by the AI — tap to adjust.' : 'AI score — adjust to taste.'}
        </Txt>
      </View>

      {/* Triggers (AI-generated, editable) */}
      <Txt variant="label" style={styles.label}>
        TRIGGERS
      </Txt>
      <Txt variant="small" style={{ marginBottom: 8, lineHeight: 18 }}>
        {personal
          ? 'Moments in a conversation when this story naturally comes up. The AI suggests these; after you tell the story in practice, you’ll recall them from memory.'
          : 'Interview prompts this story answers. The AI suggests these; you practise each one separately.'}
      </Txt>
      {triggers.map((t, i) => (
        <View key={t.id ?? `new-${i}`} style={styles.triggerRow}>
          <TextInput
            value={t.text}
            onChangeText={(v) => setTriggerText(i, v)}
            placeholder={`Trigger ${i + 1}`}
            placeholderTextColor={colors.faint}
            style={[styles.input, { flex: 1 }]}
          />
          {triggers.length > 1 ? (
            <Pressable onPress={() => removeTrigger(i)} hitSlop={8} style={{ padding: 4 }}>
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

      {/* Conversation directions (personal mode only) */}
      {personal ? (
        <>
          <Txt variant="label" style={styles.label}>
            KEEP THE CONVERSATION GOING
          </Txt>
          <Txt variant="small" style={{ marginBottom: 8, lineHeight: 18 }}>
            Ways to hand the conversation back after you tell it — questions to ask, opinions
            to share, related or unrelated threads to branch into.
          </Txt>
          {conversationHooks.length === 0 ? (
            <Txt variant="small" style={{ color: colors.faint, marginBottom: 8 }}>
              Analyze to generate these, or add your own.
            </Txt>
          ) : (
            conversationHooks.map((h, i) => (
              <View key={`hook-${i}`} style={styles.triggerRow}>
                <TextInput
                  value={h}
                  onChangeText={(v) => setHookText(i, v)}
                  placeholder={`Direction ${i + 1}`}
                  placeholderTextColor={colors.faint}
                  multiline
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable onPress={() => removeHook(i)} hitSlop={8} style={{ padding: 4 }}>
                  <CloseIcon size={16} color={colors.muted2} />
                </Pressable>
              </View>
            ))
          )}
          <Pressable onPress={addHook} style={styles.addTrigger}>
            <PlusIcon size={15} color={colors.accentInk} />
            <Txt variant="bodyStrong" style={{ fontSize: 13, color: colors.accentInk }}>
              Add direction
            </Txt>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
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
    textAlignVertical: 'top',
  },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  titleInput: { fontSize: 16, fontFamily: fonts.medium },
  rawInput: { minHeight: 200, fontSize: 15, lineHeight: 22 },
  storyInput: { minHeight: 120, fontSize: 15, lineHeight: 22 },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7CCE6',
    backgroundColor: colors.accentTint,
  },
  errorBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F1C9C3',
    backgroundColor: '#FBECEA',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  stepBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
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
});
