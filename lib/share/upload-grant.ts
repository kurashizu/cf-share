/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Upload grants — HMAC-signed proof that /api/upload/init approved a given
 * (key, size, contentType) triple.
 *
 * Why: presigned PUT URLs don't bind Content-Length, and the complete step
 * used to accept any client-supplied `key`/`size`. Signing the triple at
 * init and verifying it at complete/resume means:
 *   - a share can only be minted for a key this server issued (no minting
 *     shares that point at other objects in the bucket);
 *   - the size/contentType the quota was checked against at init cannot be
 *     swapped for different values at complete.
 *
 * The signature reuses ADMIN_JWT_SECRET with a domain-separation prefix so
 * grant signatures and admin JWTs can never be confused for each other.
 */

const GRANT_DOMAIN = "cf-share-upload-grant-v1";

export interface UploadGrant {
  key: string;
  size: number;
  contentType: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(sig);
}

function grantPayload(grant: UploadGrant): string {
  // contentType is CRLF-rejected at validation and key/size are server-shaped,
  // but join with \n anyway so no field can smuggle a separator.
  return [GRANT_DOMAIN, grant.key, String(grant.size), grant.contentType].join(
    "\n",
  );
}

/** Sign an upload grant. Returned string travels to the client as `uploadSig`. */
export async function signUploadGrant(
  env: { ADMIN_JWT_SECRET: string },
  grant: UploadGrant,
): Promise<string> {
  return base64UrlEncode(await hmac(env.ADMIN_JWT_SECRET, grantPayload(grant)));
}

/** Verify a client-echoed `uploadSig` against the claimed grant fields. */
export async function verifyUploadGrant(
  env: { ADMIN_JWT_SECRET: string },
  sig: unknown,
  grant: UploadGrant,
): Promise<boolean> {
  if (typeof sig !== "string" || !sig) return false;
  const expected = await signUploadGrant(env, grant);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Defense-in-depth shape check for upload keys, matching buildS3Key():
 * uploads/YYYY/MM/DD/tmp-{8 hex}/{sanitized filename, no slashes}
 */
export function isValidUploadKey(key: string): boolean {
  return /^uploads\/\d{4}\/\d{2}\/\d{2}\/tmp-[0-9a-f]{8}\/[^/]{1,200}$/.test(
    key,
  );
}
