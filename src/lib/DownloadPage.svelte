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

<main class="wrap">
	<div class="download-card">

		{#if status === 'loading'}
			<div class="panel">
				<div class="panel-head">
					<span class="tag">›</span> loading
				</div>
				<div class="panel-body" style="text-align:center; color:var(--text-dim); font-family:var(--mono); font-size:13px;">
					loading…
				</div>
			</div>
		{/if}

		{#if status === 'missing'}
			<div class="panel" style="border-color:rgba(252,165,165,0.3);">
				<div class="panel-head" style="color:var(--error);">
					<span class="tag" style="color:var(--error);">✗</span> link_not_found
				</div>
				<div class="panel-body" style="text-align:center; color:var(--text-dim); font-family:var(--mono); font-size:13px;">
					this share link doesn&apos;t exist or has been removed.
				</div>
			</div>
		{/if}

		{#if status === 'expired'}
			<div class="panel" style="border-color:rgba(253,224,71,0.3);">
				<div class="panel-head" style="color:var(--warn);">
					<span class="tag" style="color:var(--warn);">!</span> link_expired
				</div>
				<div class="panel-body" style="text-align:center; color:var(--text-dim); font-family:var(--mono); font-size:13px;">
					this share has expired and the file has been deleted.
				</div>
			</div>
		{/if}

		{#if (status === 'password-required' || status === 'wrong-password') && info}
			<div class="panel">
				<div class="panel-head">
					<span class="tag">›</span> password_required
					<span class="meta">{info.download_count} downloads</span>
				</div>
				<div class="panel-body">
					<div class="download-filename">{info.filename}</div>
					<dl class="meta-list" style="border:none; padding:0;">
						<dt>size</dt><dd>{formatBytes(info.size_bytes)}</dd>
						<dt>type</dt><dd>{info.content_type || '—'}</dd>
						<dt>expires</dt><dd>{formatRelativeTime(info.expires_at)}</dd>
					</dl>

					<form class="password-form" onsubmit={(e) => { e.preventDefault(); downloadWithPassword(); }}>
						<p class="warn">this file is password-protected</p>
						<input
							class="input"
							type="password"
							bind:value={password}
							onkeydown={(e) => { if (e.key === 'Enter') downloadWithPassword(); }}
							placeholder="enter password"
							autofocus
						/>
						{#if errorMsg}
							<p class="download-error">{errorMsg}</p>
						{/if}
						<button class="btn primary" type="submit" disabled={verifying || !password}>
							{verifying ? 'Verifying…' : status === 'wrong-password' ? 'Try again' : 'Verify & Download'}
						</button>
						{#if status === 'wrong-password'}
							<button type="button" class="btn outline" style="margin-top:6px;" onclick={retryPassword}>
								Reset
							</button>
						{/if}
					</form>
				</div>
			</div>
		{/if}

		{#if status === 'ok' && info && !info.has_password}
			<div class="panel">
				<div class="panel-head">
					<span class="tag">›</span> file_info
					<span class="meta">{info.download_count} downloads · cache HIT</span>
				</div>
				<div class="panel-body">
					<div class="download-filename">{info.filename}</div>
					<dl class="meta-list" style="border:none; padding:0;">
						<dt>size</dt><dd>{formatBytes(info.size_bytes)}</dd>
						<dt>type</dt><dd>{info.content_type || '—'}</dd>
						<dt>expires</dt><dd>{formatRelativeTime(info.expires_at)}</dd>
						<dt>cache</dt><dd class="accent">edge HIT · 0 S3 calls</dd>
					</dl>
					<hr class="divider">
					<button class="btn primary" style="width:100%; padding:11px;" onclick={download}>
						↓ Download
					</button>
					<p class="dropzone-meta" style="margin-top:12px; text-align:center;">
						direct: <code style="color:var(--accent);">/api/download/{token}</code>
					</p>
				</div>
			</div>
		{/if}

	</div>
</main>
