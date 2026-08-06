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
		if (sec < 60) return ` · ${Math.round(sec)}s remaining`;
		if (sec < 3600)
			return ` · ${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s remaining`;
		return ` · ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m remaining`;
	}
</script>

<div class="flex items-center gap-3 p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg">
	<div class="flex-1 min-w-0">
		<div class="flex items-baseline justify-between gap-2">
			<span class="truncate font-medium text-neutral-900 dark:text-neutral-50">{file.name}</span>
			<span class="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">{sizeKB} KB</span>
		</div>

		<div class="mt-2 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
			<div
				class="h-full transition-all {uploadState.kind === 'error'
					? 'bg-red-500'
					: uploadState.kind === 'success'
						? 'bg-green-500'
						: 'bg-blue-500'}"
				style="width: {uploadState.kind === 'uploading'
					? `${Math.round(uploadState.progress * 100)}%`
					: uploadState.kind === 'success'
						? '100%'
						: '0%'}"
			/>
		</div>

		<div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400 h-4 leading-tight">
			{#if uploadState.kind === 'idle'}
				Waiting...
			{:else if uploadState.kind === 'preparing'}
				Requesting upload URL...
			{:else if uploadState.kind === 'uploading'}
				<span class="tabular-nums">{Math.round(uploadState.progress * 100)}%</span>
				<span class="ml-1 text-neutral-400 tabular-nums">
					{fmtBytes(uploadState.loaded)} / {fmtBytes(uploadState.total)}
				</span>
				{#if uploadState.speed > 0}
					<span class="ml-1 text-neutral-400 tabular-nums">
						· {fmtSpeed(uploadState.speed)}
						{estimateRemaining(uploadState.progress, uploadState.speed, uploadState.total, uploadState.loaded)}
					</span>
				{/if}
				{#if uploadState.partInfo}
					<span class="ml-1 text-neutral-400">{uploadState.partInfo}</span>
				{/if}
			{:else if uploadState.kind === 'success'}
				Uploaded · {uploadState.etag.slice(0, 12)}...
			{:else}
				<span class="text-red-600 dark:text-red-400">Error: {uploadState.message}</span>
			{/if}
		</div>
	</div>

	<div class="shrink-0">
		{#if isWorking}
			<button
				onclick={onCancel}
				class="px-3 py-1.5 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
			>
				Cancel
			</button>
		{/if}
		{#if uploadState.kind === 'error'}
			<button
				onclick={onRetry}
				class="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white"
			>
				Retry
			</button>
		{/if}
	</div>
</div>
