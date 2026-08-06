<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let {
		shareToken,
		shareUrl,
		fullUrl,
		expiresAt,
		filename,
		size,
		startedAt,
		password
	}: {
		shareToken: string;
		shareUrl: string;
		fullUrl: string;
		expiresAt: number;
		filename: string;
		size: number;
		startedAt: number;
		password: string;
	} = $props();

	let copied = $state(false);
	let copiedDirect = $state(false);
	let now = $state(Date.now());
	let canvasRef = $state<HTMLCanvasElement | null>(null);

	const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
	const directDownloadUrl = `${baseUrl}/api/download/${shareToken}${password ? `?password=${encodeURIComponent(password)}` : ''}`;

	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	onMount(() => {
		if (!canvasRef) return;
		QRCode.toCanvas(canvasRef, fullUrl, {
			width: 192,
			margin: 1,
			color: { dark: '#000000', light: '#ffffff' }
		}).catch(() => {
			// ignore
		});
	});

	async function onCopy(text: string, setter: (v: boolean) => void) {
		try {
			await navigator.clipboard.writeText(text);
			setter(true);
			setTimeout(() => setter(false), 1500);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			setter(true);
			setTimeout(() => setter(false), 1500);
		}
	}

	const remainingMs = Math.max(0, expiresAt - now);
	const elapsed = (now - startedAt) / 1000;

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
</script>

<div class="p-4 border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 rounded-lg space-y-4">
	<h3 class="font-semibold text-green-900 dark:text-green-100">Uploaded ✓ · Share link ready</h3>

	<div class="flex flex-col sm:flex-row gap-4 items-start">
		<div class="shrink-0 p-2 bg-white rounded-lg border border-neutral-200 dark:border-neutral-800">
			<canvas bind:this={canvasRef} width={192} height={192}></canvas>
		</div>

		<div class="flex-1 min-w-0 space-y-2">
			<div class="text-sm text-neutral-700 dark:text-neutral-300 break-all">
				<code class="font-mono text-base font-semibold text-neutral-900 dark:text-neutral-50">
					/d/{shareToken}
				</code>
			</div>

			<div class="flex gap-2">
				<button
					onclick={() => onCopy(fullUrl, (v) => (copied = v))}
					class="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
				>
					{copied ? 'Copied ✓' : 'Copy link'}
				</button>
				<button
					onclick={() => onCopy(directDownloadUrl, (v) => (copiedDirect = v))}
					class="px-3 py-1.5 text-sm rounded-md border border-blue-600 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950/30"
				>
					{copiedDirect ? 'Copied ✓' : 'Copy direct link'}
				</button>
			</div>

			{#if password}
				<p class="text-xs text-amber-600 dark:text-amber-400">
					🔒 Direct link includes password via <code>?password=</code>
				</p>
			{/if}

			<dl class="text-xs space-y-0.5 text-neutral-600 dark:text-neutral-400 mt-2">
				<div class="flex gap-2">
					<dt class="w-20 shrink-0">Filename</dt>
					<dd class="truncate">{filename}</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-20 shrink-0">Size</dt>
					<dd>{(size / 1024).toFixed(1)} KB</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-20 shrink-0">Uploaded in</dt>
					<dd>{elapsed.toFixed(1)}s</dd>
				</div>
				<div class="flex gap-2">
					<dt class="w-20 shrink-0">Expires</dt>
					<dd>{formatRemaining(remainingMs)}</dd>
				</div>
			</dl>
		</div>
	</div>

	<div class="text-xs text-neutral-500 dark:text-neutral-500 pt-2 border-t border-green-200 dark:border-green-900">
		Anyone with this link can download the file until it expires. After expiry, the file is
		deleted from storage.
	</div>
</div>