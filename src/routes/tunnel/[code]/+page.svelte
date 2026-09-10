<svelte:head>
	<title>KRSZ Share — tunnel {code}</title>
</svelte:head>

<script lang="ts">
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import { normalizeTunnelCode } from '@/lib/tunnel/code';
	import { TunnelSocket, TUNNEL_INLINE_MAX_BYTES, type IncomingMessage, type HistoryItem } from '$lib/client/tunnel-socket';
	import { avatarColor, avatarLetter } from '$lib/client/avatar';

	const rawCode = $page.params.code ?? '';
	const code = normalizeTunnelCode(rawCode) ?? rawCode.toUpperCase();

	let displayName = $state($page.url.searchParams.get('name') ?? '');
	let password = $state('');
	let joining = $state(false);
	let joined = $state(false);
	let joinError = $state('');
	let needsPassword = $state(false);

	let socket: TunnelSocket | null = null;
	let myId = $state('');
	let items = $state<HistoryItem[]>([]);
	let roster = $state<string[]>([]);
	let rosterMax = $state(4);
	let disconnected = $state(false);
	let composeText = $state('');
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let listRef = $state<HTMLDivElement | null>(null);
	let sendError = $state('');

	function scrollToBottom() {
		queueMicrotask(() => {
			if (listRef) listRef.scrollTop = listRef.scrollHeight;
		});
	}

	function onIncoming(msg: IncomingMessage) {
		if (msg.type === 'welcome') {
			myId = msg.id;
			return;
		}
		if (msg.type === 'history') {
			items = msg.items;
			scrollToBottom();
			return;
		}
		if (msg.type === 'text' || msg.type === 'file' || msg.type === 'share-link') {
			items = [...items, toHistoryItem(msg)];
			scrollToBottom();
			return;
		}
		if (msg.type === 'presence') {
			items = [
				...items,
				{ seq: -1, kind: 'presence', from: msg.displayName, fromId: msg.id, createdAt: Date.now(), presenceEvent: msg.event }
			];
			scrollToBottom();
			return;
		}
		if (msg.type === 'roster') {
			roster = msg.members;
			rosterMax = msg.max;
			return;
		}
		if (msg.type === 'error') {
			sendError = msg.message;
			setTimeout(() => (sendError = ''), 4000);
		}
	}

	function toHistoryItem(
		msg: Extract<IncomingMessage, { type: 'text' | 'file' | 'share-link' }>
	): HistoryItem {
		if (msg.type === 'text') {
			return { seq: msg.seq, kind: 'text', from: msg.from, fromId: msg.id, createdAt: msg.createdAt, body: msg.body };
		}
		if (msg.type === 'file') {
			return {
				seq: msg.seq,
				kind: 'file',
				from: msg.from,
				fromId: msg.id,
				createdAt: msg.createdAt,
				filename: msg.filename,
				sizeBytes: msg.sizeBytes,
				contentType: msg.contentType
			};
		}
		return {
			seq: msg.seq,
			kind: 'share-link',
			from: msg.from,
			fromId: msg.id,
			createdAt: msg.createdAt,
			filename: msg.filename,
			sizeBytes: msg.sizeBytes,
			shareUrl: msg.shareUrl
		};
	}

	async function join() {
		if (joining) return;
		joining = true;
		joinError = '';
		const name = displayName.trim() || 'anon';
		socket = new TunnelSocket(code, name, password || undefined, onIncoming, (reason: { code: number; expected: boolean }) => {
			joined = false;
			disconnected = !reason.expected;
			if (!reason.expected) joinError = 'Disconnected — the tunnel may have closed.';
		});
		const ok = await socket.connect();
		if (ok) {
			joined = true;
		} else {
			joinError = 'Could not join — wrong password, or the tunnel is full/expired.';
			needsPassword = true;
		}
		joining = false;
	}

	function sendText() {
		if (!composeText.trim() || !socket) return;
		socket.sendText(composeText.slice(0, TUNNEL_INLINE_MAX_BYTES));
		composeText = '';
	}

	async function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !socket) return;
		if (file.size > TUNNEL_INLINE_MAX_BYTES) {
			await sendAsRegularShare(file);
			return;
		}
		const result = await socket.sendFile(file);
		if (!result.ok) await sendAsRegularShare(file);
	}

	async function sendAsRegularShare(file: File) {
		sendError = 'File too large for the tunnel — uploading as a regular share…';
		try {
			const initRes = await fetch('/api/upload/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type || 'application/octet-stream', ttl: 86400 })
			});
			if (!initRes.ok) throw new Error('init failed');
			const init = (await initRes.json()) as { mode: string; url?: string; headers?: Record<string, string>; key: string; uploadSig: string; uploadId: string };
			if (init.mode !== 'single' || !init.url) throw new Error('large-file fallback not supported here');

			await fetch(init.url, { method: 'PUT', headers: init.headers, body: file });

			const completeRes = await fetch('/api/upload/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'single',
					uploadId: init.uploadId,
					key: init.key,
					uploadSig: init.uploadSig,
					etag: '',
					filename: file.name,
					size: file.size,
					contentType: file.type || 'application/octet-stream',
					ttl: 86400
				})
			});
			if (!completeRes.ok) throw new Error('complete failed');
			const data = (await completeRes.json()) as { shareToken: string; fullUrl: string };
			socket?.sendShareLink({
				filename: file.name,
				sizeBytes: file.size,
				shareUrl: data.fullUrl,
				shareToken: data.shareToken
			});
			sendError = '';
		} catch {
			sendError = 'Could not send that file.';
			setTimeout(() => (sendError = ''), 4000);
		}
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(2)} MB`;
	}

	function formatTime(ts: number): string {
		const d = new Date(ts);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}

	function isImage(contentType?: string): boolean {
		return !!contentType && contentType.startsWith('image/');
	}

	function fileUrl(item: HistoryItem): string {
		return `/api/tunnel/${code}/file/${item.seq}`;
	}

	onDestroy(() => socket?.close());
</script>

<main class="wrap tunnel-wrap">
	{#if !joined}
		<div class="hero">
			<div>
				<h1>Tunnel {code}</h1>
				<p>Enter a display name{needsPassword ? ' and the tunnel password' : ''} to join.</p>
			</div>
		</div>
		<div class="panel" style="max-width:420px;">
			<div class="panel-head">
				<span class="tag">›</span> join tunnel
			</div>
			<div class="panel-body">
				<div class="controls">
					<div class="field">
						<label for="rn">display name</label>
						<input id="rn" class="input" type="text" maxlength="32" placeholder="anon" bind:value={displayName} disabled={joining} onkeydown={(e) => e.key === 'Enter' && join()} />
					</div>
					<div class="field">
						<label for="rp">password <span class="optional">· if the tunnel has one</span></label>
						<input id="rp" class="input" type="password" placeholder="no password" bind:value={password} disabled={joining} onkeydown={(e) => e.key === 'Enter' && join()} />
					</div>
				</div>
				<button class="btn primary" disabled={joining} onclick={join}>
					{joining ? 'Joining…' : 'Join tunnel'}
				</button>
				{#if joinError}
					<p class="code-hint error" style="margin-top:10px;">{joinError}</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="tunnel-room">
			<div class="tunnel-main panel">
				<div class="panel-head">
					<span class="tag">›</span> tunnel {code}
					<span class="meta">{roster.length}/{rosterMax} online</span>
				</div>
				<div class="tunnel-messages" bind:this={listRef}>
					{#each items as item (item.seq + '-' + item.createdAt)}
						{#if item.kind === 'presence'}
							<div class="tunnel-presence">· · {item.from} {item.presenceEvent === 'joined' ? 'joined' : 'left'} the tunnel · ·</div>
						{:else}
							<div class="tunnel-msg {item.fromId === myId ? 'mine' : ''}">
								<div class="tunnel-msg-avatar" style="background:{avatarColor(item.from)}">{avatarLetter(item.from)}</div>
								<div class="tunnel-msg-body">
									<div class="tunnel-msg-name">{item.from}</div>
									{#if item.kind === 'text'}
										<div class="tunnel-bubble">{item.body}</div>
									{:else if item.kind === 'file' && isImage(item.contentType)}
										<div class="tunnel-bubble tunnel-bubble-file">
											<img src={fileUrl(item)} alt={item.filename} class="tunnel-img" />
											<div class="tunnel-file-meta">{item.filename} · {formatBytes(item.sizeBytes ?? 0)}</div>
										</div>
									{:else if item.kind === 'file'}
										<a class="tunnel-bubble tunnel-file-card" href={fileUrl(item)} download={item.filename}>
											<span class="tunnel-file-icon">⬇</span>
											<span class="tunnel-file-name">{item.filename}</span>
											<span class="tunnel-file-size">{formatBytes(item.sizeBytes ?? 0)}</span>
										</a>
									{:else if item.kind === 'share-link'}
										<a class="tunnel-bubble tunnel-file-card" href={item.shareUrl} target="_blank" rel="noopener">
											<span class="tunnel-file-icon">🔗</span>
											<span class="tunnel-file-name">{item.filename}</span>
											<span class="tunnel-file-size">{formatBytes(item.sizeBytes ?? 0)}</span>
										</a>
									{/if}
									<div class="tunnel-msg-time">{formatTime(item.createdAt)}</div>
								</div>
							</div>
						{/if}
					{/each}
				</div>
				{#if disconnected}
					<div class="tunnel-disconnected">Disconnected. <button class="btn sm outline" onclick={join}>Reconnect</button></div>
				{/if}
				{#if sendError}
					<div class="tunnel-send-error">{sendError}</div>
				{/if}
				<div class="tunnel-compose">
					<input
						class="hidden"
						type="file"
						bind:this={fileInputRef}
						onchange={onFilePicked}
					/>
					<button class="tunnel-attach" onclick={() => fileInputRef?.click()} title="send a file" aria-label="send a file">📎</button>
					<textarea
						class="tunnel-compose-input"
						placeholder="type a message…"
						bind:value={composeText}
						disabled={disconnected}
						onkeydown={(e) => {
							if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
								e.preventDefault();
								sendText();
							}
						}}
					></textarea>
					<button class="btn primary" disabled={disconnected || !composeText.trim()} onclick={sendText}>Send</button>
				</div>
			</div>
			<aside class="tunnel-roster panel">
				<div class="panel-head">
					<span class="tag">›</span> online
				</div>
				<div class="panel-body panel-body-flush">
					<ul class="tunnel-roster-list">
						{#each roster as name (name)}
							<li class="tunnel-roster-item">
								<span class="tunnel-msg-avatar sm" style="background:{avatarColor(name)}">{avatarLetter(name)}</span>
								{name}
							</li>
						{/each}
					</ul>
				</div>
			</aside>
		</div>
	{/if}
</main>
