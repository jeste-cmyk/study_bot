import { Redirect } from 'expo-router';
import { useStore } from '@/store/useStore';

export default function Index() {
  const status = useStore((s) => s.status);
  if (status === 'loading') return null;
  return <Redirect href={status === 'signed-in' ? '/(tabs)' : '/login'} />;
}
