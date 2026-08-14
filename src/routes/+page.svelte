<svelte:head>
	<title>KRSZ Share</title>
	<meta name="description" content="KRSZ Share — temporary file sharing" />
</svelte:head>

<script lang="ts">
	import Uploader from '$lib/Uploader.svelte';
</script>

<main class="wrap">
	<div class="hero">
		<div class="hero-logo"><img src="/favicon.svg" alt="KRSZ Share" /></div>
		<div>
			<h1>KRSZ Share</h1>
			<p>Upload a file, get a short-lived shareable download link.</p>
			<div class="hero-links">
				<a href="/docs" class="hero-link">› API documentation</a>
				<a href="/admin" class="hero-link">› Admin</a>
			</div>
		</div>
	</div>

	<Uploader omitCredentials />
</main>
