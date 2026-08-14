/**
 * Build a standards-compliant attachment Content-Disposition value.
 *
 * Fetch/Workers headers are byte-oriented and do not reliably accept raw
 * Unicode values. Keep an ASCII fallback for old clients and carry the real
 * filename in RFC 5987's UTF-8 filename* parameter.
 */
export function contentDisposition(filename: string): string {
	const cleaned = filename.replace(/[\r\n]/g, '').trim() || 'download';
	const fallback =
		cleaned
			.normalize('NFKD')
			.replace(/[^\x20-\x7e]/g, '_')
			.replace(/["\\]/g, '_')
			.replace(/;+/g, '_')
			.trim() || 'download';

	const encoded = encodeURIComponent(cleaned).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	);

	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
