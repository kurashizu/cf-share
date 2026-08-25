/**
 * Share-password hashing via PBKDF2-HMAC-SHA256 (Web Crypto).
 *
 * Stored format (in shares.password_hash):
 *   new:    "pbkdf2:<iterations>:<hex digest>"   — written by hashPassword()
 *   legacy: "<64 hex chars>"                     — single-round SHA-256(password + salt)
 *
 * Legacy hashes are still verified so pre-existing shares keep working; all
 * new shares get PBKDF2. A slow KDF matters here because share passwords are
 * human-chosen and the hash lives in D1 — if the DB ever leaks, single-round
 * SHA-256 is offline-brute-forceable at billions of guesses/second.
 */

const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const HASH_ALGORITHM = 'SHA-256';

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Constant-time string equality (both operands are hex/ASCII). */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function pbkdf2Hex(
	password: string,
	saltHex: string,
	iterations: number
): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: HASH_ALGORITHM,
			salt: new TextEncoder().encode(saltHex),
			iterations
		},
		key,
		256
	);
	return bytesToHex(new Uint8Array(bits));
}

async function legacySha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest(HASH_ALGORITHM, data);
	return bytesToHex(new Uint8Array(digest));
}

/**
 * Generate a random salt and hash a password with PBKDF2.
 * Returns { salt, hash } where hash = "pbkdf2:<iterations>:<hex>".
 */
export async function hashPassword(
	password: string
): Promise<{ salt: string; hash: string }> {
	const saltBytes = new Uint8Array(SALT_LENGTH);
	crypto.getRandomValues(saltBytes);
	const salt = bytesToHex(saltBytes);
	const digest = await pbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
	return { salt, hash: `pbkdf2:${PBKDF2_ITERATIONS}:${digest}` };
}

/**
 * Verify a password against a stored salt and hash. Understands both the
 * PBKDF2 format and the legacy single-round SHA-256 format.
 */
export async function verifyPassword(
	password: string,
	salt: string,
	hash: string
): Promise<boolean> {
	if (hash.startsWith('pbkdf2:')) {
		const [, iterStr, digest] = hash.split(':');
		const iterations = Number(iterStr);
		if (!Number.isSafeInteger(iterations) || iterations < 1 || !digest) {
			return false;
		}
		const computed = await pbkdf2Hex(password, salt, iterations);
		return timingSafeEqual(computed, digest);
	}
	// Legacy: SHA-256(password + salt), bare hex.
	const computed = await legacySha256Hex(password + salt);
	return timingSafeEqual(computed, hash);
}

/** Check if a password meets minimum requirements (non-empty, reasonable length). */
export function isValidPassword(password: unknown): password is string {
	if (typeof password !== 'string') return false;
	return password.length >= 1 && password.length <= 256;
}
