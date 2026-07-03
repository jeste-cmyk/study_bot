import type { ReactElement } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';

import { colors, fonts } from '@/theme';
import { BankIcon, StudyIcon, YouIcon, type IconProps } from '@/ui/icons';

interface Slot {
  key: string;
  label: string;
  href: string;
  Icon: (p: IconProps) => ReactElement;
}

// Home is the study session, so it leads the bar. Creating notes now lives as a
// local FAB inside the Bank, so the bar is a plain three-tab row.
const TABS: Slot[] = [
  { key: 'study', label: 'Study', href: '/(tabs)', Icon: StudyIcon },
  { key: 'bank', label: 'Bank', href: '/(tabs)/bank', Icon: BankIcon },
  { key: 'you', label: 'You', href: '/(tabs)/you', Icon: YouIcon },
];

function isActive(pathname: string, key: string): boolean {
  if (key === 'study') return pathname === '/' || pathname === '/(tabs)';
  return pathname.includes(key);
}

function TabButton({ slot, active }: { slot: Slot; active: boolean }) {
  const router = useRouter();
  const tint = active ? colors.accent : colors.faint;
  return (
    <Pressable style={styles.tab} onPress={() => router.push(slot.href as any)} hitSlop={8}>
      <slot.Icon size={22} color={tint} strokeWidth={active ? 2.1 : 1.8} />
      <Text
        style={[styles.label, { color: active ? colors.accent : colors.muted2 }]}>
        {slot.label}
      </Text>
    </Pressable>
  );
}

export function TabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom || 10 }]}>
      <View style={styles.row}>
        {TABS.map((s) => (
          <TabButton key={s.key} slot={s} active={isActive(pathname, s.key)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: 11,
    paddingHorizontal: 8,
  },
  tab: { alignItems: 'center', justifyContent: 'flex-start', width: 64, gap: 4 },
  label: { fontFamily: fonts.medium, fontSize: 10 },
});
