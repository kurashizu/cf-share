<script lang="ts">
	import { page } from '$app/stores';

	let { status = 'Idle' }: { status?: string } = $props();

	const links = [
		{ href: '/', label: 'upload', match: (p: string) => p === '/' },
		{ href: '/admin', label: 'admin', match: (p: string) => p.startsWith('/admin') && !p.startsWith('/admin/login') },
		{ href: '/docs', label: 'docs', match: (p: string) => p.startsWith('/docs') }
	];
</script>

<nav class="nav">
	<a class="nav-brand" href="/">
		<span class="brand-logo"><img src="/favicon.svg" alt="KRSZ Share" /></span>
		KRSZ Share
	</a>

	<div class="nav-links">
		{#each links as link (link.href)}
			<a href={link.href} class:active={link.match($page.url.pathname)}>{link.label}</a>
		{/each}
	</div>

	<div class="nav-status">
		Status: <span class="pill">{status}</span>
	</div>
</nav>
