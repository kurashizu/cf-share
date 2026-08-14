<svelte:head>
	<title>Admin login — KRSZ Share</title>
</svelte:head>

<script lang="ts">
	import { onMount } from 'svelte';

	let password = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	onMount(() => {
		// Already logged in? Skip the form.
		fetch('/api/admin/me', { credentials: 'same-origin' })
			.then((r) => {
				if (r.ok) window.location.replace('/admin');
			})
			.catch(() => {
				/* ignore — stay on the form */
			});
	});

	async function handleSubmit() {
		if (submitting) return;
		submitting = true;
		error = null;

		try {
			const res = await fetch('/api/admin/login', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (!res.ok) {
				const txt = await res.text();
				let msg = 'Login failed';
				try {
					const parsed = JSON.parse(txt) as { error?: string };
					if (parsed.error) msg = parsed.error;
				} catch {
					/* keep generic message */
				}
				error = msg;
				return;
			}
			window.location.replace('/admin');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Network error';
		} finally {
			submitting = false;
		}
	}
</script>

<main class="wrap">
	<div style="max-width:380px; margin:80px auto 0;">
		<div class="panel">
			<div class="panel-head">
				<span class="tag">›</span> admin_login
				<span class="meta">restricted</span>
			</div>
			<div class="panel-body">
				<p class="dropzone-meta" style="margin:0 0 14px;">
					Enter the admin password.
				</p>

				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
				>
					<label
						for="password"
						style="display:block; font-family:var(--mono); font-size:11px; color:var(--text-dim); margin-bottom:6px;"
					>
						password
					</label>
					<input
						bind:value={password}
						id="password"
						name="password"
						class="input"
						type="password"
						autocomplete="current-password"
						autofocus
						required
						disabled={submitting}
					/>

					{#if error}
						<p
							role="alert"
							class="download-error"
							style="margin-top:10px;"
						>
							{error}
						</p>
					{/if}

					<button
						type="submit"
						class="btn primary"
						style="margin-top:14px; width:100%; padding:11px;"
						disabled={submitting || !password}
					>
						{submitting ? 'Signing in…' : 'Sign in'}
					</button>
				</form>
			</div>
		</div>
	</div>
</main>
