<svelte:head>
	<title>Admin — KRSZ Share</title>
</svelte:head>

<script lang="ts">
	import { onMount } from 'svelte';
	import Uploader from '$lib/Uploader.svelte';

	/* ================================================================== */
	/*  Types                                                             */
	/* ================================================================== */

	interface ShareRow {
		token: string;
		bucket: string;
		s3_key: string;
		filename: string;
		size_bytes: number;
		content_type: string;
		expires_at: number;
		created_at: number;
		created_ip: string | null;
		user_agent: string | null;
		download_count: number;
		last_download_at: number | null;
	}

	interface AuditRow {
		id: number;
		ts: number;
		ip: string | null;
		action: string;
		share_token: string | null;
		status: number | null;
		detail_json: string | null;
	}

	interface SharesData {
		shares: ShareRow[];
		stats: {
			total: number;
			active: number;
			expired: number;
			totalBytes: number;
			activeBytes: number;
		};
		page: number;
		totalPages: number;
		totalShares: number;
	}

	interface AuditData {
		entries: AuditRow[];
		actions: string[];
		stats: {
			total: number;
			uniqueIps: number;
			lastTs: number | null;
		};
		page: number;
		totalPages: number;
		totalEntries: number;
	}

	type TabId = 'shares' | 'audit' | 'upload';

	/* ================================================================== */
	/*  Helpers                                                           */
	/* ================================================================== */

	function fmtSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
	}

	function fmtDate(ts: number): string {
		return new Date(ts).toLocaleString();
	}

	function fmtDuration(ts: number): string {
		const sec = Math.floor((Date.now() - ts) / 1000);
		if (sec < 60) return `${sec}s ago`;
		if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
		if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
		return `${Math.floor(sec / 86400)}d ago`;
	}

	function isExpired(ts: number): boolean {
		return ts < Date.now();
	}

	function pages(current: number, total: number): (number | null)[] {
		if (total <= 10) {
			return Array.from({ length: total }, (_, i) => i + 1);
		}
		const result: (number | null)[] = [];
		const start = Math.max(1, current - 4);
		const end = Math.min(total, current + 4);
		if (start > 1) {
			result.push(1);
			if (start > 2) result.push(null);
		}
		for (let i = start; i <= end; i++) result.push(i);
		if (end < total) {
			if (end < total - 1) result.push(null);
			result.push(total);
		}
		return result;
	}

	// Map raw action name → tag-act colour class (defined in app.css).
	const actionTagClass: Record<string, string> = {
		init: 'tag-act init',
		complete: 'tag-act complete',
		download: 'tag-act download',
		expire: 'tag-act expire',
		delete: 'tag-act delete',
		admin_view: 'tag-act admin_view'
	};

	/* ================================================================== */
	/*  State                                                             */
	/* ================================================================== */

	let tab = $state<TabId>('shares');

	let sharesData = $state<SharesData | null>(null);
	let sharePage = $state(1);
	let shareQuery = $state('');
	let shareQueryInput = $state('');
	let shareShowAll = $state(false);
	let sharesLoading = $state(true);

	let auditData = $state<AuditData | null>(null);
	let auditPage = $state(1);
	let auditQuery = $state('');
	let auditQueryInput = $state('');
	let auditAction = $state('');
	let auditLoading = $state(true);

	let deleteToken = $state<string | null>(null);
	let authChecked = $state(false);

	/* ================================================================== */
	/*  Data loading                                                      */
	/* ================================================================== */

	async function loadShares(page: number, q: string, all: boolean) {
		sharesLoading = true;
		try {
			const params = new URLSearchParams({ page: String(page) });
			if (q) params.set('q', q);
			if (all) params.set('all', '1');

			const res = await fetch(`/api/admin/shares?${params}`, {
				credentials: 'same-origin'
			});
			if (res.status === 401) {
				window.location.replace('/admin/login');
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const data: SharesData = await res.json();
			sharesData = data;
		} catch (err) {
			console.error('Failed to load shares:', err);
		} finally {
			sharesLoading = false;
		}
	}

	async function loadAudit(page: number, q: string, action: string) {
		auditLoading = true;
		try {
			const params = new URLSearchParams({ apage: String(page) });
			if (q) params.set('aq', q);
			if (action) params.set('aaction', action);

			const res = await fetch(`/api/admin/audit?${params}`, {
				credentials: 'same-origin'
			});
			if (res.status === 401) {
				window.location.replace('/admin/login');
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const data: AuditData = await res.json();
			auditData = data;
		} catch (err) {
			console.error('Failed to load audit log:', err);
		} finally {
			auditLoading = false;
		}
	}

	onMount(() => {
		// ── Auth check on mount ──
		fetch('/api/admin/me', { credentials: 'same-origin' })
			.then((r) => {
				if (r.status === 401) {
					window.location.replace('/admin/login');
					return;
				}
				if (!r.ok) throw new Error(`Auth check failed: ${r.status}`);
				authChecked = true;
			})
			.catch((err) => {
				console.error('Auth check error:', err);
				authChecked = true;
			});
	});

	$effect(() => {
		if (!authChecked) return;
		loadShares(sharePage, shareQuery, shareShowAll);
	});

	$effect(() => {
		if (!authChecked) return;
		loadAudit(auditPage, auditQuery, auditAction);
	});

	async function handleDelete(token: string) {
		deleteToken = token;
		try {
			const res = await fetch(
				`/api/admin/delete?token=${encodeURIComponent(token)}`,
				{ method: 'DELETE', credentials: 'same-origin' }
			);
			if (res.status === 401) {
				window.location.replace('/admin/login');
				return;
			}
			const data: { success?: boolean; error?: string } = await res.json();
			if (data.success) {
				if (tab === 'shares') {
					await loadShares(sharePage, shareQuery, shareShowAll);
				}
			} else {
				alert('Delete failed: ' + (data.error || 'Unknown error'));
			}
		} catch (err) {
			alert(
				'Network error: ' + (err instanceof Error ? err.message : String(err))
			);
		} finally {
			deleteToken = null;
		}
	}

	async function handleLogout() {
		try {
			await fetch('/api/admin/logout', {
				method: 'POST',
				credentials: 'same-origin'
			});
		} finally {
			window.location.replace('/admin/login');
		}
	}

	/* ================================================================== */
	/*  Sub-components (inline)                                            */
	/* ================================================================== */
</script>

<main class="wrap">

	<div class="hero">
	<div class="hero-logo"><img src="/favicon.svg" alt="KRSZ Share" /></div>
		<div>
			<h1>admin_panel</h1>
			<p>
				<a href="/" style="color:var(--accent); text-decoration:none;">← back to home</a>
				<span style="color:var(--text-faint); margin:0 6px;">·</span>
				<a href="/docs" style="color:var(--accent); text-decoration:none;">api docs</a>
			</p>
		</div>
		<button class="btn" style="margin-left:auto;" onclick={handleLogout}>logout</button>
	</div>

	<!-- Tabs -->
	<div class="tabs">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Admin Panel</h1>
			<p class="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
				<a href="/" class="text-blue-600 dark:text-blue-400 hover:underline">← Back to Home</a>
				<span class="mx-2">&middot;</span>
				<a href="/docs" class="text-blue-600 dark:text-blue-400 hover:underline">API Docs</a>
			</p>
		</div>
		<button
			type="button"
			onclick={handleLogout}
			class="self-start sm:self-auto px-3 py-1.5 text-sm border border-neutral-300 dark:border-neutral-700 rounded-md text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
		>
			Log out
		</button>
	</div>

	<div class="tabs">
		<button class="tab {tab === 'shares' ? 'active' : ''}" onclick={() => (tab = 'shares')}>shares</button>
		<button class="tab {tab === 'audit' ? 'active' : ''}" onclick={() => (tab = 'audit')}>audit log</button>
		<button class="tab {tab === 'upload' ? 'active' : ''}" onclick={() => (tab = 'upload')}>upload</button>
	</div>

	<!-- ── Shares Tab ──────────────────────────────────────────────────── -->
	{#if tab === 'shares'}
		{#if sharesData}
			<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-neutral-500">Total</div>
					<div class="text-xl font-semibold mt-1">{sharesData.stats.total}</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-green-600 dark:text-green-400">Active</div>
					<div class="text-xl font-semibold mt-1">{sharesData.stats.active}</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-red-500">Expired</div>
					<div class="text-xl font-semibold mt-1">{sharesData.stats.expired}</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-neutral-500">Total Size</div>
					<div class="text-xl font-semibold mt-1">{fmtSize(sharesData.stats.totalBytes)}</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-green-600 dark:text-green-400">Active Size</div>
					<div class="text-xl font-semibold mt-1">{fmtSize(sharesData.stats.activeBytes)}</div>
				</div>
			</div>
		{/if}

		<div class="toolbar">
			<input
				bind:value={shareQueryInput}
				class="input"
				type="text"
				placeholder="search filename or token…"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						shareQuery = shareQueryInput;
						sharePage = 1;
					}
				}}
			/>
			<select class="select" bind:value={shareShowAll} onchange={() => (sharePage = 1)}>
				<option value={false}>active only</option>
				<option value={true}>show all</option>
			</select>
			<button
				class="btn primary"
				onclick={() => {
					shareQuery = shareQueryInput;
					sharePage = 1;
				}}
			>
				Search
			</button>
		</div>

		{#if sharesLoading}
			<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-6">
				{#each Array(8) as _}
					<div class="h-8 bg-neutral-100 dark:bg-neutral-800 rounded mb-2 animate-pulse"></div>
				{/each}
			</div>
		{:else if sharesData && sharesData.shares.length === 0}
			<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-12 text-center text-neutral-400">
				No shares found.
			</div>
		{:else if sharesData}
			<div class="overflow-x-auto bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Token</th>
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Filename</th>
							<th class="text-right px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Size</th>
							<th class="hidden md:table-cell text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Type</th>
							<th class="hidden lg:table-cell text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Created</th>
							<th class="hidden lg:table-cell text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Expires</th>
							<th class="hidden sm:table-cell text-right px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">DLs</th>
							<th class="hidden xl:table-cell text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">IP</th>
							<th class="text-center px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Action</th>
						</tr>
					</thead>
					<tbody>
						{#each sharesData.shares as share (share.token)}
							{@const expired = isExpired(share.expires_at)}
							<tr
								class="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors {expired
									? 'opacity-60'
									: ''}"
							>
								<td class="px-3 py-2.5">
									<a
										href={`/d/${share.token}`}
										target="_blank"
										rel="noreferrer"
										class="text-blue-600 dark:text-blue-400 hover:underline font-mono"
									>
										{share.token}
									</a>
								</td>
								<td class="px-3 py-2.5 max-w-[200px] truncate" title={share.filename}>
									{share.filename}
								</td>
								<td class="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
									{fmtSize(share.size_bytes)}
								</td>
								<td class="hidden md:table-cell px-3 py-2.5 text-xs text-neutral-500 max-w-[100px] truncate">
									{share.content_type || '—'}
								</td>
								<td class="hidden lg:table-cell px-3 py-2.5 text-xs text-neutral-500 tabular-nums">
									{fmtDate(share.created_at)}
								</td>
								<td
									class="hidden lg:table-cell px-3 py-2.5 text-xs tabular-nums {expired
										? 'status-4xx'
										: 'status-2xx'}"
								>
									{fmtDate(share.expires_at)}
								</td>
								<td class="hidden sm:table-cell px-3 py-2.5 text-right font-mono text-xs tabular-nums">
									{share.download_count}
								</td>
								<td class="hidden xl:table-cell px-3 py-2.5 text-xs text-neutral-500 font-mono">
									{share.created_ip || '—'}
								</td>
								<td class="px-3 py-2.5 text-center">
									<button
										onclick={() => handleDelete(share.token)}
										disabled={deleteToken === share.token}
										class="px-2 py-1 text-xs font-medium rounded transition-colors {deleteToken === share.token
											? 'text-neutral-400 cursor-not-allowed'
											: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'}"
									>
										{deleteToken === share.token ? '…' : 'Delete'}
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if sharesData.totalPages > 1}
				<div class="flex items-center justify-center gap-2 mt-6 flex-wrap">
					{#if sharesData.page > 1}
						<button
							onclick={() => (sharePage = sharesData!.page - 1)}
							class="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
						>
							← Prev
						</button>
					{/if}
					{#each pages(sharesData.page, sharesData.totalPages) as p, i (i)}
						{#if p === null}
							<span class="px-2 text-neutral-400">…</span>
						{:else}
							<button
								onclick={() => (sharePage = p as number)}
								class="px-3 py-1.5 text-sm rounded-lg transition-colors {p === sharesData.page
									? 'bg-blue-600 text-white'
									: 'border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
							>
								{p}
							</button>
						{/if}
					{/each}
					{#if sharesData.page < sharesData.totalPages}
						<button
							onclick={() => (sharePage = sharesData!.page + 1)}
							class="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
						>
							Next →
						</button>
					{/if}
				</div>
			{/if}

			<p class="text-center text-xs text-neutral-400 mt-8">
				Page {sharesData.page} of {sharesData.totalPages} &middot; {sharesData.totalShares}{' '}
				total share(s)
			</p>
		{/if}
	{/if}

	<!-- ── Audit Log Tab ────────────────────────────────────────────────── -->
	{#if tab === 'audit'}
		{#if auditData}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-neutral-500">Total Events</div>
					<div class="text-xl font-semibold mt-1">{auditData.stats.total}</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-neutral-500">Unique IPs</div>
					<div class="text-xl font-semibold mt-1">{auditData.stats.uniqueIps}</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-neutral-500">Last Event</div>
					<div class="text-xl font-semibold mt-1">
						{auditData.stats.lastTs ? fmtDuration(auditData.stats.lastTs) : '—'}
					</div>
				</div>
				<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
					<div class="text-xs uppercase tracking-wider text-neutral-500">Showing</div>
					<div class="text-xl font-semibold mt-1">{auditData.entries.length}</div>
				</div>
			</div>
		{/if}

		<div class="toolbar">
			<input
				bind:value={auditQueryInput}
				class="input"
				type="text"
				placeholder="search ip or share token…"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						auditQuery = auditQueryInput;
						auditPage = 1;
					}
				}}
			/>
			<select class="select" bind:value={auditAction} onchange={() => (auditPage = 1)}>
				<option value="">all actions</option>
				{#each auditData?.actions ?? [] as a (a)}
					<option value={a}>{a}</option>
				{/each}
			</select>
			<button
				class="btn primary"
				onclick={() => {
					auditQuery = auditQueryInput;
					auditPage = 1;
				}}
			>
				Filter
			</button>
			{#each ['init', 'complete', 'download', 'delete'] as act (act)}
				<button
					class="btn {auditAction === act ? 'primary' : 'outline'}"
					onclick={() => {
						auditAction = auditAction === act ? '' : act;
						auditPage = 1;
					}}
				>
					{act}
				</button>
			{/each}
		</div>

		{#if auditLoading}
			<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-6">
				{#each Array(6) as _}
					<div class="h-8 bg-neutral-100 dark:bg-neutral-800 rounded mb-2 animate-pulse"></div>
				{/each}
			</div>
		{:else if auditData && auditData.entries.length === 0}
			<div class="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800 p-12 text-center text-neutral-400">
				No audit log entries found.
			</div>
		{:else if auditData}
			<div class="overflow-x-auto bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-800">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">ID</th>
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Timestamp</th>
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">IP</th>
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Action</th>
							<th class="text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Share</th>
							<th class="text-right px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Status</th>
							<th class="hidden lg:table-cell text-left px-3 py-2.5 font-medium text-neutral-500 text-xs uppercase tracking-wider">Details</th>
						</tr>
					</thead>
					<tbody>
						{#each auditData.entries as e (e.id)}
							<tr class="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors">
								<td class="px-3 py-2.5 font-mono text-xs text-neutral-400">{e.id}</td>
								<td class="px-3 py-2.5 text-xs tabular-nums text-neutral-500" title={fmtDate(e.ts)}>
									{fmtDuration(e.ts)}
								</td>
								<td class="px-3 py-2.5 font-mono text-xs text-neutral-600 dark:text-neutral-400">
									{e.ip || '—'}
								</td>
								<td class="px-3 py-2.5">
									<span
										class="inline-block px-2 py-0.5 rounded text-xs font-medium {actionTagClass[e.action] ??
											'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'}"
									>
										{e.action}
									</span>
								</td>
								<td class="px-3 py-2.5">
									{#if e.share_token}
										<a
											href={`/d/${e.share_token}`}
											target="_blank"
											rel="noreferrer"
											class="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs"
										>
											{e.share_token}
										</a>
									{:else}
										<span class="text-neutral-400">—</span>
									{/if}
								</td>
								<td class="px-3 py-2.5 text-right">
									{#if e.status === null}
										<span class="text-neutral-400">—</span>
									{:else}
										<span
											class="font-mono text-xs tabular-nums {e.status < 300
												? 'status-2xx'
												: e.status < 400
													? 'status-3xx'
													: 'status-4xx'}"
										>
											{e.status}
										</span>
									{/if}
								</td>
								<td class="hidden lg:table-cell px-3 py-2.5 text-xs text-neutral-500 max-w-[300px] truncate">
									{e.detail_json || '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if auditData.totalPages > 1}
				<div class="flex items-center justify-center gap-2 mt-6 flex-wrap">
					{#if auditData.page > 1}
						<button
							onclick={() => (auditPage = auditData!.page - 1)}
							class="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
						>
							← Prev
						</button>
					{/if}
					{#each pages(auditData.page, auditData.totalPages) as p, i (i)}
						{#if p === null}
							<span class="px-2 text-neutral-400">…</span>
						{:else}
							<button
								onclick={() => (auditPage = p as number)}
								class="px-3 py-1.5 text-sm rounded-lg transition-colors {p === auditData.page
									? 'bg-blue-600 text-white'
									: 'border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'}"
							>
								{p}
							</button>
						{/if}
					{/each}
					{#if auditData.page < auditData.totalPages}
						<button
							onclick={() => (auditPage = auditData!.page + 1)}
							class="px-3 py-1.5 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
						>
							Next →
						</button>
					{/if}
				</div>
			{/if}

			<p class="text-center text-xs text-neutral-400 mt-8">
				Page {auditData.page} of {auditData.totalPages} &middot; {auditData.totalEntries}{' '}
				total entries
			</p>
		{/if}
	{/if}

	<!-- ── Upload Tab ───────────────────────────────────────────────────── -->
	{#if tab === 'upload'}
		<div class="max-w-2xl mx-auto">
			<p class="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
				Admin uploads bypass all quotas. Select "No expiry" for shares that never
				expire.
			</p>
			<Uploader
				maxSize={100 * 1024 * 1024 * 1024}
				ttlPresets={[
					{ label: 'No expiry', value: 0 },
					{ label: '5 minutes', value: 300 },
					{ label: '30 minutes', value: 1800 },
					{ label: '1 hour', value: 3600 },
					{ label: '6 hours', value: 21600 },
					{ label: '24 hours', value: 86400 },
					{ label: '3 days', value: 259200 },
					{ label: '7 days', value: 604800 }
				]}
			/>
		</div>
	{/if}
</main>
