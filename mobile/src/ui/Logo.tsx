import { View } from 'react-native';
import { colors } from '@/theme';

/** The Recall mark: an indigo rounded square with a target ring inside. */
export function Logo({ size = 30, bg = colors.accent }: { size?: number; bg?: string }) {
  const ring = size * 0.46;
  const dot = size * 0.12;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: Math.max(2, size * 0.085),
          borderColor: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: '#fff' }}
        />
      </View>
    </View>
  );
}
