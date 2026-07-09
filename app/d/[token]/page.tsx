import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DownloadPage } from "./DownloadPage";

export const runtime = "nodejs";

interface Props {
	params: Promise<{ token: string }>;
}

/**
 * GET /d/:token
 *
 * Renders a download page showing filename, size, expiry, and a "Download"
 * button. The actual 302 redirect to a presigned S3 URL is handled by the
 * separate GET /api/download/:token route — that path is also what `curl`,
 * bots, and agents should hit (with ?direct=1 to skip the HTML).
 */
export default async function DownloadPageRoute({ params }: Props) {
	const { token } = await params;

	return (
		<DownloadPage
			token={token}
			// Real values are fetched client-side to avoid prop-drilling D1 through SSR.
		/>
	);
}
