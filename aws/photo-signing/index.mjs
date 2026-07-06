/**
 * Recall — note-photo signing API (AWS Lambda, Node.js 20, ESM).
 *
 * Mints short-lived presigned S3 URLs so the mobile app can upload and view
 * note photos without ever holding AWS credentials. Every object is scoped to
 * the caller's Supabase user id (`photos/<userId>/<uuid>.<ext>`), and requests
 * are authenticated with the caller's Supabase JWT.
 *
 * Routes (HTTP API v2):
 *   POST /photos/upload-url   { ext, contentType }  -> { key, url }
 *   POST /photos/get-url      { key }               -> { url, expiresIn }
 *   POST /photos/delete       { key }               -> { ok: true }
 *
 * Env vars:
 *   BUCKET                 (required) S3 bucket name
 *   SUPABASE_JWT_SECRET    (required unless REQUIRE_AUTH=false) HS256 secret
 *   REQUIRE_AUTH           "true" (default) | "false"  — disable only for local testing
 *   URL_TTL                presigned URL lifetime in seconds (default 300)
 *
 * The AWS SDK v3 is bundled in the Node.js 20 Lambda runtime, so this file can
 * be deployed as-is (zip the single file) with no `npm install`.
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET = process.env.BUCKET;
const REQUIRE_AUTH = (process.env.REQUIRE_AUTH ?? 'true') !== 'false';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
const TTL = Number(process.env.URL_TTL ?? '300');

const s3 = new S3Client({});

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

// --- Minimal HS256 JWT verification (no external deps) ---------------------

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function verifyJwt(token) {
  const [h, p, sig] = (token ?? '').split('.');
  if (!h || !p || !sig) throw new Error('malformed token');
  const expected = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest();
  const got = b64url(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    throw new Error('bad signature');
  }
  const payload = JSON.parse(b64url(p).toString('utf8'));
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('token expired');
  if (!payload.sub) throw new Error('token missing subject');
  return payload;
}

/** Resolve the caller's user id (or a fixed sandbox id when auth is disabled). */
function authUserId(event) {
  if (!REQUIRE_AUTH) return 'anonymous';
  const header = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  return verifyJwt(token).sub;
}

const keyPrefix = (userId) => `photos/${userId}/`;

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'POST';
  const path = event.rawPath ?? '';

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (!BUCKET) return json(500, { error: 'BUCKET is not configured' });

  let userId;
  try {
    userId = authUserId(event);
  } catch (e) {
    return json(401, { error: `Unauthorized: ${e.message}` });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  try {
    if (path.endsWith('/photos/upload-url')) {
      const ext = String(body.ext ?? 'jpg').toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return json(400, { error: `Unsupported extension: ${ext}` });
      const contentType = String(body.contentType ?? 'image/jpeg');
      const key = `${keyPrefix(userId)}${randomUUID()}.${ext}`;
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
        { expiresIn: TTL },
      );
      return json(200, { key, url });
    }

    if (path.endsWith('/photos/get-url')) {
      const key = String(body.key ?? '');
      if (!key.startsWith(keyPrefix(userId))) return json(403, { error: 'Forbidden' });
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
        { expiresIn: TTL },
      );
      return json(200, { url, expiresIn: TTL });
    }

    if (path.endsWith('/photos/delete')) {
      const key = String(body.key ?? '');
      if (!key.startsWith(keyPrefix(userId))) return json(403, { error: 'Forbidden' });
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return json(200, { ok: true });
    }

    return json(404, { error: `No route for ${path}` });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Signing failed' });
  }
};
