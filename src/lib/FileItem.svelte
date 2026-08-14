<script lang="ts">
	import { onMount } from 'svelte';

	export type UploadState =
		| { kind: 'idle' }
		| { kind: 'preparing' }
		| {
				kind: 'uploading';
				progress: number;
				loaded: number;
				total: number;
				speed: number; // bytes/sec
				partInfo?: string;
		  }
		| { kind: 'success'; etag: string }
		| { kind: 'error'; message: string };

	let {
		file,
		uploadState,
		onCancel,
		onRetry
	}: {
		file: File;
		uploadState: UploadState;
		onCancel: () => void;
		onRetry: () => void;
	} = $props();

	let now = $state(Date.now());

	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	const sizeKB = (file.size / 1024).toFixed(1);
	const isWorking = uploadState.kind === 'preparing' || uploadState.kind === 'uploading';

	function fmtBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
	}

	function fmtSpeed(bytesPerSec: number): string {
		if (bytesPerSec <= 0) return '';
		if (bytesPerSec >= 1_000_000) return (bytesPerSec / 1_000_000).toFixed(1) + ' MB/s';
		if (bytesPerSec >= 1_000) return (bytesPerSec / 1_000).toFixed(1) + ' KB/s';
		return Math.round(bytesPerSec) + ' B/s';
	}

	function estimateRemaining(
		progress: number,
		speed: number,
		total: number,
		loaded: number
	): string {
		if (speed <= 0 || progress >= 1) return '';
		const remaining = total - loaded;
		const sec = remaining / speed;
		if (sec < 5) return '';
		if (sec < 60) return ` · ${Math.round(sec)}s left`;
		if (sec < 3600)
			return ` · ${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s left`;
		return ` · ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`;
	}
</script>

<div class="phase-row" style="margin-top:14px;">
	<div class="phase-label">
		{#if uploadState.kind === 'preparing'}prepare{:else if uploadState.kind === 'uploading'}upload{:else if uploadState.kind === 'success'}complete{:else if uploadState.kind === 'error'}error{:else}idle{/if}
	</div>
	<div class="phase-bar">
		<div
			class="phase-bar-fill {uploadState.kind === 'error'
				? 'error'
				: uploadState.kind === 'success'
					? 'done'
					: ''}"
			style="width: {uploadState.kind === 'uploading'
				? `${Math.round(uploadState.progress * 100)}%`
				: uploadState.kind === 'success'
					? '100%'
					: uploadState.kind === 'preparing'
						? '8%'
						: '0%'}"
		/>
	</div>
	<div
		class="phase-meta {uploadState.kind === 'success'
			? 'done'
			: uploadState.kind === 'uploading' || uploadState.kind === 'preparing'
				? 'active'
				: ''}"
	>
		{#if uploadState.kind === 'idle'}
			waiting…
		{:else if uploadState.kind === 'preparing'}
			requesting upload URL…
		{:else if uploadState.kind === 'uploading'}
			<span style="font-variant-numeric:tabular-nums;">{Math.round(uploadState.progress * 100)}%</span>
			<span style="margin-left:6px; color:var(--text-faint); font-variant-numeric:tabular-nums;">
				{fmtBytes(uploadState.loaded)} / {fmtBytes(uploadState.total)}
			</span>
			{#if uploadState.speed > 0}
				<span style="margin-left:6px; color:var(--text-faint); font-variant-numeric:tabular-nums;">
					· {fmtSpeed(uploadState.speed)}{estimateRemaining(uploadState.progress, uploadState.speed, uploadState.total, uploadState.loaded)}
				</span>
			{/if}
			{#if uploadState.partInfo}
				<span style="margin-left:6px; color:var(--text-faint);">{uploadState.partInfo}</span>
			{/if}
		{:else if uploadState.kind === 'success'}
			<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8">
				<path
					d="M2 6.5l3 3 5-7"
					stroke-dasharray="20"
					stroke-dashoffset="20"
					style="animation: draw-check 0.5s var(--ease) 0.1s forwards;"
				/>
			</svg>
			<span>{file.name}</span>
		{:else}
			<span style="color:var(--error);">{uploadState.message}</span>
		{/if}
	</div>
</div>

<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
	{#if isWorking}
		<button class="btn outline" onclick={onCancel}>Cancel</button>
	{/if}
	{#if uploadState.kind === 'error'}
		<button class="btn primary" onclick={onRetry}>Retry</button>
	{/if}
</div>
