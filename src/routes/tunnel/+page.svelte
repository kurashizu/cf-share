<svelte:head>
	<title>KRSZ Share — clipboard tunnel</title>
</svelte:head>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { normalizeTunnelCode } from '@/lib/tunnel/code';

	let displayName = $state('');
	let password = $state('');
	let creating = $state(false);
	let errorMsg = $state('');

	let joinCode = $state('');
	let joinName = $state('');

	async function createTunnel() {
		if (creating) return;
		creating = true;
		errorMsg = '';
		try {
			const r = await fetch('/api/tunnel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: password || undefined })
			});
			if (!r.ok) {
				const body = (await r.json().catch(() => ({}))) as { error?: string };
				errorMsg = body.error ?? 'Could not create tunnel';
				return;
			}
			const data = (await r.json()) as { code: string };
			// Password never rides in the URL — the room page below will ask
			// for it again via the normal join form, same as anyone else.
			const params = new URLSearchParams();
			if (displayName.trim()) params.set('name', displayName.trim());
			await goto(`/tunnel/${data.code}?${params.toString()}`);
		} catch {
			errorMsg = 'Network error — try again';
		} finally {
			creating = false;
		}
	}

	function joinExisting() {
		const code = normalizeTunnelCode(joinCode);
		if (!code) {
			errorMsg = 'Enter a valid tunnel code';
			return;
		}
		const params = new URLSearchParams();
		if (joinName.trim()) params.set('name', joinName.trim());
		goto(`/tunnel/${code}?${params.toString()}`);
	}
</script>

<main class="wrap">
	<div class="hero">
		<div>
			<h1>Clipboard tunnel</h1>
			<p>
				Open a tunnel, share the code, and copy/paste back and forth in real time — up to 4
				people, nothing saved once everyone leaves.
			</p>
		</div>
	</div>

	<div class="home-grid">
		<section class="home-send">
			<div class="panel panel-stretch">
				<div class="panel-head">
					<span class="tag">›</span> create tunnel
				</div>
				<div class="panel-body">
					<div class="controls">
						<div class="field">
							<label for="tunnel-name">your display name <span class="optional">· optional</span></label>
							<input
								id="tunnel-name"
								class="input"
								type="text"
								maxlength="32"
								placeholder="anon"
								bind:value={displayName}
								disabled={creating}
							/>
						</div>
						<div class="field">
							<label for="tunnel-password">password <span class="optional">· optional</span></label>
							<input
								id="tunnel-password"
								class="input"
								type="password"
								placeholder="no password"
								bind:value={password}
								disabled={creating}
							/>
						</div>
					</div>
					<button class="btn primary" disabled={creating} onclick={createTunnel}>
						{creating ? 'Creating…' : 'Create tunnel'}
					</button>
					{#if errorMsg}
						<p class="code-hint error" style="margin-top:10px;">{errorMsg}</p>
					{/if}
				</div>
			</div>
		</section>

		<aside class="home-side">
			<div class="panel">
				<div class="panel-head">
					<span class="tag">›</span> join tunnel
					<span class="meta">have a code already?</span>
				</div>
				<div class="panel-body">
					<div class="controls">
						<div class="field">
							<label for="join-code">tunnel code</label>
							<input
								id="join-code"
								class="input"
								type="text"
								maxlength="4"
								placeholder="Z___"
								autocapitalize="characters"
								bind:value={joinCode}
								onkeydown={(e) => e.key === 'Enter' && joinExisting()}
							/>
						</div>
						<div class="field">
							<label for="join-name">your display name <span class="optional">· optional</span></label>
							<input
								id="join-name"
								class="input"
								type="text"
								maxlength="32"
								placeholder="anon"
								bind:value={joinName}
								onkeydown={(e) => e.key === 'Enter' && joinExisting()}
							/>
						</div>
					</div>
					<button class="btn outline" onclick={joinExisting}>Join ›</button>
				</div>
			</div>
		</aside>
	</div>
</main>
