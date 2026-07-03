import { useLocalSearchParams, useRouter } from 'expo-router';

import { StudySession } from '@/features/study/StudySession';

/** Focused practice — opened from a question with `?focus=<id>`, closes back. */
export default function PracticeScreen() {
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  return <StudySession focus={focus} onExit={() => router.back()} />;
}
