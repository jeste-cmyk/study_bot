import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { colors, fonts, radius } from '@/theme';

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

type TxtVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'title'
  | 'body'
  | 'bodyStrong'
  | 'small'
  | 'label'
  | 'mono'
  | 'monoSmall';

const TXT: Record<TxtVariant, TextStyle> = StyleSheet.create({
  h1: { fontFamily: fonts.bold, fontSize: 28, letterSpacing: -0.6, color: colors.ink },
  h2: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  h3: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  title: { fontFamily: fonts.bold, fontSize: 16, letterSpacing: -0.2, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  small: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.muted2 },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.muted2,
    letterSpacing: 0.5,
  },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted2 },
  monoSmall: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted2 },
}) as Record<TxtVariant, TextStyle>;

export interface TxtProps extends TextProps {
  variant?: TxtVariant;
  color?: string;
  children?: ReactNode;
}

export function Txt({ variant = 'body', color, style, ...rest }: TxtProps) {
  return <Text {...rest} style={[TXT[variant], color ? { color } : null, style]} />;
}

/**
 * Renders `text` with the given char ranges wrapped in `highlightStyle` — used
 * to mark search matches in titles and quick-view snippets. Overlapping or
 * out-of-order spans are merged safely.
 */
export function Highlighted({
  text,
  spans,
  variant,
  style,
  highlightStyle,
  numberOfLines,
}: {
  text: string;
  spans: { start: number; end: number }[];
  variant?: TxtVariant;
  style?: StyleProp<TextStyle>;
  highlightStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const parts: ReactNode[] = [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let cursor = 0;
  sorted.forEach((s, i) => {
    const start = Math.max(cursor, s.start);
    const end = Math.max(start, Math.min(s.end, text.length));
    if (start > cursor) parts.push(<Text key={`p${i}`}>{text.slice(cursor, start)}</Text>);
    if (end > start) {
      parts.push(
        <Text key={`h${i}`} style={highlightStyle}>
          {text.slice(start, end)}
        </Text>,
      );
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) parts.push(<Text key="tail">{text.slice(cursor)}</Text>);

  return (
    <Txt variant={variant} style={style} numberOfLines={numberOfLines}>
      {parts.length ? parts : text}
    </Txt>
  );
}

// ---------------------------------------------------------------------------
// Pill / chip
// ---------------------------------------------------------------------------

export function Pill({
  label,
  bg,
  fg,
  border,
  style,
}: {
  label: string;
  bg: string;
  fg: string;
  border?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingHorizontal: 9,
          paddingVertical: 3,
          alignSelf: 'flex-start',
          borderWidth: border ? 1 : 0,
          borderColor: border,
        },
        style,
      ]}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: fg }}>{label}</Text>
    </View>
  );
}

/** A small square status tag with sharper corners (used for "Due now" etc). */
export function Tag({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 10.5, color: fg }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  dark,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  dark?: boolean;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: dark ? colors.ink : colors.surface,
          borderRadius: radius.lg,
          borderWidth: dark ? 0 : 1,
          borderColor: colors.border,
          padding: 16,
          overflow: 'hidden',
        },
        style,
      ]}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'dark' | 'secondary';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === 'primary' ? colors.accent : variant === 'dark' ? colors.ink : colors.surface;
  const fg = variant === 'secondary' ? colors.textSecondary : '#fff';
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          paddingVertical: 13,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.borderStrong,
          opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon}
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: fg }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export const hairlineColor = colors.hairline;
