<script lang="ts">
	import { onMount } from 'svelte';

	interface ShareInfo {
		filename: string;
		size_bytes: number;
		content_type: string;
		expires_at: number;
		download_count: number;
		has_password?: boolean;
	}

	let {
		token
	}: {
		token: string;
	} = $props();

	type PageStatus =
		| 'loading'
		| 'ok'
		| 'missing'
		| 'expired'
		| 'password-required'
		| 'wrong-password'
		| 'downloading';

	let info = $state<ShareInfo | null>(null);
	let status = $state<PageStatus>('loading');
	let password = $state('');
	let downloadUrl = $state<string | null>(null);
	let errorMsg = $state('');
	let verifying = $state(false);

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				const r = await fetch(`/api/download/${token}?info=1`, { cache: 'no-store' });
				if (cancelled) return;
				if (r.status === 404) {
					status = 'missing';
					return;
				}
				if (!r.ok) {
					status = 'missing';
					return;
				}
				const data = (await r.json()) as ShareInfo;
				info = data;
				status = data.has_password ? 'password-required' : 'ok';
			} catch {
				if (!cancelled) status = 'missing';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function download() {
		window.location.href = `/api/download/${token}`;
	}

	async function downloadWithPassword() {
		if (!password) {
			errorMsg = 'Please enter a password.';
			return;
		}
		verifying = true;
		errorMsg = '';
		try {
			const r = await fetch(`/api/download/${token}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (r.status === 401) {
				verifying = false;
				status = 'wrong-password';
				errorMsg = 'Invalid password. Please try again.';
				return;
			}
			if (r.status === 404) {
				verifying = false;
				status = 'missing';
				return;
			}
			if (!r.ok) {
				throw new Error(`HTTP ${r.status}`);
			}
			const data = (await r.json()) as {
				verified?: boolean;
				downloadUrl?: string;
				error?: string;
			};
			if (data.verified && data.downloadUrl) {
				downloadUrl = data.downloadUrl;
				verifying = false;
				const win = window.open(data.downloadUrl, '_blank');
				if (!win) {
					// Popup blocker — fall back to same-window navigation.
					window.location.href = data.downloadUrl;
				}
			} else {
				throw new Error(data.error || 'Verification failed');
			}
		} catch (err) {
			verifying = false;
			errorMsg =
				err instanceof Error ? err.message : 'Network error. Please try again.';
			status = 'wrong-password';
		}
	}

	function retryPassword() {
		status = 'password-required';
		errorMsg = '';
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
		return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
	}

	function formatRelativeTime(ts: number): string {
		const diff = ts - Date.now();
		if (diff < 0) return 'expired';
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 60) return `in ${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `in ${hours}h`;
		const days = Math.floor(hours / 24);
		return `in ${days}d`;
	}
</script>

<main class="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
	<div class="w-full max-w-md">
		{#if status === 'loading'}
			<div class="text-center text-neutral-500 dark:text-neutral-400">Loading…</div>
		{/if}

		{#if status === 'missing'}
			<div class="text-center space-y-2">
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
					Link not found
				</h1>
				<p class="text-neutral-600 dark:text-neutral-400">
					This share link doesn&apos;t exist or has been removed.
				</p>
			</div>
		{/if}

		{#if status === 'expired'}
			<div class="text-center space-y-2">
				<h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
					Link expired
				</h1>
				<p class="text-neutral-600 dark:text-neutral-400">
					This share has expired and the file has been deleted.
				</p>
			</div>
		{/if}

		{#if status === 'password-required' && info}
			<div class="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4">
				<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50 break-all">
					{info.filename}
				</h1>
				<dl class="text-sm space-y-1 text-neutral-600 dark:text-neutral-400">
					<div class="flex justify-between">
						<dt>Size</dt>
						<dd>{formatBytes(info.size_bytes)}</dd>
					</div>
					<div class="flex justify-between">
						<dt>Type</dt>
						<dd class="font-mono text-xs">{info.content_type}</dd>
					</div>
				</dl>
				<div class="border-t border-neutral-200 dark:border-neutral-700 pt-4">
					<p class="text-sm text-amber-600 dark:text-amber-400 font-medium mb-2">
						🔒 This file is password-protected
					</p>
					<input
						bind:value={password}
						type="password"
						onkeydown={(e) => {
							if (e.key === 'Enter') downloadWithPassword();
						}}
						placeholder="Enter password"
						autofocus
						class="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
					/>
					{#if errorMsg}
						<p class="text-xs text-red-600 dark:text-red-400 mb-3">{errorMsg}</p>
					{/if}
					<button
						onclick={downloadWithPassword}
						disabled={verifying}
						class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium"
					>
						{verifying ? 'Verifying…' : 'Download'}
					</button>
				</div>
			</div>
		{/if}

		{#if status === 'wrong-password' && info}
			<div class="border border-red-200 dark:border-red-900 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4">
				<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50 break-all">
					{info.filename}
				</h1>
				<p class="text-sm text-red-600 dark:text-red-400">
					{errorMsg || 'Invalid password.'}
				</p>
				<button
					onclick={retryPassword}
					class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
				>
					Try Again
				</button>
			</div>
		{/if}

		{#if status === 'ok' && info && !info.has_password}
			<div class="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4">
				<h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50 break-all">
					{info.filename}
				</h1>
				<dl class="text-sm space-y-1 text-neutral-600 dark:text-neutral-400">
					<div class="flex justify-between">
						<dt>Size</dt>
						<dd>{formatBytes(info.size_bytes)}</dd>
					</div>
					<div class="flex justify-between">
						<dt>Type</dt>
						<dd class="font-mono text-xs">{info.content_type}</dd>
					</div>
					<div class="flex justify-between">
						<dt>Downloads</dt>
						<dd>{info.download_count}</dd>
					</div>
					<div class="flex justify-between">
						<dt>Expires</dt>
						<dd>{formatRelativeTime(info.expires_at)}</dd>
					</div>
				</dl>
				<button
					onclick={download}
					class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
				>
					Download
				</button>
				<p class="text-xs text-neutral-500 dark:text-neutral-500 text-center">
					Direct link:{' '}
					<code class="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded">
						/api/download/{token}
					</code>
				</p>
			</div>
		{/if}
	</div>
</main>
