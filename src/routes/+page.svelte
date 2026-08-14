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
			<p style="margin-top:6px; font-size:12px;">
				<a href="/docs" style="color:var(--accent); text-decoration:none;">API documentation →</a>
				<span style="color:var(--text-faint); margin:0 6px;">·</span>
				<a href="/admin" style="color:var(--text-dim); text-decoration:none;">Admin</a>
			</p>
		</div>
	</div>

	<Uploader omitCredentials />
</main>
