import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
} from '@expo-google-fonts/schibsted-grotesk';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';

import { colors } from '@/theme';
import { useStore } from '@/store/useStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const bootstrap = useStore((s) => s.bootstrap);
  const status = useStore((s) => s.status);

  const [fontsLoaded] = useFonts({
    Schibsted_400Regular: SchibstedGrotesk_400Regular,
    Schibsted_500Medium: SchibstedGrotesk_500Medium,
    Schibsted_600SemiBold: SchibstedGrotesk_600SemiBold,
    Schibsted_700Bold: SchibstedGrotesk_700Bold,
    Schibsted_800ExtraBold: SchibstedGrotesk_800ExtraBold,
    JetBrains_400Regular: JetBrainsMono_400Regular,
    JetBrains_500Medium: JetBrainsMono_500Medium,
    JetBrains_600SemiBold: JetBrainsMono_600SemiBold,
  });

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const ready = fontsLoaded && status !== 'loading';

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="question/[id]" />
          <Stack.Screen
            name="capture"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="practice"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
