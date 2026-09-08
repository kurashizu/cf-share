<script lang="ts">
	import { onMount } from 'svelte';
	import { hasConsented, setConsented } from './client/prefs';

	let visible = $state(false);

	onMount(() => {
		if (!hasConsented()) visible = true;
	});

	function accept() {
		setConsented();
		visible = false;
	}
</script>

{#if visible}
	<div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
		<div class="modal-card">
			<div class="panel-head">
				<span class="tag">›</span> welcome
			</div>
			<div class="panel-body">
				<h2 id="consent-title" class="modal-title">Welcome to KRSZ Share</h2>
				<p class="modal-text">
					This site uses one strictly-necessary cookie so it can remember which files
					<em>you</em> shared — that's what lets you come back and delete them yourself later.
					No account, no tracking.
				</p>
				<p class="modal-text">
					No analytics, no ads, no third-party trackers. Uploaded files are stored until
					their TTL expires (5 minutes–7 days), then deleted automatically. See
					<a href="/docs" class="modal-link">API docs</a> for the full technical rundown.
				</p>
				<button class="btn primary modal-accept" onclick={accept}>I understand, continue</button>
			</div>
		</div>
	</div>
{/if}
