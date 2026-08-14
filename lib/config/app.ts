/**
 * Single source of truth for cf-share's externally-visible hostnames.
 *
 * Why a dedicated config module:
 *   - The SvelteKit docs page and sharetube client need to agree on the
 *     public app URL.
 *   - Centralising these here means renaming the domain (or adding a
 *     staging alias) is a single-file change instead of a hunt across
 *     docs, scripts, and source.
 *
 * IMPORTANT: keep these values in sync with `wrangler.jsonc` `vars`
 * (notably `S3_ENDPOINT` / `S3_BUCKET`) and with the Cloudflare
 * dashboard's custom-domain routing for the `cf-share` Worker.
 *
 * If you change APP_URL here, also update:
 *   - README.md  (Production URL)
 *   - AGENTS.md  (Project section)
 *   - Cloudflare dashboard → cf-share → Triggers → Custom Domains
 *
 * If you change S3_PUBLIC_ENDPOINT here, also update:
 *   - wrangler.jsonc vars.S3_ENDPOINT
 *   - any S3 client constructed outside the Worker (see scripts/)
 */

export const APP_URL = "https://share.krsz.in";
export const APP_HOST = "share.krsz.in";

/**
 * The S3 endpoint as exposed to the browser / API consumers. The Worker
 * uses this internally too, but Worker-side it normally comes from the
 * `S3_ENDPOINT` wrangler var (see `lib/s3/client.ts`).
 */
export const S3_PUBLIC_ENDPOINT = "https://s3api.022025.xyz";

/**
 * Worker name as deployed to Cloudflare — used by the auto-generated
 * `<worker>.workers.dev` URL in docs.
 */
export const WORKER_NAME = "cf-share";