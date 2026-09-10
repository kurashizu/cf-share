<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let {
		code,
		hasPassword,
		onEnter
	}: {
		code: string;
		hasPassword: boolean;
		onEnter: () => void;
	} = $props();

	let copied = $state(false);
	let copiedCode = $state(false);
	let canvasRef = $state<HTMLCanvasElement | null>(null);

	const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
	const joinUrl = $derived(`${baseUrl}/?tunnel=${code}`);

	onMount(() => {
		if (!canvasRef) return;
		QRCode.toCanvas(canvasRef, joinUrl, {
			width: 328,
			margin: 1,
			color: { dark: '#000000', light: '#ffffff' }
		})
			.then(() => {
				if (canvasRef) {
					canvasRef.style.width = '';
					canvasRef.style.height = '';
				}
			})
			.catch(() => {
				// ignore
			});
	});

	async function onCopy(text: string, setter: (v: boolean) => void, btn: HTMLButtonElement) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
		}
		setter(true);
		if (btn && !btn.dataset.keepLabel) {
			const orig = btn.dataset.orig ?? btn.textContent ?? '';
			btn.dataset.orig = orig;
			btn.textContent = 'Copied ✓';
			btn.classList.add('copied');
			setTimeout(() => {
				btn.textContent = orig;
				btn.classList.remove('copied');
			}, 1400);
		}
		setTimeout(() => setter(false), 1500);
	}
</script>

<div class="panel" style="margin-top:14px;">
	<div class="panel-head">
		<span class="tag">›</span> tunnel_created
		<span class="meta">up to 4 people</span>
	</div>
	<div class="panel-body">
		<div class="result-hero">
			<button
				class="share-code"
				data-keep-label="1"
				title="click to copy the code"
				onclick={(e) => onCopy(code, (v) => (copiedCode = v), e.currentTarget)}
			>
				<span class="share-code-label">tunnel code {copiedCode ? '· copied ✓' : '· click to copy'}</span>
				<span class="share-code-value">{code}</span>
				<span class="share-code-hint">enter this code on the home page to join</span>
			</button>

			<div class="qr">
				<canvas bind:this={canvasRef} width={328} height={328}></canvas>
			</div>
		</div>

		<div class="share-link">
			<span class="small">join url</span>
			{joinUrl}
		</div>

		<div class="btn-row">
			<button class="btn primary" onclick={(e) => onCopy(joinUrl, (v) => (copied = v), e.currentTarget)}>
				{copied ? 'Copied ✓' : 'Copy link'}
			</button>
			<button class="btn outline" onclick={onEnter}>Enter tunnel ›</button>
		</div>

		{#if hasPassword}
			<p class="password-form warn" style="margin-top:0;">
				password-protected — anyone joining needs it, including you
			</p>
		{/if}

		<p class="dropzone-meta" style="margin-top:14px;">
			Share the code or link with up to 3 other people. Nothing is saved once
			everyone leaves the tunnel.
		</p>
	</div>
</div>
