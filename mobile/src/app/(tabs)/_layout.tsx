import { Redirect, Tabs } from 'expo-router';

import { TabBar } from '@/ui/TabBar';
import { useStore } from '@/store/useStore';

export default function TabsLayout() {
  const status = useStore((s) => s.status);
  if (status === 'signed-out') return <Redirect href="/login" />;

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={() => <TabBar />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="bank" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
