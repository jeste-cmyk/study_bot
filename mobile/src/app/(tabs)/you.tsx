import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, fonts, radius } from '@/theme';
import { Button, Card, Txt } from '@/ui/primitives';
import { useStore } from '@/store/useStore';
import { dueCount } from '@/domain/selection';
import { lastScore, noteAttempts } from '@/domain/types';

export default function YouScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useStore((s) => s.user);
  const notes = useStore((s) => s.notes);
  const signOut = useStore((s) => s.signOut);
  const mode = useStore((s) => s.authMode);

  const stats = useMemo(() => {
    const reps = notes.reduce((n, note) => n + noteAttempts(note).length, 0);
    const scored = notes.map(lastScore).filter((s): s is number => s != null);
    const avg = scored.length ? (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1) : '—';
    return { total: notes.length, due: dueCount(notes), reps, avg };
  }, [notes]);

  const initial = (user?.name ?? user?.email ?? 'U').charAt(0).toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}>
        <View style={{ height: insets.top + 8 }} />
        <Txt variant="h2" style={{ marginBottom: 18 }}>
          You
        </Txt>

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={styles.avatar}>
            <Txt style={{ fontFamily: fonts.bold, fontSize: 18, color: colors.textSecondary }}>
              {initial}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="title">{user?.name ?? 'You'}</Txt>
            <Txt variant="small">{user?.email ?? ''}</Txt>
          </View>
        </Card>

        <View style={styles.statGrid}>
          {[
            [String(stats.total), 'notes'],
            [String(stats.due), 'due now'],
            [String(stats.reps), 'total reps'],
            [String(stats.avg), 'avg score'],
          ].map(([n, l]) => (
            <Card key={l} style={styles.statCard}>
              <Txt style={{ fontFamily: fonts.monoSemibold, fontSize: 24, color: colors.ink }}>{n}</Txt>
              <Txt variant="small">{l}</Txt>
            </Card>
          ))}
        </View>

        <Card style={{ marginTop: 14 }}>
          <Txt variant="label" style={{ marginBottom: 8 }}>
            SYNC
          </Txt>
          <Txt variant="body">
            {mode === 'supabase'
              ? 'Signed in with Supabase. Your bank syncs across web and mobile.'
              : 'Running in local mode on this device. Add Supabase keys in .env to enable cross-device sync.'}
          </Txt>
        </Card>

        <Button title="Sign out" variant="secondary" style={{ marginTop: 22 }} onPress={handleSignOut} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#E4E1DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  statCard: { width: '47.5%', gap: 2 },
});
