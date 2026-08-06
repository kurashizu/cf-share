<svelte:head>
	<title>Download — KRSZ Share</title>
</svelte:head>

<script lang="ts">
	import DownloadPage from '$lib/DownloadPage.svelte';

	let { data } = $props();
</script>

<DownloadPage token={data.token} />
