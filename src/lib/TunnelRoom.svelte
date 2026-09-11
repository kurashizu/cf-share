<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { normalizeTunnelCode } from '@/lib/tunnel/code';
	import { TunnelSocket, TUNNEL_INLINE_MAX_BYTES, type IncomingMessage, type HistoryItem, type RosterMember } from '$lib/client/tunnel-socket';
	import { avatarColor, avatarLetter } from '$lib/client/avatar';

	let {
		rawCode,
		displayName,
		password,
		onLeave
	}: {
		rawCode: string;
		displayName: string;
		password?: string;
		/** Called when the user leaves the room — parent restores the normal layout. */
		onLeave: () => void;
	} = $props();

	const code = $derived(normalizeTunnelCode(rawCode) ?? rawCode.toUpperCase());
	const joinUrl = $derived(typeof window !== 'undefined' ? `${window.location.origin}/?tunnel=${code}` : '');

	let connecting = $state(true);
	let joinError = $state('');

	let socket: TunnelSocket | null = null;
	let myId = $state('');
	let items = $state<HistoryItem[]>([]);
	let roster = $state<RosterMember[]>([]);
	let rosterMax = $state(4);
	let disconnected = $state(false);
	let composeText = $state('');
	let fileInputRef = $state<HTMLInputElement | null>(null);
	let listRef = $state<HTMLDivElement | null>(null);
	let sendError = $state('');
	let copiedLink = $state(false);
	let showInfo = $state(false);
	let composeRef = $state<HTMLTextAreaElement | null>(null);
	let copiedSeq = $state<number | null>(null);
	let windowDragActive = $state(false);
	let lightboxItem = $state<HistoryItem | null>(null);

	async function copyText(text: string, seq: number) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// ignore
		}
		copiedSeq = seq;
		setTimeout(() => {
			if (copiedSeq === seq) copiedSeq = null;
		}, 1200);
	}

	async function copyImage(item: HistoryItem, seq: number) {
		try {
			const res = await fetch(fileUrl(item));
			const blob = await res.blob();
			// The clipboard image API only accepts png — re-encode through a
			// canvas if the source came in as something else (e.g. jpeg/webp).
			const pngBlob = blob.type === 'image/png' ? blob : await toPngBlob(blob);
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
		} catch {
			// ignore — clipboard image writes aren't supported everywhere
		}
		copiedSeq = seq;
		setTimeout(() => {
			if (copiedSeq === seq) copiedSeq = null;
		}, 1200);
	}

	async function toPngBlob(blob: Blob): Promise<Blob> {
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext('2d');
		ctx?.drawImage(bitmap, 0, 0);
		return new Promise((resolve, reject) => {
			canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('toBlob failed'))), 'image/png');
		});
	}

	function autoGrow() {
		if (!composeRef) return;
		composeRef.style.height = 'auto';
		composeRef.style.height = `${composeRef.scrollHeight}px`;
	}

	const hasContent = $derived(items.some((i) => i.kind !== 'presence'));

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

	async function connect() {
		connecting = true;
		joinError = '';
		disconnected = false;
		const name = displayName.trim() || 'anon';
		socket = new TunnelSocket(code, name, password || undefined, onIncoming, (reason: { code: number; expected: boolean }) => {
			disconnected = !reason.expected;
			if (!reason.expected) joinError = 'Disconnected — the tunnel may have closed.';
		});
		const ok = await socket.connect();
		connecting = false;
		if (!ok) {
			joinError = 'Could not join — wrong password, or the tunnel is full/expired.';
		}
	}

	function sendText() {
		if (!composeText.trim() || !socket) return;
		socket.sendText(composeText.slice(0, TUNNEL_INLINE_MAX_BYTES));
		composeText = '';
		queueMicrotask(autoGrow);
	}

	async function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		await sendFile(file);
	}

	async function sendFile(file: File) {
		if (!socket) return;
		if (file.size > TUNNEL_INLINE_MAX_BYTES) {
			await sendAsRegularShare(file);
			return;
		}
		const result = await socket.sendFile(file);
		if (!result.ok) await sendAsRegularShare(file);
	}

	function onPaste(e: ClipboardEvent) {
		const files = Array.from(e.clipboardData?.files ?? []);
		if (files.length === 0) return;
		e.preventDefault();
		void sendFile(files[0]);
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

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(joinUrl);
		} catch {
			// ignore
		}
		copiedLink = true;
		setTimeout(() => (copiedLink = false), 1500);
	}

	function leave() {
		socket?.close();
		socket = null;
		onLeave();
	}

	onMount(connect);

	// Global drag-and-drop + paste, matching the home page's Uploader — no
	// need to focus the compose box first.
	onMount(() => {
		let dragCounter = 0;
		const onDragEnter = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes('Files')) {
				dragCounter++;
				windowDragActive = true;
			}
		};
		const onDragLeave = () => {
			dragCounter = Math.max(0, dragCounter - 1);
			if (dragCounter === 0) windowDragActive = false;
		};
		const onDragOver = (e: DragEvent) => {
			if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
		};
		const onDropGlobal = (e: DragEvent) => {
			dragCounter = 0;
			windowDragActive = false;
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length > 0) {
				e.preventDefault();
				void sendFile(files[0]);
			}
		};
		window.addEventListener('dragenter', onDragEnter);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDropGlobal);
		window.addEventListener('paste', onPaste);
		return () => {
			window.removeEventListener('dragenter', onDragEnter);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDropGlobal);
			window.removeEventListener('paste', onPaste);
		};
	});

	onDestroy(() => socket?.close());

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && lightboxItem) lightboxItem = null;
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<svelte:head>
	<title>KRSZ Share — tunnel {code}</title>
</svelte:head>

<div class="tunnel-room">
	<div class="tunnel-main panel">
		<div class="panel-head">
			<span class="tag">›</span> tunnel {code}
			<span class="meta">
				{#if connecting}connecting…{:else if disconnected}disconnected{:else}{roster.length}/{rosterMax} online{/if}
			</span>
			<button class="tunnel-info-toggle" onclick={() => (showInfo = !showInfo)} title="tunnel info">Info</button>
			<button class="tunnel-leave" onclick={leave}>Leave</button>
		</div>

		{#if showInfo}
			<div class="tunnel-info-banner">
				<span class="tunnel-info-code">{code}</span>
				<span class="tunnel-info-url">{joinUrl}</span>
				<button class="btn sm outline" onclick={copyLink}>{copiedLink ? 'Copied ✓' : 'Copy link'}</button>
			</div>
		{/if}

		{#if joinError}
			<div class="tunnel-join-error">
				<p>{joinError}</p>
				<button class="btn sm primary" onclick={connect}>Retry</button>
			</div>
		{:else}
			<div class="tunnel-messages" bind:this={listRef}>
				{#if connecting}
					<div class="tunnel-connecting">
						<span class="tunnel-spinner"></span>
						connecting to tunnel {code}…
					</div>
				{:else if !hasContent}
					<div class="tunnel-empty-hint">
						it's quiet in here — type a message, paste an image, or drop a file to get started
					</div>
				{/if}
				{#snippet copyIcon(done: boolean)}
					{#if done}
						<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 8.5l3 3 7-7" />
						</svg>
					{:else}
						<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
							<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
							<path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2H10.5" />
						</svg>
					{/if}
				{/snippet}
				{#snippet downloadIcon(done: boolean)}
					{#if done}
						<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 8.5l3 3 7-7" />
						</svg>
					{:else}
						<svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
							<path d="M8 2v8m0 0l-3-3m3 3l3-3" />
							<path d="M3 12.5v0.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5v-0.5" />
						</svg>
					{/if}
				{/snippet}
				{#each items as item (item.seq + '-' + item.createdAt)}
					{#if item.kind === 'presence'}
						<div class="tunnel-presence">· · {item.from} {item.presenceEvent === 'joined' ? 'joined' : 'left'} the tunnel · ·</div>
					{:else}
						<div class="tunnel-msg {item.fromId === myId ? 'mine' : ''}">
							<div class="tunnel-msg-avatar" style="background:{avatarColor(item.from)}">{avatarLetter(item.from)}</div>
							<div class="tunnel-msg-body">
								<div class="tunnel-msg-name">{item.from}</div>
								{#if item.kind === 'text'}
									<div class="tunnel-bubble-row">
										<div class="tunnel-bubble">{item.body}</div>
										<button
											class="tunnel-copy-icon"
											title="copy"
											aria-label="copy message"
											onclick={() => copyText(item.body ?? '', item.seq)}
										>
											{@render copyIcon(copiedSeq === item.seq)}
										</button>
									</div>
								{:else if item.kind === 'file' && isImage(item.contentType)}
									<div class="tunnel-bubble-row">
										<button class="tunnel-bubble tunnel-bubble-file" onclick={() => (lightboxItem = item)} title="click to preview">
											<img src={fileUrl(item)} alt={item.filename} class="tunnel-img" />
											<div class="tunnel-file-meta">{item.filename} · {formatBytes(item.sizeBytes ?? 0)}</div>
										</button>
										<div class="tunnel-icon-stack">
											<button
												class="tunnel-copy-icon"
												title="copy image"
												aria-label="copy image"
												onclick={() => copyImage(item, item.seq)}
											>
												{@render copyIcon(copiedSeq === item.seq)}
											</button>
											<a
												class="tunnel-copy-icon"
												href={fileUrl(item)}
												download={item.filename}
												title="download image"
												aria-label="download image"
											>
												{@render downloadIcon(false)}
											</a>
										</div>
									</div>
								{:else if item.kind === 'file'}
									<div class="tunnel-bubble-row">
										<div class="tunnel-bubble tunnel-file-card">
											<span class="tunnel-file-name">{item.filename}</span>
											<span class="tunnel-file-size">{formatBytes(item.sizeBytes ?? 0)}</span>
										</div>
										<a
											class="tunnel-copy-icon"
											href={fileUrl(item)}
											download={item.filename}
											title="download file"
											aria-label="download file"
										>
											{@render downloadIcon(false)}
										</a>
									</div>
								{:else if item.kind === 'share-link'}
									<a class="tunnel-bubble tunnel-file-card" href={item.shareUrl} target="_blank" rel="noopener">
										<span class="tunnel-file-name">{item.filename}</span>
										<span class="tunnel-file-size">{formatBytes(item.sizeBytes ?? 0)} · shared link</span>
									</a>
								{/if}
								<div class="tunnel-msg-time">{formatTime(item.createdAt)}</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
			{#if disconnected}
				<div class="tunnel-disconnected">Disconnected. <button class="btn sm outline" onclick={connect}>Reconnect</button></div>
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
				<button class="tunnel-attach" onclick={() => fileInputRef?.click()} title="send a file" aria-label="send a file">+</button>
				<textarea
					class="tunnel-compose-input"
					placeholder="type a message…"
					rows="1"
					bind:this={composeRef}
					bind:value={composeText}
					disabled={disconnected || connecting}
					oninput={autoGrow}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendText();
						}
					}}
				></textarea>
				<button class="btn primary" disabled={disconnected || connecting || !composeText.trim()} onclick={sendText}>Send</button>
			</div>
		{/if}
	</div>
	<aside class="tunnel-roster panel">
		<div class="panel-head">
			<span class="tag">›</span> online
		</div>
		<div class="panel-body panel-body-flush">
			<ul class="tunnel-roster-list">
				{#each roster as member (member.id)}
					<li class="tunnel-roster-item">
						<span class="tunnel-msg-avatar sm" style="background:{avatarColor(member.displayName)}">{avatarLetter(member.displayName)}</span>
						{member.displayName}
					</li>
				{/each}
				{#if roster.length === 0}
					<li class="tunnel-roster-empty">no one yet</li>
				{/if}
			</ul>
		</div>
	</aside>
</div>

{#if windowDragActive}
	<div class="global-drag-overlay" aria-hidden="true">
		<div class="global-drag-tip">
			↓ Drop file anywhere to send it into the tunnel
		</div>
	</div>
{/if}

{#if lightboxItem}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.currentTarget === e.target) lightboxItem = null;
		}}
	>
		<div class="image-lightbox" role="dialog" aria-modal="true" aria-label={lightboxItem.filename}>
			<img src={fileUrl(lightboxItem)} alt={lightboxItem.filename} />
			<div class="image-lightbox-bar">
				<span>{lightboxItem.filename} · {formatBytes(lightboxItem.sizeBytes ?? 0)}</span>
				<a class="btn sm outline" href={fileUrl(lightboxItem)} download={lightboxItem.filename}>Download</a>
				<button class="btn sm outline" onclick={() => (lightboxItem = null)}>Close</button>
			</div>
		</div>
	</div>
{/if}
