<svelte:head>
	<title>KRSZ Share</title>
	<meta name="description" content="KRSZ Share — temporary file & clipboard sharing" />
</svelte:head>

<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Uploader from '$lib/Uploader.svelte';
	import RetrievePanel from '$lib/RetrievePanel.svelte';
	import MyShares from '$lib/MyShares.svelte';
	import CookieConsent from '$lib/CookieConsent.svelte';
	import SettingsPanel from '$lib/SettingsPanel.svelte';
	import TunnelRoom from '$lib/TunnelRoom.svelte';

	let myShares: MyShares | undefined = undefined;
	let uploader: Uploader | undefined = undefined;
	let logoSpinning = $state(false);

	const tunnelCode = $derived($page.url.searchParams.get('tunnel'));

	// Room details are runtime state, not URL state — the URL only carries the
	// code (so a link stays shareable); name/password never touch the URL.
	let activeRoom = $state<{ code: string; name: string; password?: string } | null>(null);

	function enterTunnel(code: string, name: string, password: string) {
		goto(`/?tunnel=${code}`, { keepFocus: true, noScroll: true });
		activeRoom = { code, name, password: password || undefined };
	}

	function joinTunnel(code: string, name: string, password: string) {
		activeRoom = { code, name, password: password || undefined };
	}

	function leaveTunnel() {
		activeRoom = null;
		goto('/', { keepFocus: true, noScroll: true });
	}

	function spinLogo() {
		if (logoSpinning) return;
		logoSpinning = true;
		setTimeout(() => (logoSpinning = false), 600);
	}
</script>

<CookieConsent />

<main class="wrap">
	<div class="hero">
		<button
			class="hero-logo {logoSpinning ? 'spin' : ''}"
			onclick={spinLogo}
			aria-label="KRSZ Share logo"
		>
			<img src="/favicon.svg" alt="KRSZ Share" />
		</button>
		<div>
			<h1>KRSZ Share</h1>
			<p class="slogan">
				<span class="letter">K</span>eeping, <span class="letter">R</span>etrieving &amp; <span class="letter">S</span>haring <span class="letter">Z</span>one
			</p>
			<p>Share a file or your clipboard — get a 4-character code and a short-lived link.</p>
			<div class="hero-links">
				<a href="/docs" class="hero-link">› API documentation</a>
				<SettingsPanel onCleared={() => myShares?.refresh()} />
				<a href="/admin" class="hero-link">› Admin</a>
			</div>
		</div>
	</div>

	{#if activeRoom}
		<TunnelRoom
			rawCode={activeRoom.code}
			displayName={activeRoom.name}
			password={activeRoom.password}
			onLeave={leaveTunnel}
		/>
	{:else}
		<MyShares bind:this={myShares} />

		<div class="home-grid">
			<section class="home-send">
				<Uploader
					bind:this={uploader}
					globalPaste
					onUploaded={() => myShares?.refresh()}
					onTunnelCreated={enterTunnel}
					joinCode={tunnelCode}
					onTunnelJoin={joinTunnel}
				/>
			</section>

			<aside class="home-side">
				<RetrievePanel />

				<div class="panel home-tips hide-md">
					<div class="panel-head">
						<span class="tag">›</span> quick_facts
					</div>
					<div class="panel-body">
						<dl class="meta-list" style="border:none; padding:0; grid-template-columns:1fr;">
							<dt>paste anywhere</dt>
							<dd>Ctrl+V on this page shares your clipboard — text or screenshots</dd>
							<dt>share code</dt>
							<dd>every share gets a short code; type it here or scan the QR</dd>
							<dt>lifetime</dt>
							<dd>5 minutes to 7 days, then it's gone from storage</dd>
							<dt>privacy</dt>
							<dd>optional password; sensitive text is best shared with one</dd>
							<dt>live tunnel</dt>
							<dd>need back-and-forth instead of a one-way link? <button type="button" class="inline-link" onclick={() => uploader?.switchToTunnel()}>open a clipboard tunnel</button> — up to 4 people, real time</dd>
						</dl>
					</div>
				</div>
			</aside>
		</div>
	{/if}
</main>
