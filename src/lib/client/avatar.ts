/**
 * Deterministic per-name avatar — a hash-derived hue plus the first letter.
 * No network requests, no stored images: same display name always renders
 * the same color, computed locally.
 */

function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

export function avatarColor(name: string): string {
	const hue = hashString(name) % 360;
	return `hsl(${hue}, 45%, 38%)`;
}

export function avatarLetter(name: string): string {
	const trimmed = name.trim();
	return trimmed ? trimmed[0].toUpperCase() : "?";
}
