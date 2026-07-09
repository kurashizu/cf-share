/**
 * Share-link token generation.
 *
 * Format: [0-9A-Z]{4-6}
 *   - 4 chars: 1,679,616 combinations (chosen for memorability)
 *   - On collision, extend to 5 then 6 chars
 *
 * Collision handling: caller passes a `exists` function; if the token is
 * already taken, we extend length and retry. This is safe because length
 * only grows (so existing shorter tokens remain valid).
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
 * Generate a unique token. Tries lengths 4 → 5 → 6 in order.
 *
 * @param exists async function that returns true if the candidate is taken
 * @param maxAttempts per length before giving up and moving on
 * @throws if no token found in [4, 5, 6] within maxAttempts each
 */
export async function generateUniqueToken(
	exists: (token: string) => Promise<boolean>,
	maxAttempts = 10,
): Promise<string> {
	for (const len of [4, 5, 6]) {
		for (let i = 0; i < maxAttempts; i++) {
			const candidate = generateToken(len);
			if (!(await exists(candidate))) return candidate;
		}
	}
	throw new Error("Could not generate a unique token after maximum attempts");
}

/** Validate that a string is a well-formed token (defensive, not strictly needed). */
export function isValidToken(s: unknown): s is string {
	if (typeof s !== "string") return false;
	return /^[0-9A-Z]{4,6}$/.test(s);
}
