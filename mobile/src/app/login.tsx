import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, fonts, radius } from '@/theme';
import { Button, Txt } from '@/ui/primitives';
import { Logo } from '@/ui/Logo';
import { useStore } from '@/store/useStore';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signIn = useStore((s) => s.signIn);
  const signUp = useStore((s) => s.signUp);
  const signInWithGoogle = useStore((s) => s.signInWithGoogle);
  const mode = useStore((s) => s.authMode);

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'email' | 'google'>(null);
  const [error, setError] = useState<string | null>(null);

  const go = () => router.replace('/(tabs)');

  const toggleMode = () => {
    setError(null);
    setIsSignUp((v) => !v);
  };

  const handleEmail = async () => {
    setError(null);
    setBusy('email');
    try {
      if (isSignUp) {
        await signUp(email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }
      go();
    } catch (e: any) {
      setError(e?.message ?? (isSignUp ? 'Could not create account' : 'Could not sign in'));
    } finally {
      setBusy(null);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
      go();
    } catch (e: any) {
      setError(e?.message ?? 'Google sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Brand hero */}
          <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
            <View style={styles.brandRow}>
              <Logo size={30} />
              <Txt variant="h3" color="#fff" style={{ fontSize: 19 }}>
                Recall
              </Txt>
            </View>
            <Txt color="#fff" style={styles.heroTitle}>
              Stop hoping the answer comes out right. Rehearse until it does.
            </Txt>
            <Txt color={colors.onDarkMuted} style={styles.heroSub}>
              Capture every question you face, practice out loud on demand, and let spaced
              repetition resurface the ones you fumbled.
            </Txt>
            <View style={styles.stats}>
              {[
                ['47', 'questions'],
                ['12', 'day streak'],
                ['6.8', 'avg score'],
              ].map(([n, l]) => (
                <View key={l}>
                  <Txt color="#fff" style={styles.statNum}>
                    {n}
                  </Txt>
                  <Txt color={colors.onDarkFaint} style={styles.statLabel}>
                    {l}
                  </Txt>
                </View>
              ))}
            </View>
            <View style={styles.ring} pointerEvents="none" />
          </View>

          {/* Form sheet */}
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 28 }]}>
            <Txt variant="h2" style={{ marginBottom: 4 }}>
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </Txt>
            <Txt variant="small" style={{ marginBottom: 22 }}>
              {isSignUp
                ? 'Sign up to sync your bank across devices.'
                : 'Sign in to sync your bank across devices.'}
            </Txt>

            <Button
              title="Continue with Google"
              variant="secondary"
              loading={busy === 'google'}
              onPress={handleGoogle}
              icon={<View style={styles.googleDot} />}
            />

            <View style={styles.divider}>
              <View style={styles.line} />
              <Txt variant="small" style={{ color: colors.faint }}>
                or
              </Txt>
              <View style={styles.line} />
            </View>

            <Txt variant="label" style={styles.fieldLabel}>
              Email
            </Txt>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Txt variant="label" style={styles.fieldLabel}>
              Password
            </Txt>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor={colors.faint}
              style={[styles.input, { marginBottom: 18 }]}
            />

            {error ? (
              <Txt variant="small" color={colors.danger} style={{ marginBottom: 12 }}>
                {error}
              </Txt>
            ) : null}

            <Button
              title={isSignUp ? 'Create account' : 'Sign in'}
              loading={busy === 'email'}
              onPress={handleEmail}
            />

            <Pressable style={{ marginTop: 18 }} onPress={toggleMode}>
              <Txt variant="small" style={{ textAlign: 'center' }}>
                {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
                <Txt variant="small" color={colors.accentInk} style={{ fontFamily: fonts.semibold }}>
                  {isSignUp ? 'Sign in' : 'Create an account'}
                </Txt>
              </Txt>
            </Pressable>

            <Txt variant="monoSmall" style={styles.modeNote}>
              {mode === 'supabase'
                ? 'Connected to Supabase — real auth + sync'
                : 'Local mode — set Supabase keys in .env to sync'}
            </Txt>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: 28,
    paddingBottom: 36,
    position: 'relative',
    overflow: 'hidden',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 26 },
  heroTitle: {
    fontFamily: fonts.bold,
    fontSize: 26,
    letterSpacing: -0.7,
    lineHeight: 32,
    marginBottom: 14,
  },
  heroSub: { fontSize: 14, lineHeight: 21, maxWidth: 360, marginBottom: 26 },
  stats: { flexDirection: 'row', gap: 28 },
  statNum: { fontFamily: fonts.monoSemibold, fontSize: 24 },
  statLabel: { fontFamily: fonts.mono, fontSize: 11, marginTop: 2 },
  ring: {
    position: 'absolute',
    right: -110,
    top: -70,
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: 6,
    paddingHorizontal: 28,
    paddingTop: 30,
  },
  googleDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4285F4',
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  fieldLabel: { marginBottom: 7, color: colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.surfaceAlt,
    marginBottom: 16,
  },
  modeNote: { textAlign: 'center', marginTop: 22, color: colors.faint, fontSize: 10.5 },
});
