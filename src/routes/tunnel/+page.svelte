<svelte:head>
	<title>Tunnel · KRSZ Share</title>
	<meta name="description" content="Peer-to-peer clipboard tunnel — share text, images and files live between two browsers." />
</svelte:head>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { normalizeToken } from '@/lib/share/token';

	let creating = $state(false);
	let joinCode = $state('');
	let errorMsg = $state('');

	async function createTunnel() {
		if (creating) return;
		creating = true;
		errorMsg = '';
		try {
			const r = await fetch('/api/tunnel', { method: 'POST' });
			if (!r.ok) throw new Error(`${r.status}`);
			const data = (await r.json()) as { code: string };
			await goto(`/tunnel/${data.code}`);
		} catch {
			errorMsg = 'Could not create a tunnel right now — try again.';
		} finally {
			creating = false;
		}
	}

	function joinTunnel() {
		const code = normalizeToken(joinCode);
		if (!code) {
			errorMsg = 'Enter the 4-character code your peer shared with you.';
			return;
		}
		goto(`/tunnel/${code}`);
	}
</script>

<main class="wrap">
	<div class="hero">
		<div>
			<h1>Clipboard Tunnel</h1>
			<p>
				Open a tunnel, share the code with someone, and paste back and forth — live, no
				account, nothing stored beyond the last few messages.
			</p>
		</div>
	</div>

	<div class="panel">
		<div class="panel-head"><span class="tag">›</span> tunnel</div>
		<div class="panel-body">
			<div class="btn-row">
				<button class="btn primary" disabled={creating} onclick={createTunnel}>
					{creating ? 'Creating…' : 'Create a tunnel'}
				</button>
			</div>

			<div class="field" style="margin-top:18px;">
				<label for="join-code">or join with a code</label>
				<div style="display:flex; gap:10px;">
					<input
						id="join-code"
						class="input"
						maxlength="8"
						placeholder="e.g. A3K7"
						bind:value={joinCode}
						onkeydown={(e) => e.key === 'Enter' && joinTunnel()}
					/>
					<button class="btn outline" onclick={joinTunnel}>Join ›</button>
				</div>
			</div>

			{#if errorMsg}
				<p class="password-form" style="margin-top:14px; color: var(--error);">{errorMsg}</p>
			{/if}

			<dl class="meta-list" style="border:none; padding:0; margin-top:22px; grid-template-columns:1fr;">
				<dt>live</dt>
				<dd>messages relay instantly over a WebSocket — no polling, no delay.</dd>
				<dt>size limit</dt>
				<dd>text and small files send inline; anything over 2 MB becomes a regular share link automatically.</dd>
				<dt>lifetime</dt>
				<dd>an unjoined tunnel expires after 30 minutes; a joined one lasts until both sides leave.</dd>
			</dl>
		</div>
	</div>
</main>
