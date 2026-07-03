/**
 * Recall design system — extracted from the design exploration
 * (`design/Recall - Interview Practice App.dc.html`).
 *
 * Single source of truth for colour, type, spacing and radius so every screen
 * stays faithful to the mock-ups.
 */

export const colors = {
  // surfaces
  bg: '#F7F6F3', // app paper background
  surface: '#FFFFFF', // cards
  surfaceAlt: '#FBFAF8', // inputs / sidebar
  // ink + text
  ink: '#1B1A17', // primary text + dark panels
  text: '#2D2B26',
  textSecondary: '#56534B',
  muted: '#8A867C',
  muted2: '#9B978C',
  faint: '#B7B3A9',
  // dark panel text
  onDark: '#FFFFFF',
  onDarkMuted: '#A8A49B',
  onDarkFaint: '#8E8A81',
  // lines
  border: '#E7E4DE',
  borderStrong: '#E2DFD8',
  borderFaint: '#EFEDE8',
  hairline: '#F2F0EB',
  // accent (indigo)
  accent: '#3B57D6',
  accentTint: '#ECEEFB',
  accentInk: '#2C3FA8',
  // semantic
  amber: '#E0A23B',
  success: '#1F8A50',
  warn: '#B5791F',
  danger: '#C0392B',
} as const;

export const fonts = {
  // Schibsted Grotesk weights
  regular: 'Schibsted_400Regular',
  medium: 'Schibsted_500Medium',
  semibold: 'Schibsted_600SemiBold',
  bold: 'Schibsted_700Bold',
  extrabold: 'Schibsted_800ExtraBold',
  // JetBrains Mono
  mono: 'JetBrains_400Regular',
  monoMedium: 'JetBrains_500Medium',
  monoSemibold: 'JetBrains_600SemiBold',
} as const;

export const radius = {
  sm: 8,
  md: 11,
  lg: 13,
  xl: 18,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
} as const;

export type CategoryKey = 'Behavioral' | 'Case' | 'Technical' | 'Fit';

const CATEGORY_STYLES: Record<string, { bg: string; fg: string }> = {
  Behavioral: { bg: '#EAF1FB', fg: '#2B5CA8' },
  Case: { bg: '#F2ECFB', fg: '#6A3FB0' },
  Technical: { bg: '#E7F3EC', fg: '#1F7A4D' },
  Fit: { bg: '#FBEEE7', fg: '#B05A2E' },
};

export const categoryStyle = (c?: string | null) =>
  (c && CATEGORY_STYLES[c]) || { bg: '#EEF0F2', fg: '#6A675F' };

export const CATEGORIES: CategoryKey[] = ['Behavioral', 'Case', 'Technical', 'Fit'];

export type ReviewStatus = 'new' | 'due' | 'learning' | 'scheduled';

const STATUS_STYLES: Record<ReviewStatus, { label: string; bg: string; fg: string }> = {
  due: { label: 'Due now', bg: '#FBF1E0', fg: '#9A6A12' },
  learning: { label: 'Learning', bg: '#ECEEFB', fg: '#3B57D6' },
  scheduled: { label: 'Scheduled', bg: '#EFF0F2', fg: '#6A675F' },
  new: { label: 'New', bg: '#E7F3EC', fg: '#1F7A4D' },
};

export const statusStyle = (s: ReviewStatus) => STATUS_STYLES[s] ?? STATUS_STYLES.scheduled;

/** Colour for a 1–10 score (or muted when there is no score yet). */
export const scoreColor = (n?: number | null): string => {
  if (n == null) return colors.muted2;
  if (n >= 8) return colors.success;
  if (n >= 5) return colors.warn;
  return colors.danger;
};

export type RatingKey = 'again' | 'hard' | 'good' | 'easy';

export const RATING_STYLES: Record<
  RatingKey,
  { label: string; bg: string; fg: string; border: string }
> = {
  again: { label: 'Again', bg: '#FBECEA', fg: '#C0392B', border: '#F1C9C3' },
  hard: { label: 'Hard', bg: '#FBF2E2', fg: '#9A6A12', border: '#EAD8AE' },
  good: { label: 'Good', bg: '#E9F1FB', fg: '#2D6BB5', border: '#C7DBF3' },
  easy: { label: 'Easy', bg: '#E7F3EC', fg: '#1F7A4D', border: '#C2E2CE' },
};
