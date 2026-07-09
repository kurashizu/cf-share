/**
 * S3 upload policy — filename sanitization, path layout, size limits.
 *
 * No file-type restrictions per product decision (any file type allowed).
 * Only size, filename, and path shape are validated.
 */

/** Strip path separators, control characters, and trailing dots. */
export function sanitizeFilename(name: string): string {
	let s = name
		.normalize("NFKC")
		.replace(/[\u0000-\u001f\u007f]/g, "") // control chars
		.replace(/[/\\]/g, "")                  // path separators
		.replace(/\.\.+/g, ".")                 // collapse ".." sequences
		.replace(/^\.+/, "")                    // leading dots
		.trim();

	// Limit length; keep extension if present.
	if (s.length > 200) {
		const dot = s.lastIndexOf(".");
		if (dot > 0 && s.length - dot <= 16) {
			const ext = s.slice(dot);
			s = s.slice(0, 200 - ext.length) + ext;
		} else {
			s = s.slice(0, 200);
		}
	}

	// Empty fallback.
	return s || "file";
}

/**
 * Build the S3 key for a share.
 *
 * Layout: uploads/{YYYY}/{MM}/{DD}/{share-token}/{filename}
 *
 * `shareToken` is a 4-6 char [0-9A-Z] string generated at complete-time.
 * For init-time we use a placeholder that the client echoes back, so we can
 * still bucket by the (eventual) token in the directory tree.
 */
export function buildS3Key(args: {
	shareToken: string;
	filename: string;
	now?: Date;
}): string {
	const d = args.now ?? new Date();
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	const safe = sanitizeFilename(args.filename);
	return `uploads/${yyyy}/${mm}/${dd}/${args.shareToken}/${safe}`;
}

/** Encode a filename segment for use in the S3 key (RFC 3986 unreserved). */
export function encodeKeySegment(s: string): string {
	return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Validate a Content-Type header. We accept any string but reject empty. */
export function validateContentType(ct: unknown): string | null {
	if (typeof ct !== "string") return null;
	const trimmed = ct.trim();
	if (!trimmed) return null;
	if (trimmed.length > 200) return null;
	// Reject CRLF (header injection) and obvious garbage.
	if (/[\r\n]/.test(trimmed)) return null;
	return trimmed;
}

/** Validate a positive integer in [1, max]. */
export function validateSize(size: unknown, max: number): number | null {
	if (typeof size !== "number" || !Number.isFinite(size) || !Number.isInteger(size)) return null;
	if (size < 1 || size > max) return null;
	return size;
}
