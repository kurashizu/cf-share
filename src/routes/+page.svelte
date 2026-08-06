<svelte:head>
	<title>KRSZ Share</title>
	<meta name="description" content="KRSZ Share — temporary file sharing" />
</svelte:head>

<script lang="ts">
	import Uploader from '$lib/Uploader.svelte';
</script>

<main class="min-h-screen flex flex-col items-center bg-neutral-50 dark:bg-neutral-950 p-6">
	<div class="w-full max-w-xl text-center mt-12 mb-8">
		<img src="/favicon.svg" alt="KRSZ Share" class="mx-auto mb-3 h-16 w-16" />
		<h1 class="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
			KRSZ Share
		</h1>
		<p class="mt-2 text-neutral-600 dark:text-neutral-400">
			Upload a file, get a short-lived shareable download link.
		</p>
		<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-500">
			<a href="/docs" class="text-blue-600 dark:text-blue-400 hover:underline">
				API Documentation →
			</a>
			<span class="mx-2">&middot;</span>
			<a
				href="/admin"
				class="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400 underline"
			>
				Admin
			</a>
		</p>
	</div>
	<Uploader omitCredentials />
</main>
