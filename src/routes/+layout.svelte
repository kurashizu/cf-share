<script lang="ts">
	import '../app.css';
	import Nav from '$lib/Nav.svelte';

	let { children } = $props();
</script>

<Nav />
{@render children()}

<footer class="foot">
	<span>KRSZ Share · share.krsz.in</span>
	<span>short-lived file sharing</span>
</footer>
