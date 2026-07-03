import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  CATEGORIES,
  categoryStyle,
  colors,
  fonts,
  radius,
  scoreColor,
  statusStyle,
} from '@/theme';
import { Button, Card, Pill, Tag, Txt } from '@/ui/primitives';
import { ChevronLeft, CloseIcon, PlusIcon } from '@/ui/icons';
import { useStore } from '@/store/useStore';
import {
  isStory,
  isDue,
  lastScore,
  noteAttempts,
  noteReviewStatus,
  practiceMode,
  reviewStatus,
  type Category,
  type Difficulty,
  type Note,
  type Question,
  type Story,
} from '@/domain/types';
import { formatInterval } from '@/domain/spacedRepetition';

const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

function nextReviewLabel(dueAt: string): { text: string; color: string } {
  const now = new Date();
  const due = new Date(dueAt);
  const ms = due.getTime() - now.getTime();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (ms <= 0) return { text: 'Today · due', color: colors.warn };
  if (days <= 0) return { text: 'Later today', color: colors.warn };
  if (days === 1) return { text: 'Tomorrow', color: colors.textSecondary };
  return { text: `In ${days} days`, color: colors.textSecondary };
}

type EditTrigger = { id?: string; text: string };

export default function NoteDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = useStore((s) => s.notes.find((n) => n.id === id));
  const updateNote = useStore((s) => s.updateNote);
  const deleteNote = useStore((s) => s.deleteNote);

  const [editing, setEditing] = useState(false);
  // Question edit state
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  const [company, setCompany] = useState('');
  // Story edit state
  const [hook, setHook] = useState('');
  const [narrative, setNarrative] = useState('');
  const [takeaway, setTakeaway] = useState('');
  const [editTriggers, setEditTriggers] = useState<EditTrigger[]>([]);
  // Shared
  const [category, setCategory] = useState<Category | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);

  const sparks = useMemo(() => {
    if (!note) return [];
    return [...noteAttempts(note)].reverse().slice(-6).map((a) => a.aiScore);
  }, [note]);

  if (!note) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Txt variant="small">Note not found.</Txt>
        <Button title="Back" variant="secondary" style={{ marginTop: 14 }} onPress={() => router.back()} />
      </View>
    );
  }

  const story = isStory(note);
  const c = categoryStyle(note.category);

  const startEdit = () => {
    setCategory(note.category);
    setDifficulty(note.difficulty);
    if (isStory(note)) {
      setHook(note.hook);
      setNarrative(note.narrative);
      setTakeaway(note.takeaway);
      setEditTriggers(
        note.triggers.length
          ? note.triggers.map((t) => ({ id: t.id, text: t.text }))
          : [{ text: '' }],
      );
    } else {
      setText(note.text);
      setReference(note.reference ?? '');
      setCompany(note.company ?? '');
    }
    setEditing(true);
  };

  const saveEdit = async () => {
    if (isStory(note)) {
      await updateNote(note.id, {
        hook,
        narrative,
        takeaway,
        triggers: editTriggers.map((t) => ({ id: t.id, text: t.text })).filter((t) => t.text.trim()),
        category,
        difficulty,
      });
    } else {
      await updateNote(note.id, {
        text,
        reference: reference.trim() || null,
        category,
        company: company.trim() || null,
        difficulty,
      });
    }
    setEditing(false);
  };

  const toggleStatus = async () => {
    await updateNote(note.id, { status: note.status === 'draft' ? 'ready' : 'draft' });
  };

  const remove = async () => {
    await deleteNote(note.id);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerSide}>
          <ChevronLeft size={20} color={colors.accentInk} />
          <Txt variant="bodyStrong" color={colors.accentInk}>
            Bank
          </Txt>
        </Pressable>
        <Txt variant="mono">{note.id.slice(0, 6).toUpperCase()}</Txt>
        {editing ? (
          <Pressable onPress={() => setEditing(false)} hitSlop={10} style={styles.headerSideEnd}>
            <Txt variant="bodyStrong" color={colors.muted2}>
              Cancel
            </Txt>
          </Pressable>
        ) : (
          <Pressable onPress={startEdit} hitSlop={10} style={styles.headerSideEnd}>
            <Txt variant="bodyStrong" color={colors.accentInk}>
              Edit
            </Txt>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {editing ? (
          story ? (
            <StoryEdit
              hook={hook}
              setHook={setHook}
              narrative={narrative}
              setNarrative={setNarrative}
              takeaway={takeaway}
              setTakeaway={setTakeaway}
              triggers={editTriggers}
              setTriggers={setEditTriggers}
              category={category}
              setCategory={setCategory}
              difficulty={difficulty}
              setDifficulty={setDifficulty}
              onSave={saveEdit}
            />
          ) : (
            <QuestionEdit
              text={text}
              setText={setText}
              reference={reference}
              setReference={setReference}
              company={company}
              setCompany={setCompany}
              category={category}
              setCategory={setCategory}
              difficulty={difficulty}
              setDifficulty={setDifficulty}
              onSave={saveEdit}
            />
          )
        ) : (
          <>
            <View style={styles.metaRow}>
              {story ? <Tag label="Story" bg="#F2ECFB" fg="#6A3FB0" /> : null}
              {note.status === 'draft' ? <Tag label="Draft" bg="#EFEDE8" fg="#8A867C" /> : null}
              <Pill label={note.category ?? 'General'} bg={c.bg} fg={c.fg} />
              <Txt variant="mono">
                {[story ? null : (note as Question).company, note.difficulty]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
            </View>

            {story ? (
              <StoryView note={note as Story} />
            ) : (
              <QuestionView note={note as Question} sparks={sparks} />
            )}

            <Button
              title={
                story
                  ? 'Practice this story →'
                  : isDue(note as Question)
                    ? 'Practice this now →'
                    : 'Practice anyway →'
              }
              variant="dark"
              onPress={() => router.push(`/practice?focus=${note.id}`)}
            />
            <Pressable onPress={toggleStatus} style={{ marginTop: 14, alignSelf: 'center' }} hitSlop={8}>
              <Txt variant="small" color={colors.accentInk} style={{ fontFamily: fonts.semibold }}>
                {note.status === 'draft' ? 'Mark as ready for practice' : 'Move to drafts'}
              </Txt>
            </Pressable>
            <Pressable onPress={remove} style={{ marginTop: 14, alignSelf: 'center' }} hitSlop={8}>
              <Txt variant="small" color={colors.danger}>
                Delete note
              </Txt>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Question — view
// ---------------------------------------------------------------------------

function QuestionView({ note, sparks }: { note: Question; sparks: number[] }) {
  const review = nextReviewLabel(note.sr.dueAt);
  const mode = practiceMode(note);
  return (
    <>
      <Txt variant="h3" style={{ lineHeight: 25, marginBottom: 16 }}>
        {note.text}
      </Txt>

      <Card style={{ marginBottom: 12 }}>
        <Txt variant="label" style={{ marginBottom: 8 }}>
          {mode === 'A' ? 'REFERENCE ANSWER · MODE A' : 'NO REFERENCE YET · MODE B'}
        </Txt>
        {note.reference ? (
          <Txt variant="body" style={{ color: colors.text }}>
            {note.reference}
          </Txt>
        ) : (
          <Txt variant="small" style={{ lineHeight: 19 }}>
            The AI will draft a model answer the first time you practice — save it as your reference
            to switch this question to Mode A.
          </Txt>
        )}
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <Txt variant="label" style={{ marginBottom: 12 }}>
          SPACED REPETITION
        </Txt>
        <View style={styles.srTop}>
          <Txt variant="body" style={{ color: colors.textSecondary }}>
            Next review
          </Txt>
          <Txt variant="bodyStrong" style={{ color: review.color, fontFamily: fonts.bold }}>
            {review.text}
          </Txt>
        </View>
        <View style={styles.srStats}>
          <Stat value={String(note.sr.reps)} label="reps" />
          <Stat value={formatInterval(note.sr.intervalDays)} label="interval" />
          <View style={{ flex: 1 }}>
            <Txt variant="monoSmall" style={{ marginBottom: 5 }}>
              history
            </Txt>
            <View style={styles.sparkRow}>
              {sparks.length === 0 ? (
                <Txt variant="small" style={{ color: colors.faint }}>
                  no attempts yet
                </Txt>
              ) : (
                sparks.map((v, i) => (
                  <View
                    key={i}
                    style={{ flex: 1, height: 6 + v * 2.4, backgroundColor: scoreColor(v), borderRadius: 2 }}
                  />
                ))
              )}
            </View>
          </View>
        </View>
      </Card>

      {note.attempts.length > 0 ? <RecentAttempts note={note} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Story — view
// ---------------------------------------------------------------------------

function StoryView({ note }: { note: Story }) {
  return (
    <>
      <Txt variant="h3" style={{ lineHeight: 25, marginBottom: 16 }}>
        {note.hook || 'Untitled story'}
      </Txt>

      <Section label="THE HOOK" body={note.hook} />
      <Section label="THE CORE NARRATIVE" body={note.narrative} />
      <Section label="THE TAKEAWAY" body={note.takeaway} />

      <Card style={{ marginBottom: 14 }}>
        <Txt variant="label" style={{ marginBottom: 10 }}>
          TRIGGERS & SCHEDULE
        </Txt>
        {note.triggers.length === 0 ? (
          <Txt variant="small">No triggers yet — add one to practise this story.</Txt>
        ) : (
          note.triggers.map((t, i) => {
            const st = statusStyle(reviewStatus(t));
            const review = nextReviewLabel(t.sr.dueAt);
            return (
              <View
                key={t.id}
                style={[styles.triggerScheduleRow, i < note.triggers.length - 1 && styles.attemptDivider]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Txt variant="bodyStrong" style={{ fontSize: 13.5, color: colors.text, marginBottom: 4 }}>
                    {t.text}
                  </Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Tag label={st.label} bg={st.bg} fg={st.fg} />
                    <Txt variant="monoSmall">{review.text}</Txt>
                  </View>
                </View>
                <Txt
                  variant="mono"
                  style={{ fontFamily: fonts.monoSemibold, color: scoreColor(t.attempts[0]?.aiScore ?? null) }}>
                  {t.attempts[0] ? `${t.attempts[0].aiScore}/10` : '—'}
                </Txt>
              </View>
            );
          })
        )}
      </Card>

      {noteAttempts(note).length > 0 ? <RecentAttempts note={note} /> : null}
    </>
  );
}

function Section({ label, body }: { label: string; body: string }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <Txt variant="label" style={{ marginBottom: 8 }}>
        {label}
      </Txt>
      {body.trim() ? (
        <Txt variant="body" style={{ color: colors.text }}>
          {body}
        </Txt>
      ) : (
        <Txt variant="small" style={{ color: colors.faint }}>
          —
        </Txt>
      )}
    </Card>
  );
}

function RecentAttempts({ note }: { note: Note }) {
  const attempts = noteAttempts(note).slice(0, 3);
  return (
    <Card style={{ marginBottom: 16 }}>
      <Txt variant="label" style={{ marginBottom: 8 }}>
        RECENT ATTEMPTS
      </Txt>
      {attempts.map((a, i) => (
        <View key={a.id} style={[styles.attemptRow, i < attempts.length - 1 && styles.attemptDivider]}>
          <Txt variant="mono">
            {new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
            {a.mode}
          </Txt>
          <Txt variant="bodyStrong" style={{ color: scoreColor(a.aiScore), fontSize: 12.5 }}>
            {a.aiScore}/10 · {a.rating[0].toUpperCase() + a.rating.slice(1)}
          </Txt>
        </View>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared edit controls
// ---------------------------------------------------------------------------

function CategoryPicker({
  category,
  setCategory,
}: {
  category: Category | null;
  setCategory: (c: Category | null) => void;
}) {
  return (
    <>
      <Txt variant="label" style={styles.editLabel}>
        CATEGORY
      </Txt>
      <View style={styles.chipWrap}>
        {CATEGORIES.map((cat) => {
          const cs = categoryStyle(cat);
          const on = category === cat;
          return (
            <Pressable
              key={cat}
              onPress={() => setCategory(on ? null : cat)}
              style={[
                styles.chip,
                on
                  ? { backgroundColor: cs.bg }
                  : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
              ]}>
              <Txt variant="bodyStrong" style={{ fontSize: 12.5, color: on ? cs.fg : colors.muted2 }}>
                {cat}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function DifficultyPicker({
  difficulty,
  setDifficulty,
}: {
  difficulty: Difficulty | null;
  setDifficulty: (d: Difficulty | null) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 7 }}>
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
  );
}

function QuestionEdit({
  text,
  setText,
  reference,
  setReference,
  company,
  setCompany,
  category,
  setCategory,
  difficulty,
  setDifficulty,
  onSave,
}: {
  text: string;
  setText: (s: string) => void;
  reference: string;
  setReference: (s: string) => void;
  company: string;
  setCompany: (s: string) => void;
  category: Category | null;
  setCategory: (c: Category | null) => void;
  difficulty: Difficulty | null;
  setDifficulty: (d: Difficulty | null) => void;
  onSave: () => void;
}) {
  return (
    <>
      <Txt variant="label" style={styles.editLabel}>
        QUESTION
      </Txt>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        style={[styles.input, { minHeight: 80, fontSize: 16, fontFamily: fonts.medium }]}
      />

      <Txt variant="label" style={styles.editLabel}>
        REFERENCE ANSWER
      </Txt>
      <TextInput
        value={reference}
        onChangeText={setReference}
        multiline
        placeholder="Leave empty for Mode B"
        placeholderTextColor={colors.faint}
        style={[styles.input, { minHeight: 90 }]}
      />

      <CategoryPicker category={category} setCategory={setCategory} />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Txt variant="label" style={styles.editLabel}>
            COMPANY
          </Txt>
          <TextInput value={company} onChangeText={setCompany} style={styles.input} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label" style={styles.editLabel}>
            DIFFICULTY
          </Txt>
          <DifficultyPicker difficulty={difficulty} setDifficulty={setDifficulty} />
        </View>
      </View>

      <Button title="Save changes" style={{ marginTop: 24 }} onPress={onSave} />
    </>
  );
}

function StoryEdit({
  hook,
  setHook,
  narrative,
  setNarrative,
  takeaway,
  setTakeaway,
  triggers,
  setTriggers,
  category,
  setCategory,
  difficulty,
  setDifficulty,
  onSave,
}: {
  hook: string;
  setHook: (s: string) => void;
  narrative: string;
  setNarrative: (s: string) => void;
  takeaway: string;
  setTakeaway: (s: string) => void;
  triggers: EditTrigger[];
  setTriggers: (t: EditTrigger[]) => void;
  category: Category | null;
  setCategory: (c: Category | null) => void;
  difficulty: Difficulty | null;
  setDifficulty: (d: Difficulty | null) => void;
  onSave: () => void;
}) {
  const setText = (i: number, text: string) =>
    setTriggers(triggers.map((t, idx) => (idx === i ? { ...t, text } : t)));
  const add = () => setTriggers([...triggers, { text: '' }]);
  const remove = (i: number) =>
    setTriggers(triggers.length === 1 ? triggers : triggers.filter((_, idx) => idx !== i));

  return (
    <>
      <Txt variant="label" style={styles.editLabel}>
        TRIGGERS
      </Txt>
      {triggers.map((t, i) => (
        <View key={i} style={styles.triggerRow}>
          <TextInput
            value={t.text}
            onChangeText={(v) => setText(i, v)}
            placeholder={`Trigger ${i + 1}`}
            placeholderTextColor={colors.faint}
            style={[styles.input, { flex: 1 }]}
          />
          {triggers.length > 1 ? (
            <Pressable onPress={() => remove(i)} hitSlop={8} style={{ padding: 4 }}>
              <CloseIcon size={16} color={colors.muted2} />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable onPress={add} style={styles.addTrigger}>
        <PlusIcon size={15} color={colors.accentInk} />
        <Txt variant="bodyStrong" style={{ fontSize: 13, color: colors.accentInk }}>
          Add trigger
        </Txt>
      </Pressable>

      <Txt variant="label" style={styles.editLabel}>
        THE HOOK
      </Txt>
      <TextInput
        value={hook}
        onChangeText={setHook}
        multiline
        placeholder="One-sentence teaser…"
        placeholderTextColor={colors.faint}
        style={[styles.input, { minHeight: 60 }]}
      />

      <Txt variant="label" style={styles.editLabel}>
        THE CORE NARRATIVE
      </Txt>
      <TextInput
        value={narrative}
        onChangeText={setNarrative}
        multiline
        placeholder="Bullet points of the main events…"
        placeholderTextColor={colors.faint}
        style={[styles.input, { minHeight: 90 }]}
      />

      <Txt variant="label" style={styles.editLabel}>
        THE TAKEAWAY
      </Txt>
      <TextInput
        value={takeaway}
        onChangeText={setTakeaway}
        multiline
        placeholder="The punchline or realization…"
        placeholderTextColor={colors.faint}
        style={[styles.input, { minHeight: 60 }]}
      />

      <CategoryPicker category={category} setCategory={setCategory} />

      <Txt variant="label" style={styles.editLabel}>
        DIFFICULTY
      </Txt>
      <DifficultyPicker difficulty={difficulty} setDifficulty={setDifficulty} />

      <Button title="Save changes" style={{ marginTop: 24 }} onPress={onSave} />
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <Txt style={{ fontFamily: fonts.monoSemibold, fontSize: 18, color: colors.ink }}>{value}</Txt>
      <Txt variant="monoSmall">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  headerSide: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 70 },
  headerSideEnd: { width: 70, alignItems: 'flex-end' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 11, flexWrap: 'wrap' },
  srTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  srStats: { flexDirection: 'row', gap: 18, alignItems: 'flex-end' },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 30 },
  triggerScheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  attemptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  attemptDivider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  editLabel: { marginTop: 16, marginBottom: 8, letterSpacing: 0.4 },
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
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: radius.sm, paddingHorizontal: 13, paddingVertical: 7 },
  diffChip: { width: 40, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center' },
});
