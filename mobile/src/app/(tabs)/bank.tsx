import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { categoryStyle, colors, fonts, radius, scoreColor, statusStyle } from '@/theme';
import { Pill, Tag, Txt } from '@/ui/primitives';
import { PlusIcon, SearchIcon } from '@/ui/icons';
import { useStore } from '@/store/useStore';
import { dueCount } from '@/domain/selection';
import { isStory, lastScore, noteReviewStatus, noteTitle } from '@/domain/types';

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'Behavioral', label: 'Behavioral' },
  { key: 'Case', label: 'Case' },
  { key: 'Technical', label: 'Tech' },
  { key: 'Fit', label: 'Fit' },
];

export default function BankScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notes = useStore((s) => s.notes);

  const [query, setQuery] = useState('');
  // Multi-select category filter (PRD §5.3.2). Empty = all.
  const [active, setActive] = useState<string[]>([]);
  const [hideDrafts, setHideDrafts] = useState(false);

  const toggle = (key: string) => {
    if (key === 'all') return setActive([]);
    setActive((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((item) => {
      if (hideDrafts && item.status === 'draft') return false;
      if (active.length > 0 && (!item.category || !active.includes(item.category))) return false;
      if (q) {
        const company = isStory(item) ? '' : item.company ?? '';
        if (!noteTitle(item).toLowerCase().includes(q) && !company.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [notes, query, active, hideDrafts]);

  const due = dueCount(notes);
  const draftCount = notes.filter((n) => n.status === 'draft').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ height: insets.top + 8 }} />
      <View style={{ paddingHorizontal: 20 }}>
        <Txt variant="h2">Question bank</Txt>
        <Txt variant="small" style={{ marginTop: 3, marginBottom: 13 }}>
          {notes.length} notes · {due} due now
        </Txt>

        {/* Search */}
        <View style={styles.search}>
          <SearchIcon size={15} color={colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
          />
        </View>

        {/* Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingVertical: 12 }}>
          {FILTERS.map((f) => {
            const isAll = f.key === 'all';
            const on = isAll ? active.length === 0 : active.includes(f.key);
            return (
              <Pressable
                key={f.key}
                onPress={() => toggle(f.key)}
                style={[
                  styles.filter,
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
          {draftCount > 0 ? (
            <Pressable
              onPress={() => setHideDrafts((v) => !v)}
              style={[
                styles.filter,
                hideDrafts
                  ? { backgroundColor: colors.ink, borderColor: colors.ink }
                  : { backgroundColor: colors.surface, borderColor: colors.borderStrong },
              ]}>
              <Txt
                variant="bodyStrong"
                style={{ fontSize: 12.5, color: hideDrafts ? '#fff' : colors.textSecondary }}>
                {hideDrafts ? 'Drafts hidden' : `Hide drafts (${draftCount})`}
              </Txt>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 96, paddingTop: 2 }}
        showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <Txt variant="small" style={{ textAlign: 'center', marginTop: 40 }}>
            No notes match.
          </Txt>
        ) : (
          filtered.map((n) => {
            const c = categoryStyle(n.category);
            const st = statusStyle(noteReviewStatus(n));
            const score = lastScore(n);
            const story = isStory(n);
            return (
              <Pressable
                key={n.id}
                onPress={() => router.push(`/question/${n.id}`)}
                style={[styles.card, n.status === 'draft' && styles.draftCard]}>
                {story || n.status === 'draft' ? (
                  <View style={styles.titleRow}>
                    {story ? <Tag label="Story" bg="#F2ECFB" fg="#6A3FB0" /> : null}
                    {n.status === 'draft' ? <Tag label="Draft" bg="#EFEDE8" fg="#8A867C" /> : null}
                  </View>
                ) : null}
                <Txt variant="bodyStrong" style={{ color: colors.text, lineHeight: 19, marginBottom: 10 }}>
                  {noteTitle(n)}
                </Txt>
                <View style={styles.metaRow}>
                  <Pill label={n.category ?? 'General'} bg={c.bg} fg={c.fg} />
                  {story ? (
                    <Txt variant="monoSmall">{n.triggers.length} triggers</Txt>
                  ) : (
                    <Tag label={st.label} bg={st.bg} fg={st.fg} />
                  )}
                  <Txt
                    variant="mono"
                    style={{ marginLeft: 'auto', fontFamily: fonts.monoSemibold, color: scoreColor(score) }}>
                    {score == null ? '—' : `${score}/10`}
                  </Txt>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Creating a note is "add to the bank", so the + lives here as a local FAB. */}
      <Pressable
        style={styles.fab}
        onPress={() => router.push('/capture')}
        hitSlop={8}
        accessibilityLabel="Add note">
        <PlusIcon size={26} color="#fff" strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 13,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
  },
  filter: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 9,
  },
  draftCard: { borderStyle: 'dashed', backgroundColor: colors.surfaceAlt },
  titleRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
