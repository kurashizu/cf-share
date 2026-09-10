<script lang="ts">
	import { onMount } from 'svelte';

	interface MineShare {
		token: string;
		filename: string;
		sizeBytes: number;
		expiresAt: number;
		createdAt: number;
		downloadCount: number;
		hasPassword: boolean;
	}

	let shares = $state<MineShare[]>([]);
	let loaded = $state(false);
	let deleting = $state<Set<string>>(new Set());
	let clearingAll = $state(false);

	export async function refresh() {
		try {
			const r = await fetch('/api/share/mine', { cache: 'no-store' });
			if (!r.ok) return;
			const data = (await r.json()) as { shares: MineShare[] };
			shares = data.shares;
		} catch {
			// Network hiccup — leave whatever list we had.
		} finally {
			loaded = true;
		}
	}

	onMount(() => {
		refresh();
	});

	async function revoke(token: string) {
		if (deleting.has(token)) return;
		if (!confirm('Delete this share now? Anyone with the link will lose access immediately.')) {
			return;
		}
		deleting = new Set(deleting).add(token);
		try {
			const r = await fetch(`/api/share/${token}`, { method: 'DELETE' });
			if (r.ok) {
				shares = shares.filter((s) => s.token !== token);
			}
		} finally {
			const next = new Set(deleting);
			next.delete(token);
			deleting = next;
		}
	}

	async function revokeAll() {
		if (clearingAll || shares.length === 0) return;
		if (
			!confirm(
				`Delete all ${shares.length} of your shares now? Anyone with a link will lose access immediately. This cannot be undone.`
			)
		) {
			return;
		}
		clearingAll = true;
		const tokens = shares.map((s) => s.token);
		deleting = new Set(tokens);
		try {
			const results = await Promise.allSettled(
				tokens.map((t) => fetch(`/api/share/${t}`, { method: 'DELETE' }))
			);
			const failed = new Set<string>();
			results.forEach((r, i) => {
				if (r.status === 'rejected' || !r.value.ok) failed.add(tokens[i]);
			});
			shares = shares.filter((s) => failed.has(s.token));
		} finally {
			deleting = new Set();
			clearingAll = false;
		}
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
		return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
	}

	function formatExpiry(expiresAt: number): string {
		if (expiresAt === 0) return 'never';
		const ms = expiresAt - Date.now();
		if (ms <= 0) return 'expired';
		const s = Math.floor(ms / 1000);
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}
</script>

{#if loaded && shares.length > 0}
	<div class="panel my-shares-panel">
		<div class="panel-head">
			<span class="tag">›</span> my_shares
			<span class="meta">
				{shares.length} active
				<button class="my-shares-clear-all" disabled={clearingAll} onclick={revokeAll}>
					{clearingAll ? 'Deleting…' : 'Delete all'}
				</button>
			</span>
		</div>
		<div class="panel-body panel-body-flush">
			<ul class="my-shares-list my-shares-list-wide">
				{#each shares as s (s.token)}
					<li class="my-shares-item my-shares-item-wide">
						<a
							href="/d/{s.token}"
							class="my-shares-name"
							title={s.filename}
							data-sveltekit-preload-code="viewport"
							data-sveltekit-preload-data="tap"
						>{s.filename}</a>
						<span class="my-shares-meta">
							{formatBytes(s.sizeBytes)} · expires {formatExpiry(s.expiresAt)}{s.hasPassword
								? ' · locked'
								: ''}
						</span>
						<button
							class="my-shares-del"
							disabled={deleting.has(s.token)}
							title="delete this share"
							onclick={() => revoke(s.token)}
						>
							{deleting.has(s.token) ? '…' : '✕'}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}
