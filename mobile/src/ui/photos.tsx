/**
 * Photo attachment UI, shared across capture and note detail:
 *
 *  - `PhotoInput`   — editable strip of thumbnails with an "add" tile and a
 *                     per-photo remove button. Picked images are uploaded via
 *                     the active photo store; the note stores the returned refs.
 *  - `PhotoGallery` — read-only thumbnails that open a full-screen, swipeable
 *                     viewer when tapped.
 *
 * A "ref" is opaque (a local file URI or an S3 key); both thumbnails and the
 * viewer resolve it to a URL through `usePhotoUrl`.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radius } from '@/theme';
import { Txt } from '@/ui/primitives';
import { CloseIcon, ImageIcon, PlusIcon } from '@/ui/icons';
import { pickPhotos, photoStore } from '@/services/photos';

const THUMB = 76;

/** Resolve a photo ref to a renderable URL (null while loading / on error). */
function usePhotoUrl(ref: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    photoStore
      .resolve(ref)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [ref]);
  return url;
}

function Thumb({
  refKey,
  onPress,
}: {
  refKey: string;
  onPress?: () => void;
}) {
  const url = usePhotoUrl(refKey);
  const body = url ? (
    <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" transition={120} />
  ) : (
    <View style={[styles.thumb, styles.thumbLoading]}>
      <ActivityIndicator size="small" color={colors.muted2} />
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

// ---------------------------------------------------------------------------
// Editable input
// ---------------------------------------------------------------------------

export function PhotoInput({
  photos,
  onChange,
}: {
  photos: string[];
  onChange: (next: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await pickPhotos();
      if (picked.length) {
        const refs = await Promise.all(picked.map((uri) => photoStore.upload(uri)));
        onChange([...photos, ...refs]);
      }
    } catch (e) {
      Alert.alert(
        'Could not add photos',
        e instanceof Error ? e.message : 'Something went wrong adding your photos.',
      );
    } finally {
      setBusy(false);
    }
  };

  // Dropping a photo here only removes the reference; the object is reclaimed
  // when the whole note is deleted, so cancelling an edit never loses a photo.
  const remove = (ref: string) => onChange(photos.filter((p) => p !== ref));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      keyboardShouldPersistTaps="handled">
      {photos.map((ref) => (
        <View key={ref} style={styles.thumbWrap}>
          <Thumb refKey={ref} />
          <Pressable onPress={() => remove(ref)} hitSlop={8} style={styles.removeBtn}>
            <CloseIcon size={13} color="#fff" />
          </Pressable>
        </View>
      ))}
      <Pressable onPress={add} disabled={busy} style={styles.addTile}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.accentInk} />
        ) : (
          <>
            <PlusIcon size={18} color={colors.accentInk} />
            <Txt variant="small" style={{ color: colors.accentInk, marginTop: 2, fontSize: 11 }}>
              Add
            </Txt>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Read-only gallery + full-screen viewer
// ---------------------------------------------------------------------------

export function PhotoGallery({ photos }: { photos: string[] }) {
  const [viewer, setViewer] = useState<number | null>(null);
  if (!photos.length) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}>
        {photos.map((ref, i) => (
          <Thumb key={ref} refKey={ref} onPress={() => setViewer(i)} />
        ))}
      </ScrollView>
      <PhotoViewer photos={photos} index={viewer} onClose={() => setViewer(null)} />
    </>
  );
}

function ViewerImage({
  refKey,
  width,
  height,
  onPress,
}: {
  refKey: string;
  width: number;
  height: number;
  onPress: () => void;
}) {
  const url = usePhotoUrl(refKey);
  return (
    <Pressable onPress={onPress} style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width, height }} contentFit="contain" transition={150} />
      ) : (
        <ActivityIndicator color="#fff" />
      )}
    </Pressable>
  );
}

function PhotoViewer({
  photos,
  index,
  onClose,
}: {
  photos: string[];
  index: number | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const [page, setPage] = useState(index ?? 0);
  const open = index !== null;

  useEffect(() => {
    if (index !== null) setPage(index);
  }, [index]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.viewerBg}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (index ?? 0) * width, y: 0 }}
          onMomentumScrollEnd={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / width))
          }>
          {photos.map((ref) => (
            <ViewerImage key={ref} refKey={ref} width={width} height={height} onPress={onClose} />
          ))}
        </ScrollView>

        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={[styles.viewerClose, { top: insets.top + 8 }]}>
          <CloseIcon size={22} color="#fff" />
        </Pressable>

        {photos.length > 1 ? (
          <View style={[styles.viewerCount, { bottom: insets.bottom + 20 }]}>
            <Txt style={{ color: '#fff', fontFamily: fonts.monoSemibold, fontSize: 12 }}>
              {page + 1} / {photos.length}
            </Txt>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Section header helper — a labelled "PHOTOS" row with the image glyph.
// ---------------------------------------------------------------------------

export function PhotosLabel({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.labelRow, style]}>
      <ImageIcon size={14} color={colors.muted2} />
      <Txt variant="label">PHOTOS</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 10, paddingVertical: 2, paddingRight: 4 },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  thumbLoading: { alignItems: 'center', justifyContent: 'center' },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7CCE6',
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  viewerClose: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCount: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
});
