/**
 * Share-link token generation using Crockford's Base32 with error-tolerant decoding.
 *
 * Format: fixed 4-character Crockford Base32 [0-9ABCDEFGHJKMNPQRSTVWXYZ] (32 symbols).
 * Combinations: 32^4 = 1,048,576.
 *
 * Excluded from generation:
 *   - I (looks like 1)
 *   - L (looks like 1)
 *   - O (looks like 0)
 *   - U (looks like V, and excluded by Crockford to avoid accidental obscenities)
 *
 * Error-tolerant decoding (normalizeToken):
 *   - O, o -> 0
 *   - I, i, L, l -> 1
 *   - U, u -> V
 *   - Case-insensitive (a-z -> A-Z)
 *   - Hyphens and whitespace are ignored
 *   - Invalid characters are rejected
 *
 * Collision handling: caller passes an `exists` function; on collision we
 * simply redraw. The active-share pool is capped at MAX_TOTAL_COUNT
 * (a small fraction of the token space, enforced in upload/init), so the
 * per-draw collision probability stays low.
 */

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 4;

/**
 * Generate a random token of exactly `length` characters from the Crockford Base32 alphabet.
 *
 * 256 % 32 === 0, so `crypto.getRandomValues` has zero modulo bias across 32 characters.
 */
export function generateToken(length = TOKEN_LENGTH): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = "";
	for (let i = 0; i < length; i++) {
		out += CROCKFORD_ALPHABET[bytes[i] & 31];
	}
	return out;
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
		const candidate = generateToken(TOKEN_LENGTH);
		if (!(await exists(candidate))) return candidate;
	}
	throw new Error("Could not generate a unique token after maximum attempts");
}

/**
 * Normalize and decode a share token with Crockford Base32 error tolerance:
 * - Case-insensitive (converts to uppercase)
 * - Strips hyphens and whitespace
 * - Maps 'O' -> '0'
 * - Maps 'I' / 'L' -> '1'
 * - Maps 'U' -> 'V'
 * - Rejects non-base32 characters
 * - Accepts 4-6 chars (4 for all new tokens, up to 6 for legacy compatibility)
 *
 * Returns canonical uppercase Crockford token string, or null if invalid.
 */
export function normalizeToken(s: unknown): string | null {
	if (typeof s !== "string") return null;
	const cleaned = s.trim().replace(/[-\s]/g, "").toUpperCase();
	if (!cleaned) return null;

	let normalized = "";
	for (let i = 0; i < cleaned.length; i++) {
		const ch = cleaned[i];
		if (ch === "O") {
			normalized += "0";
		} else if (ch === "I" || ch === "L") {
			normalized += "1";
		} else if (ch === "U") {
			normalized += "V";
		} else {
			normalized += ch;
		}
	}

	if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4,6}$/.test(normalized)) {
		return null;
	}
	return normalized;
}

/**
 * Validate that a string is a well-formed canonical or error-tolerantly decodable token.
 */
export function isValidToken(s: unknown): s is string {
	return normalizeToken(s) !== null;
}
