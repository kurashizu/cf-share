<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let {
		shareToken,
		shareUrl,
		fullUrl,
		proxyUrl,
		expiresAt,
		filename,
		size,
		startedAt,
		password
	}: {
		shareToken: string;
		shareUrl: string;
		fullUrl: string;
		proxyUrl: string | null;
		expiresAt: number;
		filename: string;
		size: number;
		startedAt: number;
		password: string;
	} = $props();

	let copied = $state(false);
	let copiedCode = $state(false);
	let copiedDirect = $state(false);
	let copiedProxied = $state(false);
	let now = $state(Date.now());
	let canvasRef = $state<HTMLCanvasElement | null>(null);

	const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
	const directDownloadUrl = $derived(
		`${baseUrl}/api/download/${shareToken}${password ? `?password=${encodeURIComponent(password)}` : ''}`
	);
	const proxiedDownloadUrl = $derived(proxyUrl ? `${baseUrl}${proxyUrl}` : null);

	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	onMount(() => {
		if (!canvasRef) return;
		// Render at 2x the displayed size so the QR stays crisp on retina.
		QRCode.toCanvas(canvasRef, fullUrl, {
			width: 328,
			margin: 1,
			color: { dark: '#000000', light: '#ffffff' }
		})
			.then(() => {
				// qrcode sets inline style.width/height to the render size;
				// clear them so the stylesheet controls the displayed size.
				if (canvasRef) {
					canvasRef.style.width = '';
					canvasRef.style.height = '';
				}
			})
			.catch(() => {
				// ignore
			});
	});

	async function onCopy(text: string, setter: (v: boolean) => void, btn: HTMLButtonElement) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		setter(true);
		if (btn && !btn.dataset.keepLabel) {
			const orig = btn.dataset.orig ?? btn.textContent ?? '';
			btn.dataset.orig = orig;
			btn.textContent = 'Copied ✓';
			btn.classList.add('copied');
			setTimeout(() => {
				btn.textContent = orig;
				btn.classList.remove('copied');
			}, 1400);
		}
		setTimeout(() => setter(false), 1500);
	}

	const remainingMs = $derived(Math.max(0, expiresAt - now));
	const remainingLabel = $derived(expiresAt === 0 ? 'never' : formatRemaining(remainingMs));
	const elapsed = $derived((now - startedAt) / 1000);

	function formatRemaining(ms: number): string {
		if (ms <= 0) return 'expired';
		const s = Math.floor(ms / 1000);
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d > 0) return `in ${d}d ${h}h`;
		if (h > 0) return `in ${h}h ${m}m`;
		return `in ${m}m`;
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
		return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
	}
</script>

<div class="panel" style="margin-top:14px;">
	<div class="panel-head">
		<span class="tag">›</span> share_link
		<span class="meta">{remainingLabel}</span>
	</div>
	<div class="panel-body">
		<div class="result-hero">
			<button
				class="share-code"
				data-keep-label="1"
				title="click to copy the code"
				onclick={(e) => onCopy(shareToken, (v) => (copiedCode = v), e.currentTarget)}
			>
				<span class="share-code-label">share code {copiedCode ? '· copied ✓' : '· click to copy'}</span>
				<span class="share-code-value">{shareToken}</span>
				<span class="share-code-hint">enter this code on the home page to receive</span>
			</button>

			<div class="qr">
				<canvas bind:this={canvasRef} width={328} height={328}></canvas>
			</div>
		</div>

		<div class="share-link">
			<span class="small">share url</span>
			{directDownloadUrl.startsWith(baseUrl + '/api/download/') ? baseUrl + '/d/' + shareToken : fullUrl}
		</div>

		<div class="btn-row">
			<button
				class="btn primary"
				onclick={(e) => onCopy(fullUrl, (v) => (copied = v), e.currentTarget)}
			>
				{copied ? 'Copied ✓' : 'Copy link'}
			</button>
			<button
				class="btn outline"
				onclick={(e) => onCopy(directDownloadUrl, (v) => (copiedDirect = v), e.currentTarget)}
			>
				{copiedDirect ? 'Copied ✓' : 'Copy direct link'}
			</button>
			{#if proxiedDownloadUrl}
				<button class="btn outline" onclick={(e) => onCopy(proxiedDownloadUrl!, (v) => (copiedProxied = v), e.currentTarget)}>
					{copiedProxied ? 'Copied ✓' : 'Copy proxied link'}
				</button>
			{/if}
			<button class="btn outline" onclick={() => window.location.reload()}>New upload</button>
		</div>

		{#if password}
			<p class="password-form warn" style="margin-top:0;">
				direct link includes password via ?password=
			</p>
		{/if}

		<dl class="meta-list">
			<dt>filename</dt><dd class="truncate" title={filename}>{filename}</dd>
			<dt>size</dt><dd>{formatBytes(size)}</dd>
			<dt>elapsed</dt><dd>{elapsed.toFixed(1)}s</dd>
			<dt>expires</dt><dd>{remainingLabel}</dd>
			<dt>password</dt><dd>{password || '—'}</dd>
			<dt>delivery</dt><dd class="success">direct S3 stream</dd>
		</dl>

		<p class="dropzone-meta" style="margin-top:14px;">
			Anyone with this link can download the file until it expires. After expiry, the
			file is deleted from storage.
		</p>
	</div>
</div>
