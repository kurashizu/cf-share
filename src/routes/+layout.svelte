<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
		}
	});
</script>

<!-- Third ambient light orb (cyan-violet, lower-middle). The other two are
     painted by body::before and body::after in app.css. -->
<div class="ambient-orb" aria-hidden="true"></div>

{@render children()}

<footer class="foot">
	KRSZ Share · share.krsz.in
</footer>
