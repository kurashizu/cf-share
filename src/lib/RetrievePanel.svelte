<script lang="ts">
	import { goto } from '$app/navigation';
	import { normalizeToken } from '@/lib/share/token';

	// Share codes are a fixed 4 chars of Crockford Base32 (see lib/share/token.ts).
	const LEN = 4;

	let cells = $state<string[]>(Array(LEN).fill(''));
	let refs: (HTMLInputElement | null)[] = [];
	let checking = $state(false);
	let errorMsg = $state('');
	let shaking = $state(false);

	const code = $derived(cells.join(''));

	function sanitize(raw: string): string {
		return raw
			.toUpperCase()
			.replace(/O/g, '0')
			.replace(/[IL]/g, '1')
			.replace(/U/g, 'V')
			.replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/g, '');
	}

	/** Accept a full share URL or a bare code and return the token part. */
	function extractToken(raw: string): string {
		const m = raw.match(/\/(?:d|p)\/([0-9A-Za-z_-]{4,6})/);
		return sanitize(m ? m[1] : raw).slice(0, LEN);
	}

	function focusCell(i: number) {
		queueMicrotask(() => refs[Math.max(0, Math.min(i, LEN - 1))]?.select());
	}

	/** Write a run of characters starting at cell `start`, then advance. */
	function fillFrom(start: number, chars: string) {
		if (chars.length === 0) return;
		const next = [...cells];
		let i = start;
		for (const ch of chars) {
			if (i >= LEN) break;
			next[i++] = ch;
		}
		cells = next;
		errorMsg = '';
		if (next.every((c) => c !== '')) {
			void submit();
		} else {
			focusCell(next.findIndex((c) => c === ''));
		}
	}

	function onInput(i: number, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const chars = sanitize(input.value);
		input.value = cells[i]; // cells state is the source of truth
		if (chars.length === 0) {
			const next = [...cells];
			next[i] = '';
			cells = next;
			return;
		}
		fillFrom(i, chars);
	}

	function onKeydown(i: number, e: KeyboardEvent) {
		if (e.key === 'Backspace') {
			e.preventDefault();
			const next = [...cells];
			if (next[i]) {
				next[i] = '';
				cells = next;
			} else if (i > 0) {
				next[i - 1] = '';
				cells = next;
				focusCell(i - 1);
			}
			errorMsg = '';
		} else if (e.key === 'ArrowLeft' && i > 0) {
			e.preventDefault();
			focusCell(i - 1);
		} else if (e.key === 'ArrowRight' && i < LEN - 1) {
			e.preventDefault();
			focusCell(i + 1);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			clearAll();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (code.length === LEN) void submit();
		}
	}

	function onPaste(e: ClipboardEvent) {
		e.preventDefault();
		const token = extractToken(e.clipboardData?.getData('text/plain') ?? '');
		if (!token) return;
		cells = Array(LEN).fill('');
		fillFrom(0, token);
	}

	function clearAll() {
		cells = Array(LEN).fill('');
		errorMsg = '';
		focusCell(0);
	}

	function notFound(msg: string) {
		errorMsg = msg;
		shaking = true;
		setTimeout(() => (shaking = false), 450);
	}

	async function submit() {
		if (checking) return;
		const candidate = normalizeToken(code);
		if (!candidate || candidate.length !== LEN) return;
		checking = true;
		errorMsg = '';
		try {
			const r = await fetch(`/api/download/${candidate}?info=1`, { cache: 'no-store' });
			if (r.ok) {
				await goto(`/d/${candidate}`);
				return;
			}
			if (r.status === 429) {
				notFound('too many attempts — wait a minute and retry');
			} else {
				notFound('code not found or expired');
			}
		} catch {
			// Network hiccup on the pre-check: navigate anyway, /d handles it.
			await goto(`/d/${candidate}`);
			return;
		} finally {
			checking = false;
		}
	}
</script>

<div class="panel retrieve-panel">
	<div class="panel-head">
		<span class="tag">›</span> receive
		<span class="meta">enter a share code</span>
	</div>
	<div class="panel-body">
		<div
			class="code-cells {shaking ? 'shake' : ''}"
			role="group"
			aria-label="share code"
			onpaste={onPaste}
		>
			{#each { length: LEN } as _, i (i)}
				<input
					bind:this={refs[i]}
					class="code-cell {cells[i] ? 'filled' : ''}"
					type="text"
					inputmode="text"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					maxlength={LEN}
					value={cells[i]}
					disabled={checking}
					aria-label={`code character ${i + 1}`}
					oninput={(e) => onInput(i, e)}
					onkeydown={(e) => onKeydown(i, e)}
					onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
			{/each}
		</div>
		<p class="code-hint {errorMsg ? 'error' : ''}">
			{#if checking}
				looking up…
			{:else if errorMsg}
				{errorMsg}
			{:else}
				type or paste the 4-char code (or a full link) — opens automatically
			{/if}
		</p>
	</div>
</div>
