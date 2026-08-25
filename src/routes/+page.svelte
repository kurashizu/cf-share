<svelte:head>
	<title>KRSZ Share</title>
	<meta name="description" content="KRSZ Share — temporary file & clipboard sharing" />
</svelte:head>

<script lang="ts">
	import Uploader from '$lib/Uploader.svelte';
	import RetrievePanel from '$lib/RetrievePanel.svelte';
</script>

<main class="wrap">
	<div class="hero">
		<div class="hero-logo"><img src="/favicon.svg" alt="KRSZ Share" /></div>
		<div>
			<h1>KRSZ Share</h1>
			<p class="slogan">
				<span class="letter">K</span>eeping, <span class="letter">R</span>etrieving &amp; <span class="letter">S</span>haring <span class="letter">Z</span>one
			</p>
			<p>Share a file or your clipboard — get a 4-character code and a short-lived link.</p>
			<div class="hero-links">
				<a href="/docs" class="hero-link">› API documentation</a>
				<a href="/admin" class="hero-link">› Admin</a>
			</div>
		</div>
	</div>

	<div class="home-grid">
		<section class="home-send">
			<Uploader omitCredentials globalPaste />
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
					</dl>
				</div>
			</div>
		</aside>
	</div>
</main>
