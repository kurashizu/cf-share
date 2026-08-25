/**
 * Share-link token generation.
 *
 * Format: fixed [0-9A-Z]{4} — 1,679,616 combinations, chosen for
 * memorability (read aloud, typed on another device, OTP-style entry).
 *
 * Collision handling: caller passes an `exists` function; on collision we
 * simply redraw. The active-share pool is capped at MAX_TOTAL_COUNT
 * (a small fraction of the token space, enforced in upload/init), so the
 * per-draw collision probability stays low and 32 consecutive collisions
 * are statistically impossible. If it ever happens we fail loudly rather
 * than silently extending the code length.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Generate a random token of exactly `length` characters from [0-9A-Z]. */
export function generateToken(length = 4): string {
	const out = new Array<string>(length);
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	for (let i = 0; i < length; i++) {
		out[i] = ALPHABET[bytes[i] % ALPHABET.length];
	}
	return out.join("");
}

/**
 * Generate a unique 4-char token by redrawing on collision.
 *
 * @param exists async function that returns true if the candidate is taken
 * @param maxAttempts redraws before giving up
 * @throws if every attempt collides (only possible if the pool-count cap
 *         is misconfigured or bypassed far beyond the token space)
 */
export async function generateUniqueToken(
	exists: (token: string) => Promise<boolean>,
	maxAttempts = 32,
): Promise<string> {
	for (let i = 0; i < maxAttempts; i++) {
		const candidate = generateToken(4);
		if (!(await exists(candidate))) return candidate;
	}
	throw new Error("Could not generate a unique token after maximum attempts");
}

/**
 * Validate that a string is a well-formed token. Accepts 4-6 chars so any
 * pre-existing extended token from the old collision scheme keeps working;
 * new tokens are always 4 chars.
 */
export function isValidToken(s: unknown): s is string {
	if (typeof s !== "string") return false;
	return /^[0-9A-Z]{4,6}$/.test(s);
}
