/// <reference path="../../cloudflare-env.d.ts" />

/**
 * Delete grants — HMAC-signed proof that this browser is the one that
 * minted a given share token, so it may self-service delete it later
 * without any login.
 *
 * Why: uploads are anonymous, so there is no account to check ownership
 * against. Instead, /api/upload/complete signs the freshly-minted token
 * and the client stores {token, sig} in the `cf_owned` cookie (see
 * owned-cookie.ts). /api/share/[token] DELETE re-derives the signature and
 * compares — only someone holding the cookie set at mint time can pass.
 *
 * The signature reuses ADMIN_JWT_SECRET with a domain-separation prefix so
 * delete-grant, upload-grant, and admin-JWT signatures can never be
 * confused for each other.
 */

const DELETE_GRANT_DOMAIN = "cf-share-delete-grant-v1";

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

/** Sign a delete grant for a share token. Travels to the client via the `cf_owned` cookie. */
export async function signDeleteGrant(
  env: { ADMIN_JWT_SECRET: string },
  token: string,
): Promise<string> {
  return base64UrlEncode(
    await hmac(env.ADMIN_JWT_SECRET, [DELETE_GRANT_DOMAIN, token].join("\n")),
  );
}

/** Verify a client-echoed delete-grant signature against a claimed token. */
export async function verifyDeleteGrant(
  env: { ADMIN_JWT_SECRET: string },
  token: string,
  sig: unknown,
): Promise<boolean> {
  if (typeof sig !== "string" || !sig) return false;
  const expected = await signDeleteGrant(env, token);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
