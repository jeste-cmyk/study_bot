# Recall note photos — AWS S3 signing service

This provisions the backend that lets the mobile app store note photos in a
**private** S3 bucket. AWS credentials never ship in the app: a Lambda (behind
an API Gateway HTTP API) mints short-lived **presigned URLs**, and the device
uploads/downloads directly to S3 with them.

```
app ──(Supabase JWT)──▶ API Gateway ──▶ Lambda ──▶ presigned PUT/GET/DELETE ──▶ S3
```

- Objects are keyed `photos/<supabase-user-id>/<uuid>.<ext>` and the Lambda
  refuses any key outside the caller's own prefix.
- The note only stores the **object key**. Viewing resolves a key to a presigned
  GET URL on demand (cached in-app until shortly before it expires).

Files here:

| File | What it is |
|------|------------|
| `index.mjs` | Lambda handler (Node.js 20, ESM). No build step needed. |
| `package.json` | Dependency manifest (SDK is preinstalled in the Lambda runtime). |
| `s3-cors.json` | CORS config to apply to the bucket. |
| `iam-policy.json` | Least-privilege policy for the Lambda role. |

Set `REGION` and `BUCKET` shell vars first, then follow along. Everything below
uses the AWS CLI, but each step maps 1:1 to the Console if you prefer clicking.

```bash
export REGION=us-east-1
export BUCKET=recall-note-photos-<your-unique-suffix>   # bucket names are global
```

---

## 1. Create the private S3 bucket

```bash
aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  $( [ "$REGION" = "us-east-1" ] || echo --create-bucket-configuration LocationConstraint=$REGION )

# Keep it fully private (this is the default, but be explicit).
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Allow the app to PUT/GET via presigned URLs (needed for the web build; native
# ignores CORS, but this is harmless).
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration file://s3-cors.json
```

Optional but recommended — auto-delete orphaned uploads (a photo picked but the
note never saved) after 1 day. Create `lifecycle.json`:

```json
{ "Rules": [ { "ID": "expire-orphans", "Status": "Enabled",
  "Filter": { "Prefix": "photos/" },
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } } ] }
```

> Note: a lifecycle rule can only *expire by age*, not "delete if unreferenced".
> Deletes for photos removed from a saved note are handled by the app calling
> `/photos/delete`. Skip this rule unless you want a hard TTL on all photos.

---

## 2. Grab your Supabase JWT secret

The Lambda verifies the user's Supabase access token so only signed-in users can
mint URLs. In the Supabase dashboard:

**Project Settings → API → JWT Settings → JWT Secret** — copy it.

> If your project uses the newer asymmetric (ES256) signing keys instead of a
> shared secret, verify against the project JWKS URL instead; open an issue /
> ask and we'll swap `verifyJwt` for a JWKS check. The HS256 secret path below
> is what most projects have.

---

## 3. Create the Lambda

### 3a. Execution role

```bash
cat > trust.json <<'EOF'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole" } ] }
EOF

aws iam create-role --role-name recall-photo-signer \
  --assume-role-policy-document file://trust.json

# Basic logging to CloudWatch.
aws iam attach-role-policy --role-name recall-photo-signer \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Least-privilege S3 access. Edit iam-policy.json first: replace
# REPLACE_WITH_BUCKET_NAME with your $BUCKET.
sed "s/REPLACE_WITH_BUCKET_NAME/$BUCKET/" iam-policy.json > iam-policy.resolved.json
aws iam put-role-policy --role-name recall-photo-signer \
  --policy-name s3-note-photos --policy-document file://iam-policy.resolved.json
```

### 3b. Deploy the code

The AWS SDK v3 is preinstalled in the Node 20 runtime, so you can zip the single
file (no `npm install` needed):

```bash
zip function.zip index.mjs

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws lambda create-function --function-name recall-photo-signer \
  --runtime nodejs20.x --handler index.handler \
  --role arn:aws:iam::$ACCOUNT:role/recall-photo-signer \
  --zip-file fileb://function.zip --region "$REGION" \
  --timeout 10 \
  --environment "Variables={BUCKET=$BUCKET,SUPABASE_JWT_SECRET=<paste-secret>,REQUIRE_AUTH=true,URL_TTL=300}"
```

Redeploy after edits: `zip function.zip index.mjs && aws lambda update-function-code --function-name recall-photo-signer --zip-file fileb://function.zip`

---

## 4. Expose it via API Gateway (HTTP API)

```bash
API_ID=$(aws apigatewayv2 create-api --name recall-photos \
  --protocol-type HTTP --target arn:aws:lambda:$REGION:$ACCOUNT:function:recall-photo-signer \
  --query ApiId --output text)

# Let API Gateway invoke the Lambda.
aws lambda add-permission --function-name recall-photo-signer \
  --statement-id apigw --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*"

echo "Base URL: https://$API_ID.execute-api.$REGION.amazonaws.com"
```

The `--target` shortcut creates a catch-all `$default` route to the Lambda, which
is exactly what the handler expects (it routes internally on the path). That base
URL is what the app needs.

> Want tighter routing? Instead of `--target`, create explicit routes
> `POST /photos/upload-url`, `POST /photos/get-url`, `POST /photos/delete` and a
> single integration. Not required.

---

## 5. Point the app at it

In `mobile/.env`:

```bash
EXPO_PUBLIC_PHOTO_API_URL=https://<API_ID>.execute-api.<REGION>.amazonaws.com
```

Restart the dev server (`npx expo start -c`). With this set, `photoStore` switches
from on-device storage to S3 automatically — no code change. Leave it blank and
the app stores photos on-device (local-first), unchanged.

Because this adds no native modules, an OTA/JS reload is enough — no new dev build
required (you already rebuilt for the image picker).

---

## 6. Smoke-test

Get a user access token (sign in on the app, or use the Supabase REST auth
endpoint) and:

```bash
TOKEN=<supabase access_token>
BASE=https://<API_ID>.execute-api.<REGION>.amazonaws.com

# Should return { key, url }
curl -s -X POST "$BASE/photos/upload-url" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"ext":"jpg","contentType":"image/jpeg"}'
```

For a quick end-to-end check *without* wiring auth, deploy with
`REQUIRE_AUTH=false` (any caller is treated as user `anonymous`), verify uploads
land in `s3://$BUCKET/photos/anonymous/…`, then flip it back to `true`. **Do not
leave `REQUIRE_AUTH=false` in production** — it lets anyone mint URLs for the
shared `anonymous` prefix.

---

## Cost & housekeeping

- S3 storage + request costs are pennies for personal use; presigned GETs are
  plain S3 GETs.
- Lambda + HTTP API are within the always-free / cheap tier at this volume.
- Photos are private; every view requires a fresh signed URL, so rotating the
  bucket or revoking access is immediate (delete the object or the user prefix).
