<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<!-- Third ambient light orb (cyan-violet, lower-middle). The other two are
     painted by body::before and body::after in app.css. -->
<div class="ambient-orb" aria-hidden="true"></div>

{@render children()}

<footer class="foot">
	KRSZ Share · share.krsz.in
</footer>
