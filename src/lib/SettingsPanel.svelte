<script lang="ts">
	import { clearAllSitePrefs, countResumeEntries } from './client/prefs';

	let { onCleared = undefined }: { onCleared?: () => void } = $props();

	let open = $state(false);
	let clearing = $state(false);
	let cleared = $state(false);
	let resumeCount = $state(0);

	function show() {
		resumeCount = countResumeEntries();
		cleared = false;
		open = true;
	}

	function close() {
		open = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	async function clearAll() {
		if (clearing) return;
		clearing = true;
		try {
			await clearAllSitePrefs();
			cleared = true;
			resumeCount = 0;
			onCleared?.();
		} finally {
			clearing = false;
		}
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

<button class="hero-link" onclick={show}>› Settings</button>

{#if open}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={(e) => {
			if (e.currentTarget === e.target) close();
		}}
	>
		<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
			<div class="panel-head">
				<span class="tag">›</span> settings
				<button class="modal-close" onclick={close} aria-label="close">✕</button>
			</div>
			<div class="panel-body">
				<h2 id="settings-title" class="modal-title">Site preferences</h2>

				<dl class="meta-list" style="border:none; padding:0; grid-template-columns:1fr;">
					<dt>your shares</dt>
					<dd>this browser remembers which files you shared, so you can delete them early.</dd>
					<dt>resume state</dt>
					<dd>
						{resumeCount > 0
							? `${resumeCount} interrupted upload${resumeCount === 1 ? '' : 's'} tracked locally`
							: 'no interrupted uploads tracked'}
					</dd>
				</dl>

				<p class="modal-text" style="margin-top:14px;">
					Clearing forgets which files you shared and any interrupted-upload progress on this
					browser. It does <strong>not</strong> delete your uploaded files — they still expire
					on their own schedule. You just lose the ability to revoke them early or resume an
					interrupted upload from this browser.
				</p>

				{#if cleared}
					<p class="password-form" style="margin:12px 0 0;">Cleared. This browser now has a clean slate.</p>
				{:else}
					<button class="btn outline danger" disabled={clearing} onclick={clearAll}>
						{clearing ? 'Clearing…' : 'Clear site preferences & cache'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
