/**
 * Password hashing using Web Crypto (SHA-256 + random salt), hex-encoded.
 *
 * The original implementation used Node's `crypto` module. SvelteKit's
 * adapter-cloudflare compiles the server to a native Worker; using Web
 * Crypto (`crypto.subtle`/`crypto.getRandomValues`) avoids depending on
 * `nodejs_compat` + Node stream buffering in the auth path.
 */

const SALT_LENGTH = 16;
const HASH_ALGORITHM = 'SHA-256';

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256Hex(input: string): Promise<string> {
	const data = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest(HASH_ALGORITHM, data);
	return bytesToHex(new Uint8Array(digest));
}

/**
 * Generate a random salt and hash a password.
 * Returns { salt, hash } where hash = SHA-256(password + salt).
 */
export async function hashPassword(
	password: string,
): Promise<{ salt: string; hash: string }> {
	const saltBytes = new Uint8Array(SALT_LENGTH);
	crypto.getRandomValues(saltBytes);
	const salt = bytesToHex(saltBytes);
	const hash = await sha256Hex(password + salt);
	return { salt, hash };
}

/**
 * Verify a password against a stored salt and hash.
 * Returns true if SHA-256(password + salt) === stored hash.
 */
export async function verifyPassword(
	password: string,
	salt: string,
	hash: string,
): Promise<boolean> {
	const computed = await sha256Hex(password + salt);
	return computed === hash;
}

/** Check if a password meets minimum requirements (non-empty, reasonable length). */
export function isValidPassword(password: unknown): password is string {
	if (typeof password !== 'string') return false;
	return password.length >= 1 && password.length <= 256;
}