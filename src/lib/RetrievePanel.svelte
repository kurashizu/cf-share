<script lang="ts">
	import { goto } from '$app/navigation';

	// Tokens are 4 chars by default, extended to 5-6 on collision (rare).
	// Start with 4 cells; when a filled 4-char code isn't found we grow one
	// cell at a time so longer codes can be typed without a mode switch.
	const MIN_LEN = 4;
	const MAX_LEN = 6;

	let cellCount = $state(MIN_LEN);
	let cells = $state<string[]>(Array(MIN_LEN).fill(''));
	let refs: (HTMLInputElement | null)[] = [];
	let checking = $state(false);
	let errorMsg = $state('');
	let shaking = $state(false);

	const code = $derived(cells.join(''));

	function sanitize(raw: string): string {
		return raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
	}

	/** Accept a full share URL or a bare code and return the token part. */
	function extractToken(raw: string): string {
		const m = raw.match(/\/(?:d|p)\/([0-9A-Za-z]{4,6})/);
		return sanitize(m ? m[1] : raw).slice(0, MAX_LEN);
	}

	function setCellCount(n: number) {
		cellCount = n;
		cells = Array.from({ length: n }, (_, i) => cells[i] ?? '');
	}

	function focusCell(i: number) {
		queueMicrotask(() => refs[Math.max(0, Math.min(i, cellCount - 1))]?.select());
	}

	/** Write a run of characters starting at cell `start`, then advance. */
	function fillFrom(start: number, chars: string) {
		if (chars.length === 0) return;
		// A paste longer than the current cells grows the input (up to 6).
		const needed = Math.min(MAX_LEN, Math.max(cellCount, start + chars.length));
		if (needed > cellCount) setCellCount(needed);
		const next = [...cells];
		let i = start;
		for (const ch of chars) {
			if (i >= cellCount) break;
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
			// Shrink back once the extended tail is empty again.
			if (cellCount > MIN_LEN && next.slice(MIN_LEN).every((c) => c === '')) {
				setCellCount(MIN_LEN);
			}
			errorMsg = '';
		} else if (e.key === 'ArrowLeft' && i > 0) {
			e.preventDefault();
			focusCell(i - 1);
		} else if (e.key === 'ArrowRight' && i < cellCount - 1) {
			e.preventDefault();
			focusCell(i + 1);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			clearAll();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (code.length >= MIN_LEN) void submit();
		}
	}

	function onPaste(e: ClipboardEvent) {
		e.preventDefault();
		const token = extractToken(e.clipboardData?.getData('text/plain') ?? '');
		if (!token) return;
		clearAll();
		fillFrom(0, token);
	}

	function clearAll() {
		setCellCount(MIN_LEN);
		cells = Array(MIN_LEN).fill('');
		errorMsg = '';
		focusCell(0);
	}

	async function submit() {
		if (checking) return;
		const candidate = code;
		if (!/^[0-9A-Z]{4,6}$/.test(candidate)) return;
		checking = true;
		errorMsg = '';
		try {
			const r = await fetch(`/api/download/${candidate}?info=1`, { cache: 'no-store' });
			if (r.ok) {
				await goto(`/d/${candidate}`);
				return;
			}
			if (r.status === 429) {
				errorMsg = 'too many attempts — wait a minute and retry';
			} else if (cellCount < MAX_LEN) {
				// Not found at this length: maybe it's a longer code.
				setCellCount(cellCount + 1);
				errorMsg = `no ${candidate.length}-char share — keep typing if the code is longer`;
				focusCell(cellCount - 1);
			} else {
				errorMsg = 'code not found or expired';
				shaking = true;
				setTimeout(() => (shaking = false), 450);
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
			{#each { length: cellCount } as _, i (i)}
				<input
					bind:this={refs[i]}
					class="code-cell {cells[i] ? 'filled' : ''}"
					type="text"
					inputmode="text"
					autocomplete="off"
					autocapitalize="characters"
					spellcheck="false"
					maxlength={MAX_LEN}
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
