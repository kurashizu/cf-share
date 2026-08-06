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

<div class="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleSubmit();
		}}
		class="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 shadow-sm"
	>
		<h1 class="text-lg font-semibold mb-1 text-neutral-900 dark:text-neutral-100">
			Admin login
		</h1>
		<p class="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
			Enter the admin password.
		</p>

		<label for="password" class="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
			Password
		</label>
		<input
			bind:value={password}
			id="password"
			name="password"
			type="password"
			autocomplete="current-password"
			autofocus
			required
			disabled={submitting}
			class="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
		/>

		{#if error}
			<p role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
		{/if}

		<button
			type="submit"
			disabled={submitting || !password}
			class="mt-4 w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md font-medium text-sm transition-colors"
		>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
</div>
