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
		return ts !== 0 && ts < Date.now();
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
			<div class="hero-links">
				<a href="/" class="hero-link">› back to home</a>
				<a href="/docs" class="hero-link">› api docs</a>
			</div>
		</div>
		<button class="btn" style="margin-left:auto;" onclick={handleLogout}>logout</button>
	</div>

	<div class="tabs">
		<button class="tab {tab === 'shares' ? 'active' : ''}" onclick={() => (tab = 'shares')}>shares</button>
		<button class="tab {tab === 'audit' ? 'active' : ''}" onclick={() => (tab = 'audit')}>audit log</button>
		<button class="tab {tab === 'upload' ? 'active' : ''}" onclick={() => (tab = 'upload')}>upload</button>
	</div>

	<!-- ── Shares tab ─────────────────────────────────────────────────── -->
	{#if tab === 'shares'}
		{#if sharesData}
			<div class="admin-grid">
				<div class="admin-stat"><div class="label">total</div><div class="value">{sharesData.stats.total}</div></div>
				<div class="admin-stat green"><div class="label">active</div><div class="value">{sharesData.stats.active}</div></div>
				<div class="admin-stat red"><div class="label">expired</div><div class="value">{sharesData.stats.expired}</div></div>
				<div class="admin-stat"><div class="label">total size</div><div class="value">{fmtSize(sharesData.stats.totalBytes)}</div></div>
				<div class="admin-stat green"><div class="label">active size</div><div class="value">{fmtSize(sharesData.stats.activeBytes)}</div></div>
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
			<div class="panel">
				<div class="panel-body" style="padding:24px;">
					{#each Array(8) as _}
						<div style="height:36px; background:var(--surface-2); border-radius:4px; margin-bottom:8px;" class="skeleton"></div>
					{/each}
				</div>
			</div>
		{:else if sharesData && sharesData.shares.length === 0}
			<div class="panel">
				<div class="panel-body" style="text-align:center; color:var(--text-faint); font-family:var(--mono); font-size:13px;">
					no shares found.
				</div>
			</div>
		{:else if sharesData}
			<div class="panel">
				<div class="panel-head">
					<span class="tag">›</span> shares
					<span class="meta">page {sharesData.page} of {sharesData.totalPages} · {sharesData.totalShares} total</span>
				</div>
				<div class="panel-body panel-body-flush" style="overflow-x:auto;">
					<table>
						<thead>
							<tr>
								<th>token</th>
								<th>filename</th>
								<th style="text-align:right;">size</th>
								<th class="hide-md">type</th>
								<th class="hide-md">created</th>
								<th class="hide-md">expires</th>
								<th class="hide-sm" style="text-align:right;">dls</th>
								<th class="hide-lg">ip</th>
								<th style="text-align:center;">act</th>
							</tr>
						</thead>
						<tbody>
							{#each sharesData.shares as share (share.token)}
								{@const expired = isExpired(share.expires_at)}
								<tr style={expired ? 'opacity:0.55;' : ''}>
									<td>
										<a href={`/d/${share.token}`} target="_blank" rel="noreferrer">{share.token}</a>
									</td>
									<td style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title={share.filename}>
										{share.filename}
									</td>
									<td style="text-align:right;">{fmtSize(share.size_bytes)}</td>
									<td class="hide-md" style="max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
										{share.content_type || '—'}
									</td>
									<td class="hide-md">{fmtDate(share.created_at)}</td>
									<td class="hide-md {expired ? 'status-4xx' : 'status-2xx'}">{share.expires_at === 0 ? 'never' : fmtDate(share.expires_at)}</td>
									<td class="hide-sm" style="text-align:right;">{share.download_count}</td>
									<td class="hide-lg" style="color:var(--text-dim);">{share.created_ip || '—'}</td>
									<td style="text-align:center;">
										<button
											class="btn danger"
											style="padding:4px 10px; font-size:11px;"
											onclick={() => handleDelete(share.token)}
											disabled={deleteToken === share.token}
										>
											{deleteToken === share.token ? '…' : 'del'}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			{#if sharesData.totalPages > 1}
				<div class="pager">
					{#if sharesData.page > 1}
						<button class="btn" onclick={() => (sharePage = sharesData!.page - 1)}>‹ prev</button>
					{/if}
					{#each pages(sharesData.page, sharesData.totalPages) as p, i (i)}
						{#if p === null}
							<span style="color:var(--text-faint); padding:7px 8px;">…</span>
						{:else if p === sharesData.page}
							<span class="current">{p}</span>
						{:else}
							<button class="btn" onclick={() => (sharePage = p as number)}>{p}</button>
						{/if}
					{/each}
					{#if sharesData.page < sharesData.totalPages}
						<button class="btn" onclick={() => (sharePage = sharesData!.page + 1)}>next ›</button>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}

	<!-- ── Audit log tab ───────────────────────────────────────────────── -->
	{#if tab === 'audit'}
		{#if auditData}
			<div class="admin-grid">
				<div class="admin-stat"><div class="label">total events</div><div class="value">{auditData.stats.total}</div></div>
				<div class="admin-stat"><div class="label">unique ips</div><div class="value">{auditData.stats.uniqueIps}</div></div>
				<div class="admin-stat accent"><div class="label">last event</div><div class="value">{auditData.stats.lastTs ? fmtDuration(auditData.stats.lastTs) : '—'}</div></div>
				<div class="admin-stat"><div class="label">showing</div><div class="value">{auditData.entries.length}</div></div>
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
			<div class="panel">
				<div class="panel-body" style="padding:24px;">
					{#each Array(6) as _}
						<div style="height:36px; background:var(--surface-2); border-radius:4px; margin-bottom:8px;" class="skeleton"></div>
					{/each}
				</div>
			</div>
		{:else if auditData && auditData.entries.length === 0}
			<div class="panel">
				<div class="panel-body" style="text-align:center; color:var(--text-faint); font-family:var(--mono); font-size:13px;">
					no audit log entries found.
				</div>
			</div>
		{:else if auditData}
			<div class="panel">
				<div class="panel-head">
					<span class="tag">›</span> events
					<span class="meta">page {auditData.page} of {auditData.totalPages} · {auditData.totalEntries} total</span>
				</div>
				<div class="panel-body panel-body-flush" style="overflow-x:auto;">
					<table>
						<thead>
							<tr>
								<th style="width:60px;">id</th>
								<th style="width:90px;">when</th>
								<th>ip</th>
								<th>action</th>
								<th>share</th>
								<th style="text-align:right;">status</th>
								<th class="hide-lg">details</th>
							</tr>
						</thead>
						<tbody>
							{#each auditData.entries as e (e.id)}
								<tr>
									<td style="color:var(--text-faint);">{e.id}</td>
									<td style="color:var(--text-dim);" title={fmtDate(e.ts)}>{fmtDuration(e.ts)}</td>
									<td style="color:var(--text-dim);">{e.ip || '—'}</td>
									<td>
										<span class={actionTagClass[e.action] ?? 'tag-act'}>{e.action}</span>
									</td>
									<td>
										{#if e.share_token}
											<a href={`/d/${e.share_token}`} target="_blank" rel="noreferrer">{e.share_token}</a>
										{:else}
											<span style="color:var(--text-faint);">—</span>
										{/if}
									</td>
									<td style="text-align:right;">
										{#if e.status === null}
											<span style="color:var(--text-faint);">—</span>
										{:else}
											<span class={e.status < 300 ? 'status-2xx' : e.status < 400 ? 'status-3xx' : 'status-4xx'}>
												{e.status}
											</span>
										{/if}
									</td>
									<td class="hide-lg" style="color:var(--text-dim); font-size:11px; max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
										{e.detail_json || '—'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			{#if auditData.totalPages > 1}
				<div class="pager">
					{#if auditData.page > 1}
						<button class="btn" onclick={() => (auditPage = auditData!.page - 1)}>‹ prev</button>
					{/if}
					{#each pages(auditData.page, auditData.totalPages) as p, i (i)}
						{#if p === null}
							<span style="color:var(--text-faint); padding:7px 8px;">…</span>
						{:else if p === auditData.page}
							<span class="current">{p}</span>
						{:else}
							<button class="btn" onclick={() => (auditPage = p as number)}>{p}</button>
						{/if}
					{/each}
					{#if auditData.page < auditData.totalPages}
						<button class="btn" onclick={() => (auditPage = auditData!.page + 1)}>next ›</button>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}

	<!-- ── Upload tab ──────────────────────────────────────────────────── -->
	{#if tab === 'upload'}
		<div class="panel" style="max-width:720px; margin:0 auto;">
			<div class="panel-head">
				<span class="tag">›</span> admin_upload
				<span class="meta">bypass all quotas · max 100 GB · "No expiry" available</span>
			</div>
			<div class="panel-body">
				<p class="dropzone-meta" style="margin:0 0 14px;">
					admin uploads use the same Uploader with admin preset (100 GB cap, "No expiry" TTL).
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
		</div>
	{/if}

</main>
