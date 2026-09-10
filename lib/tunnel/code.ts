/**
 * Clipboard-tunnel code generation.
 *
 * Format: 'Z' + 3-char Crockford Base32 (see lib/share/token.ts —
 * TUNNEL_PREFIX is reserved there so share tokens never draw it).
 * Combinations: 32^3 = 32,768.
 */

import { CROCKFORD_ALPHABET, TUNNEL_PREFIX } from "../share/token";

export const TUNNEL_CODE_LENGTH = 4;

export function generateTunnelCode(): string {
	const bytes = new Uint8Array(TUNNEL_CODE_LENGTH - 1);
	crypto.getRandomValues(bytes);
	let out = TUNNEL_PREFIX;
	for (let i = 0; i < bytes.length; i++) {
		out += CROCKFORD_ALPHABET[bytes[i] & 31];
	}
	return out;
}

export async function generateUniqueTunnelCode(
	exists: (code: string) => Promise<boolean>,
	maxAttempts = 32,
): Promise<string> {
	for (let i = 0; i < maxAttempts; i++) {
		const candidate = generateTunnelCode();
		if (!(await exists(candidate))) return candidate;
	}
	throw new Error("Could not generate a unique tunnel code after maximum attempts");
}

/** Normalize and validate a tunnel-code-shaped input (same error tolerance as share tokens). */
export function normalizeTunnelCode(s: unknown): string | null {
	if (typeof s !== "string") return null;
	const cleaned = s.trim().replace(/[-\s]/g, "").toUpperCase();
	if (!cleaned) return null;

	let normalized = "";
	for (const ch of cleaned) {
		if (ch === "O") normalized += "0";
		else if (ch === "I" || ch === "L") normalized += "1";
		else if (ch === "U") normalized += "V";
		else normalized += ch;
	}

	if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/.test(normalized)) return null;
	if (normalized[0] !== TUNNEL_PREFIX) return null;
	return normalized;
}

export function isTunnelCode(s: unknown): boolean {
	return normalizeTunnelCode(s) !== null;
}
