/**
 * Photo attachments for notes.
 *
 * Picking uses the system photo library (multi-select supported). Where each
 * picked image is *stored* depends on configuration, mirroring the repository's
 * local-vs-cloud split:
 *
 *  - `LocalPhotoStore` — copies the image into the app's persistent document
 *    directory and stores that `file://` URI on the note. Used local-first.
 *  - `S3PhotoStore`    — uploads the image to S3 with a short-lived presigned
 *    PUT URL minted by our signing API, and stores only the S3 object *key* on
 *    the note. Viewing resolves a key to a presigned GET URL on demand. AWS
 *    credentials live in the Lambda, never on the device.
 *
 * A note's `photos` array therefore holds opaque *refs* — a local URI or an S3
 * key — that only the active store knows how to resolve. `resolve()` passes
 * through anything that already looks like a URL so legacy on-device photos keep
 * working if the app is later pointed at S3.
 */
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';

import { env, isS3PhotosConfigured } from '@/config/env';
import { supabase } from './supabaseClient';
import { uid } from './id';

/** Subdirectory of the document directory where on-device photos are kept. */
const PHOTOS_DIRNAME = 'note-photos';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** File extension (no dot) of a URI, defaulting to a safe `jpg`. */
function extOf(uri: string): string {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(uri);
  const e = m ? m[1].toLowerCase() : 'jpg';
  return MIME[e] ? e : 'jpg';
}

const mimeOf = (ext: string): string => MIME[ext] ?? 'image/jpeg';

/** A ref that is already directly renderable (URL or on-device file). */
const isDirectUrl = (ref: string): boolean => /^(https?|file|data):/.test(ref);

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface PhotoStore {
  /** Persist a freshly-picked local image; returns the ref to store on the note. */
  upload(localUri: string): Promise<string>;
  /** Resolve a stored ref to a URL the UI can render. */
  resolve(ref: string): Promise<string>;
  /** Best-effort delete of a stored photo (called when its note is deleted). */
  remove(ref: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local (on-device document directory)
// ---------------------------------------------------------------------------

class LocalPhotoStore implements PhotoStore {
  async upload(localUri: string): Promise<string> {
    try {
      const dir = new Directory(Paths.document, PHOTOS_DIRNAME);
      if (!dir.exists) dir.create({ intermediates: true });
      const dest = new File(dir, `${uid('ph-')}.${extOf(localUri)}`);
      new File(localUri).copy(dest);
      return dest.uri;
    } catch {
      // No document directory (e.g. web) — keep the picked URI as-is.
      return localUri;
    }
  }

  async resolve(ref: string): Promise<string> {
    return ref;
  }

  async remove(ref: string): Promise<void> {
    try {
      if (!ref.includes(`/${PHOTOS_DIRNAME}/`)) return;
      const f = new File(ref);
      if (f.exists) f.delete();
    } catch {
      // ignore — nothing to clean up
    }
  }
}

// ---------------------------------------------------------------------------
// S3 (presigned URLs from the signing API)
// ---------------------------------------------------------------------------

type UploadUrlResponse = { key: string; url: string };
type GetUrlResponse = { url: string; expiresIn?: number };

class S3PhotoStore implements PhotoStore {
  /** Cache of key → presigned GET URL, so we don't re-sign on every render. */
  private cache = new Map<string, { url: string; expiresAt: number }>();

  private async authHeaders(): Promise<Record<string, string>> {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async api<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${env.photoApiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Photo service error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    return (await res.json()) as T;
  }

  async upload(localUri: string): Promise<string> {
    const ext = extOf(localUri);
    const contentType = mimeOf(ext);
    const { key, url } = await this.api<UploadUrlResponse>('/photos/upload-url', {
      ext,
      contentType,
    });
    // Stream the file straight to S3 with the presigned PUT URL. The Content-Type
    // must match what the URL was signed for.
    const result = await LegacyFileSystem.uploadAsync(url, localUri, {
      httpMethod: 'PUT',
      uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Upload to S3 failed (${result.status}).`);
    }
    return key;
  }

  async resolve(ref: string): Promise<string> {
    if (isDirectUrl(ref)) return ref; // legacy on-device photo — nothing to sign
    const now = Date.now();
    const hit = this.cache.get(ref);
    if (hit && hit.expiresAt > now) return hit.url;
    const { url, expiresIn } = await this.api<GetUrlResponse>('/photos/get-url', {
      key: ref,
    });
    // Refresh a minute before the URL actually expires.
    const ttl = Math.max(30, (expiresIn ?? 300) - 60) * 1000;
    this.cache.set(ref, { url, expiresAt: now + ttl });
    return url;
  }

  async remove(ref: string): Promise<void> {
    if (isDirectUrl(ref)) return; // not an S3 object we own
    this.cache.delete(ref);
    try {
      await this.api('/photos/delete', { key: ref });
    } catch {
      // best-effort; a lifecycle rule can reap anything left behind
    }
  }
}

/** The active photo store, chosen the same way the repository is. */
export const photoStore: PhotoStore = isS3PhotosConfigured
  ? new S3PhotoStore()
  : new LocalPhotoStore();

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

/**
 * Open the photo library and return the *local* URIs of every selected image
 * (multi-select). Callers upload each via `photoStore.upload`. Returns an empty
 * array on cancel; throws with a friendly message if access is denied.
 */
export async function pickPhotos(): Promise<string[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Allow photo access in Settings to attach photos to a note.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 0, // 0 = no limit
    quality: 0.8,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => a.uri);
}
