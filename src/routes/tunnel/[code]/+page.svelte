<svelte:head>
	<title>Tunnel {code} · KRSZ Share</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { normalizeToken } from '@/lib/share/token';
	import { TunnelConnection, TUNNEL_INLINE_MAX_BYTES, type TunnelMessage } from '$lib/client/tunnel';
	import { uploadAsFallbackShare } from '$lib/client/tunnel-fallback';

	const code = $derived(normalizeToken(page.params.code) ?? page.params.code ?? '');

	let conn: TunnelConnection | null = null;
	let status = $state<'connecting' | 'open' | 'closed' | 'full' | 'expired' | 'error'>('connecting');
	let messages = $state<TunnelMessage[]>([]);
	let composeText = $state('');
	let sendingFile = $state(false);
	let fallbackError = $state('');
	let listEl = $state<HTMLDivElement | null>(null);

	function scrollToBottom() {
		queueMicrotask(() => {
			if (listEl) listEl.scrollTop = listEl.scrollHeight;
		});
	}

	function upsertMessage(msg: TunnelMessage) {
		if (messages.some((m) => m.seq === msg.seq)) return;
		messages = [...messages, msg].slice(-10);
		scrollToBottom();
	}

	async function loadHistory() {
		try {
			const r = await fetch(`/api/tunnel/${code}/history`);
			if (!r.ok) return;
			const data = (await r.json()) as { messages: TunnelMessage[] };
			messages = data.messages;
			scrollToBottom();
		} catch {
			// non-fatal — the WS will still deliver new messages
		}
	}

	onMount(() => {
		loadHistory();
		conn = new TunnelConnection();
		conn.onStatus = (s) => (status = s);
		conn.onMessage = upsertMessage;
		conn.connect(code);
	});

	onDestroy(() => {
		conn?.close();
	});

	function sendText() {
		const body = composeText.trim();
		if (!body || status !== 'open') return;
		conn?.sendText(body);
		composeText = '';
	}

	async function sendFile(file: File) {
		if (status !== 'open' || sendingFile) return;
		fallbackError = '';
		sendingFile = true;
		try {
			if (file.size <= TUNNEL_INLINE_MAX_BYTES) {
				const buf = await file.arrayBuffer();
				const b64 = btoa(
					Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join('')
				);
				const dataUrl = `data:${file.type || 'application/octet-stream'};base64,${b64}`;
				conn?.sendFile(dataUrl, file.name);
			} else {
				const result = await uploadAsFallbackShare(file);
				conn?.sendShare(result.shareToken, result.filename, result.sizeBytes);
			}
		} catch {
			fallbackError = 'Could not send that file — try again.';
		} finally {
			sendingFile = false;
		}
	}

	function onPaste(e: ClipboardEvent) {
		const files = Array.from(e.clipboardData?.files ?? []);
		if (files.length > 0) {
			e.preventDefault();
			sendFile(files[0]);
			return;
		}
		const text = e.clipboardData?.getData('text/plain');
		if (text) {
			e.preventDefault();
			composeText = composeText ? composeText + text : text;
		}
	}

	function onFilePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files && input.files.length > 0) sendFile(input.files[0]);
		input.value = '';
	}

	function statusLabel(s: typeof status): string {
		switch (s) {
			case 'connecting':
				return 'connecting…';
			case 'open':
				return 'connected';
			case 'closed':
				return 'disconnected';
			case 'full':
				return 'room already has two peers';
			case 'expired':
				return 'tunnel expired — no one joined in time';
			case 'error':
				return 'connection error';
		}
	}

	function isImageDataUrl(body: string): boolean {
		return /^data:image\//.test(body);
	}
</script>

<main class="wrap">
	<div class="panel">
		<div class="panel-head">
			<span class="tag">›</span> tunnel_{code}
			<span class="meta">{statusLabel(status)}</span>
		</div>
		<div class="panel-body panel-body-flush">
			<div class="tunnel-messages" bind:this={listEl}>
				{#if messages.length === 0}
					<p class="tunnel-empty">No messages yet — paste, type, or drop a file below.</p>
				{/if}
				{#each messages as m (m.seq)}
					<div class="tunnel-msg tunnel-msg-{m.sender}">
						{#if m.kind === 'share'}
							<a href="/d/{m.shareToken}" class="tunnel-msg-share">
								📎 {m.filename} <span class="tunnel-msg-meta">({Math.round(m.sizeBytes / 1024)} KB)</span>
							</a>
						{:else if m.kind === 'file' && m.body}
							{#if isImageDataUrl(m.body)}
								<img src={m.body} alt={m.filename ?? 'file'} class="tunnel-msg-image" />
							{:else}
								<a href={m.body} download={m.filename ?? 'file'} class="tunnel-msg-share">
									📎 {m.filename}
								</a>
							{/if}
						{:else}
							<p class="tunnel-msg-text">{m.body}</p>
						{/if}
					</div>
				{/each}
			</div>

			{#if fallbackError}
				<p class="password-form" style="color: var(--error); margin: 0 22px;">{fallbackError}</p>
			{/if}

			<div class="tunnel-compose">
				<textarea
					class="text-area"
					placeholder="type, paste text or an image, or drop a file…"
					bind:value={composeText}
					disabled={status !== 'open'}
					onpaste={onPaste}
					onkeydown={(e) => {
						if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
							e.preventDefault();
							sendText();
						}
					}}
				></textarea>
				<div class="tunnel-compose-actions">
					<label class="btn outline">
						{sendingFile ? 'Sending…' : '📎 File'}
						<input type="file" class="hidden" disabled={status !== 'open' || sendingFile} onchange={onFilePick} />
					</label>
					<button class="btn primary" disabled={status !== 'open' || !composeText.trim()} onclick={sendText}>
						Send <span class="kbd-hint">⌃⏎</span>
					</button>
				</div>
			</div>
		</div>
	</div>
</main>
