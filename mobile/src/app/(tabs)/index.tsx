import { StudySession } from '@/features/study/StudySession';

/** Home = the study session. Lands straight on the first question, with a top
 *  menu to prioritise a question type. */
export default function HomeScreen() {
  return <StudySession showFilter />;
}
