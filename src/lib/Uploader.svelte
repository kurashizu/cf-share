<script lang="ts">
	import { onMount } from 'svelte';
	import FileItem, { type UploadState } from './FileItem.svelte';
	import ResultPanel from './ResultPanel.svelte';
	import { DEFAULT_PROXY_MAX_FILE_SIZE } from '@/lib/config/proxy';
	import {
		fileFingerprint,
		loadPersistedUpload,
		savePersistedUpload,
		clearPersistedUpload,
		gcPersistedUploads,
		getPendingUploads,
		type PersistedPart,
		type PendingUploadSummary
	} from './client/resume';

	/** Number of samples to keep for speed calculation (rolling window). */
	const SPEED_SAMPLES = 10;
	const DEFAULT_MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB (anon)

	const ANON_TTL_PRESETS = [
		{ label: '5 minutes', value: 300 },
		{ label: '30 minutes', value: 1800 },
		{ label: '1 hour', value: 3600 },
		{ label: '6 hours', value: 21600 },
		{ label: '24 hours', value: 86400 },
		{ label: '3 days', value: 259200 },
		{ label: '7 days', value: 604800 }
	];

	const ADMIN_TTL_PRESETS = [{ label: 'No expiry', value: 0 }, ...ANON_TTL_PRESETS];

	interface CompletedUpload {
		shareToken: string;
		shareUrl: string;
		fullUrl: string;
		proxyUrl: string | null;
		expiresAt: number;
		filename: string;
		size: number;
		startedAt: number;
		password: string;
	}

	interface SpeedSample {
		loaded: number;
		at: number;
	}

	interface ActiveUpload {
		file: File;
		state: UploadState;
		xhr: XMLHttpRequest | null;
		uploadId: string | null;
		startedAt: number;
		speedSamples: SpeedSample[];
	}

	interface SingleInitResponse {
		mode: 'single';
		uploadId: string;
		key: string;
		uploadSig: string;
		url: string;
		headers: Record<string, string>;
		expiresIn: number;
	}

	interface PartPresign {
		partNumber: number;
		url: string;
		size: number;
	}

	interface MultipartInitResponse {
		mode: 'multipart';
		uploadId: string;
		s3UploadId: string;
		key: string;
		uploadSig: string;
		parts: PartPresign[];
		partSize: number;
		expiresIn: number;
	}

	type InitResponse = SingleInitResponse | MultipartInitResponse;

	let {
		extraHeaders = {},
		maxSize = DEFAULT_MAX_SIZE,
		ttlPresets = ANON_TTL_PRESETS,
		omitCredentials = false,
		globalPaste = false
	}: {
		extraHeaders?: Record<string, string>;
		maxSize?: number;
		ttlPresets?: { label: string; value: number }[];
		omitCredentials?: boolean;
		globalPaste?: boolean;
	} = $props();

	const fetchOpts = $derived<RequestInit>(omitCredentials ? { credentials: 'omit' } : {});

	let active = $state<ActiveUpload | null>(null);
	let completed = $state<CompletedUpload | null>(null);
	let ttl = $state(86400); // default 24h
	let password = $state('');
	let cancelledRef = $state(false);
	let isDragActive = $state(false);
	let windowDragActive = $state(false);
	let pendingResumes = $state<PendingUploadSummary[]>([]);
	let mode = $state<'file' | 'text'>('file');
	let text = $state('');
	let textareaRef = $state<HTMLTextAreaElement | null>(null);

	const latestPending = $derived(pendingResumes.length > 0 ? pendingResumes[0] : null);
	const busy = $derived(active !== null && active.state.kind !== 'error');
	// Text pastes are capped at the proxy threshold so the receiver always
	// gets the inline view + one-click copy instead of a file download.
	const TEXT_MAX_BYTES = DEFAULT_PROXY_MAX_FILE_SIZE;
	const textBytes = $derived(new Blob([text]).size);

	function refreshPendingUploads() {
		pendingResumes = getPendingUploads();
	}

	function dismissPendingResume(fp: string) {
		clearPersistedUpload(fp);
		refreshPendingUploads();
	}

	// GC stale persisted uploads on mount & check for resumable uploads
	onMount(() => {
		gcPersistedUploads(6 * 60 * 60 * 1000);
		refreshPendingUploads();

		let dragCounter = 0;
		const onDragEnter = (e: DragEvent) => {
			if (busy) return;
			if (e.dataTransfer?.types?.includes('Files')) {
				dragCounter++;
				windowDragActive = true;
			}
		};
		const onDragLeave = (e: DragEvent) => {
			if (busy) return;
			dragCounter = Math.max(0, dragCounter - 1);
			if (dragCounter === 0) windowDragActive = false;
		};
		const onDragOver = (e: DragEvent) => {
			if (busy) return;
			if (e.dataTransfer?.types?.includes('Files')) {
				e.preventDefault();
			}
		};
		const onDropGlobal = (e: DragEvent) => {
			dragCounter = 0;
			windowDragActive = false;
			isDragActive = false;
			if (busy) return;
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length > 0) {
				e.preventDefault();
				mode = 'file';
				startUpload(files[0]);
			}
		};

		window.addEventListener('dragenter', onDragEnter);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('drop', onDropGlobal);

		return () => {
			window.removeEventListener('dragenter', onDragEnter);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('drop', onDropGlobal);
		};
	});

	// Global paste: Ctrl/Cmd+V anywhere on the page shares the clipboard —
	// files/screenshots go straight to upload, text opens the text composer.
	onMount(() => {
		if (!globalPaste) return;
		const onPaste = (e: ClipboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (
				t &&
				(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
			) {
				return; // let normal inputs handle their own paste
			}
			if (busy) return;
			const files = Array.from(e.clipboardData?.files ?? []);
			if (files.length > 0) {
				e.preventDefault();
				mode = 'file';
				startUpload(files[0]);
				return;
			}
			const pasted = e.clipboardData?.getData('text/plain') ?? '';
			if (pasted) {
				e.preventDefault();
				mode = 'text';
				text = text ? text + pasted : pasted;
				queueMicrotask(() => textareaRef?.focus());
			}
		};
		window.addEventListener('paste', onPaste);
		return () => window.removeEventListener('paste', onPaste);
	});

	/** Update active state with progress and speed tracking. */
	function setProgress(
		file: File,
		loaded: number,
		total: number,
		partInfo?: string
	) {
		if (!active || active.file !== file) return;
		const now = Date.now();
		const samples = [...active.speedSamples, { loaded, at: now }].slice(-SPEED_SAMPLES);
		let speed = 0;
		if (samples.length >= 2) {
			const first = samples[0];
			const last = samples[samples.length - 1];
			const deltaBytes = last.loaded - first.loaded;
			const deltaMs = last.at - first.at;
			if (deltaMs > 200) speed = (deltaBytes / deltaMs) * 1000; // bytes/sec
		}
		active.speedSamples = samples;
		active.state = {
			kind: 'uploading',
			progress: total > 0 ? loaded / total : 0,
			loaded,
			total,
			speed,
			...(partInfo ? { partInfo } : {})
		};
	}

	function setErrorState(file: File, startedAt: number, err: unknown) {
		if (!active || active.file !== file) return;
		active.state = {
			kind: 'error',
			message: err instanceof Error ? err.message : String(err)
		};
		active.xhr = null;
		active.uploadId = null;
		active.startedAt = startedAt;
	}

	/** Fetch a fresh multipart-or-single init. Throws on non-2xx. */
	async function freshInit(
		file: File,
		ttlValue: number,
		passwordValue: string
	): Promise<InitResponse> {
		const resp = await fetch('/api/upload/init', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...extraHeaders },
			...fetchOpts,
			body: JSON.stringify({
				filename: file.name,
				size: file.size,
				contentType: file.type || 'application/octet-stream',
				ttl: ttlValue,
				password: passwordValue || undefined
			})
		});
		if (!resp.ok) {
			const txt = await resp.text();
			throw new Error(`init ${resp.status}: ${txt}`);
		}
		return (await resp.json()) as InitResponse;
	}

	/** Single PUT upload (files ≤ ~90 MB). */
	async function doSingleUpload(
		file: File,
		init: SingleInitResponse,
		startedAt: number,
		ttlValue: number,
		passwordValue: string
	) {
		if (!active || active.file !== file) return;
		const xhr = new XMLHttpRequest();
		active.state = {
			kind: 'uploading',
			progress: 0,
			loaded: 0,
			total: file.size,
			speed: 0
		};
		active.xhr = xhr;
		active.startedAt = startedAt;

		const done = new Promise<{ etag: string }>((resolve, reject) => {
			xhr.upload.addEventListener('progress', (e) => {
				if (e.lengthComputable) {
					setProgress(file, e.loaded, e.total);
				}
			});
			xhr.addEventListener('load', () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					const etag =
						xhr.getResponseHeader('etag') || xhr.getResponseHeader('ETag') || '';
					resolve({ etag: etag.replace(/"/g, '') });
				} else {
					reject(new Error(`PUT ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
				}
			});
			xhr.addEventListener('error', () => reject(new Error('Network error')));
			xhr.addEventListener('abort', () => reject(new Error('Cancelled')));
		});

		xhr.open('PUT', init.url);
		for (const [k, v] of Object.entries(init.headers)) {
			xhr.setRequestHeader(k, v);
		}
		xhr.send(file);

		let etag: string;
		try {
			({ etag } = await done);
		} catch (err) {
			if (cancelledRef) return;
			setErrorState(file, startedAt, err);
			return;
		}

		if (cancelledRef) return;

		await completeUpload(
			file,
			{
				uploadId: init.uploadId,
				key: init.key,
				uploadSig: init.uploadSig,
				etag,
				mode: 'single'
			},
			startedAt,
			ttlValue,
			passwordValue
		);
	}

	/** Multipart upload (files > ~90 MB, split into 50 MB parts). */
	async function doMultipartUpload(
		file: File,
		init: MultipartInitResponse,
		startedAt: number,
		ttlValue: number,
		passwordValue: string,
		fingerprint: string,
		alreadyDone: PersistedPart[]
	) {
		if (!active || active.file !== file) return;
		const parts = init.parts;
		const partSize = init.partSize;
		const completedParts: PersistedPart[] = [...alreadyDone];
		const completedSet = new Set(alreadyDone.map((p) => p.partNumber));

		let totalLoaded = 0;
		for (const p of alreadyDone) {
			const start = (p.partNumber - 1) * partSize;
			const end = Math.min(start + partSize, file.size);
			totalLoaded += end - start;
		}
		const totalSize = file.size;

		active.state = {
			kind: 'uploading',
			progress: totalSize > 0 ? totalLoaded / totalSize : 0,
			loaded: totalLoaded,
			total: totalSize,
			speed: 0,
			partInfo: `Part ${completedParts.length}/${parts.length + completedParts.length}${
				alreadyDone.length > 0 ? ` (resumed ${alreadyDone.length})` : ''
			}`
		};
		active.xhr = null;
		active.startedAt = startedAt;

		const totalParts = parts.length + completedParts.length;
		for (let i = 0; i < totalParts; i++) {
			if (cancelledRef) return;

			const partNumber = i + 1;

			if (completedSet.has(partNumber)) {
				continue; // Already on S3 — skip.
			}

			const presign = parts.find((p) => p.partNumber === partNumber);
			if (!presign) {
				setErrorState(file, startedAt, new Error(`No presigned URL for part ${partNumber}`));
				return;
			}

			const start = (partNumber - 1) * partSize;
			const end = Math.min(start + presign.size, file.size);
			const blob = file.slice(start, end);

			const xhr = new XMLHttpRequest();
			if (active && active.file === file) active.xhr = xhr;

			const uploaded = await new Promise<{ etag: string }>((resolve, reject) => {
				xhr.open('PUT', presign.url);

				xhr.upload.addEventListener('progress', (e) => {
					if (e.lengthComputable) {
						const partProgress = totalLoaded + e.loaded;
						setProgress(
							file,
							partProgress,
							totalSize,
							`Part ${partNumber}/${totalParts}${
								alreadyDone.length > 0 ? ` (resumed ${alreadyDone.length})` : ''
							}`
						);
					}
				});
				xhr.addEventListener('load', () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						const etag =
							xhr.getResponseHeader('etag') || xhr.getResponseHeader('ETag') || '';
						resolve({ etag: etag.replace(/"/g, '') });
					} else {
						reject(
							new Error(
								`Part ${partNumber} PUT ${xhr.status}: ${xhr.responseText.slice(0, 200)}`
							)
						);
					}
				});
				xhr.addEventListener('error', () =>
					reject(new Error(`Part ${partNumber} network error`))
				);
				xhr.addEventListener('abort', () => reject(new Error('Cancelled')));

				xhr.send(blob);
			});

			totalLoaded += presign.size;
			completedParts.push({ partNumber, etag: uploaded.etag });
			completedSet.add(partNumber);

			// Persist progress so a refresh can resume from here.
			savePersistedUpload(fingerprint, {
				s3UploadId: init.s3UploadId,
				key: init.key,
				size: file.size,
				filename: file.name,
				contentType: file.type || 'application/octet-stream',
				uploadSig: init.uploadSig,
				completedParts,
				savedAt: Date.now()
			});
			refreshPendingUploads();
		}

		if (cancelledRef) return;

		await completeUpload(
			file,
			{
				uploadId: init.uploadId,
				key: init.key,
				uploadSig: init.uploadSig,
				mode: 'multipart',
				s3UploadId: init.s3UploadId,
				parts: completedParts
			},
			startedAt,
			ttlValue,
			passwordValue,
			fingerprint
		);
	}

	/** Common complete step for both single and multipart. */
	async function completeUpload(
		file: File,
		completePayload: Record<string, unknown>,
		startedAt: number,
		ttlValue: number,
		passwordValue: string,
		fingerprint?: string
	) {
		if (cancelledRef) return;
		if (active && active.file === file) {
			active.state = { kind: 'success', etag: '—' };
			active.xhr = null;
		}

		try {
			const body = {
				...completePayload,
				filename: file.name,
				size: file.size,
				contentType: file.type || 'application/octet-stream',
				ttl: ttlValue,
				password: passwordValue || undefined
			};

			const r = await fetch('/api/upload/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...extraHeaders },
				...fetchOpts,
				body: JSON.stringify(body)
			});
			if (!r.ok) {
				const txt = await r.text();
				throw new Error(`complete ${r.status}: ${txt}`);
			}
			const data = (await r.json()) as {
				shareToken: string;
				shareUrl: string;
				fullUrl: string;
				proxyUrl: string | null;
				expiresAt: number;
			};

			if (fingerprint) {
				clearPersistedUpload(fingerprint);
				refreshPendingUploads();
			}

			completed = {
				shareToken: data.shareToken,
				shareUrl: data.shareUrl,
				fullUrl: data.fullUrl,
				proxyUrl: data.proxyUrl,
				expiresAt: data.expiresAt,
				filename: file.name,
				size: file.size,
				startedAt,
				password: passwordValue
			};
			active = null;
		} catch (err) {
			setErrorState(file, startedAt, err);
			refreshPendingUploads();
		}
	}

	async function startUpload(file: File) {
		cancelledRef = false;
		const startedAt = Date.now();
		completed = null;

		active = {
			file,
			state: { kind: 'preparing' },
			xhr: null,
			uploadId: null,
			startedAt,
			speedSamples: []
		};

		const currentTtl = ttl;
		const currentPassword = password;

		let fp: string;
		try {
			fp = await fileFingerprint(file);
		} catch {
			fp = `anon-${Date.now()}-${Math.random()}`;
		}
		const persisted = loadPersistedUpload(fp);

		let init: InitResponse;
		let resuming = false;
		try {
			if (
				persisted &&
				persisted.size === file.size &&
				persisted.s3UploadId &&
				persisted.key &&
				persisted.uploadSig
			) {
				// Try to resume the in-progress upload.
				const resp = await fetch('/api/upload/resume', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...extraHeaders },
					...fetchOpts,
					body: JSON.stringify({
						s3UploadId: persisted.s3UploadId,
						key: persisted.key,
						size: persisted.size,
						contentType: persisted.contentType,
						uploadSig: persisted.uploadSig,
						uploadedPartNumbers: persisted.completedParts.map((p) => p.partNumber)
					})
				});
				if (resp.ok) {
					init = (await resp.json()) as MultipartInitResponse;
					resuming = true;
				} else if (resp.status === 410) {
					// Multipart expired or aborted by cleanup. Drop stale state.
					clearPersistedUpload(fp);
					init = await freshInit(file, currentTtl, currentPassword);
				} else {
					const txt = await resp.text();
					throw new Error(`resume ${resp.status}: ${txt}`);
				}
			} else {
				init = await freshInit(file, currentTtl, currentPassword);
			}
		} catch (err) {
			setErrorState(file, startedAt, err);
			return;
		}

		if (active && active.file === file) active.uploadId = init.uploadId;

		if (init.mode === 'multipart') {
			const alreadyDone = resuming && persisted ? persisted.completedParts : [];
			await doMultipartUpload(
				file,
				init,
				startedAt,
				currentTtl,
				currentPassword,
				fp,
				alreadyDone
			);
		} else {
			await doSingleUpload(file, init, startedAt, currentTtl, currentPassword);
		}
	}

	function onDrop(files: File[]) {
		if (files.length === 0) return;
		startUpload(files[0]);
	}

	function shareText() {
		const t = text;
		if (!t.trim() || busy || textBytes > TEXT_MAX_BYTES) return;
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const name = `paste-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.txt`;
		startUpload(new File([t], name, { type: 'text/plain; charset=utf-8' }));
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(2)} MB`;
	}

	function cancel() {
		cancelledRef = true;
		if (active?.xhr) active.xhr.abort();
		active = null;
	}

	function retry() {
		if (active) startUpload(active.file);
	}
</script>

<div class="panel">
	<div class="panel-head">
		<span class="tag">›</span> send
		<span class="meta">
			{#if mode === 'file'}
				max {maxSize >= 1024 * 1024 * 1024
					? `${Math.round(maxSize / (1024 * 1024 * 1024))} GB`
					: `${Math.round(maxSize / (1024 * 1024))} MB`}
			{:else}
				text · inline up to {Math.round(TEXT_MAX_BYTES / (1024 * 1024))} MB
			{/if}
		</span>
	</div>
	<div class="panel-body">
		{#if latestPending && !busy && !completed}
			<div class="resume-banner" role="status">
				<div class="resume-banner-main">
					<span class="resume-tag">resumable</span>
					<div class="resume-text">
						<span class="resume-filename" title={latestPending.filename}>{latestPending.filename}</span>
						<span class="resume-meta">
							· {latestPending.progressPercent}% ({formatBytes(latestPending.loadedBytes)} / {formatBytes(latestPending.size)})
						</span>
					</div>
				</div>
				<div class="resume-actions">
					<button
						type="button"
						class="btn sm primary resume-btn"
						onclick={() => {
							document.querySelector<HTMLInputElement>('[data-upload-input]')?.click();
						}}
					>
						Resume upload ›
					</button>
					<button
						type="button"
						class="resume-dismiss"
						title="Discard unfinished upload"
						aria-label="Discard unfinished upload"
						onclick={() => dismissPendingResume(latestPending.fingerprint)}
					>
						✕
					</button>
				</div>
			</div>
		{/if}

		<div class="mode-tabs" role="tablist">
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'file'}
				class="mode-tab {mode === 'file' ? 'active' : ''}"
				disabled={busy}
				onclick={() => (mode = 'file')}
			>file</button>
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'text'}
				class="mode-tab {mode === 'text' ? 'active' : ''}"
				disabled={busy}
				onclick={() => {
					mode = 'text';
					queueMicrotask(() => textareaRef?.focus());
				}}
			>text / clipboard</button>
		</div>

		<div class="controls">
			<div class="field">
				<label for="ttl-select">expires in</label>
				<select
					bind:value={ttl}
					id="ttl-select"
					class="select"
					disabled={active !== null && active.state.kind !== 'error'}
				>
					{#each ttlPresets as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>

			<div class="field">
				<label for="password-input">password <span class="optional">· optional</span></label>
				<input
					bind:value={password}
					id="password-input"
					class="input"
					type="password"
					placeholder="no password"
					disabled={active !== null && active.state.kind !== 'error'}
				/>
			</div>
		</div>

		{#if mode === 'text'}
		<div class="text-compose">
			<textarea
				bind:this={textareaRef}
				bind:value={text}
				class="text-area"
				placeholder="paste or type text to share… (Ctrl+V anywhere on the page also lands here)"
				disabled={busy}
				onkeydown={(e) => {
					if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
						e.preventDefault();
						shareText();
					}
				}}
			></textarea>
			<div class="text-compose-foot">
				<span class="text-count {textBytes > TEXT_MAX_BYTES ? 'over' : ''}">
					{formatBytes(textBytes)} / {Math.round(TEXT_MAX_BYTES / (1024 * 1024))} MB
					{#if textBytes > TEXT_MAX_BYTES}· too large for a text share — share as a file instead{/if}
				</span>
				<button
					class="btn primary"
					disabled={busy || !text.trim() || textBytes > TEXT_MAX_BYTES}
					onclick={shareText}
				>
					Share text <span class="kbd-hint">⌃⏎</span>
				</button>
			</div>
		</div>
		{:else}
		<div
			class="dropzone {isDragActive ? 'active' : ''} {windowDragActive ? 'window-drag' : ''} {active && active.state.kind !== 'error' ? 'is-busy' : ''}"
			role="button"
			tabindex="0"
			onclick={() => {
				if (active && active.state.kind !== 'error') return;
				document.querySelector<HTMLInputElement>('[data-upload-input]')?.click();
			}}
			ondragover={(e) => {
				e.preventDefault();
				isDragActive = true;
			}}
			ondragleave={(e) => {
				e.preventDefault();
				isDragActive = false;
			}}
			ondrop={(e) => {
				e.preventDefault();
				isDragActive = false;
				windowDragActive = false;
				if (active && active.state.kind !== 'error') return;
				const files = Array.from(e.dataTransfer?.files ?? []);
				onDrop(files);
			}}
			onkeydown={(e) => {
				if ((e.key === 'Enter' || e.key === ' ') && !(active && active.state.kind !== 'error')) {
					document.querySelector<HTMLInputElement>('[data-upload-input]')?.click();
				}
			}}
		>
			<input
				class="hidden"
				data-upload-input
				type="file"
				onchange={(e) => {
					const input = e.currentTarget as HTMLInputElement;
					if (input.files && input.files.length > 0) {
						onDrop(Array.from(input.files));
					}
					input.value = '';
				}}
			/>
			<p class="dropzone-title">
				{isDragActive
					? '[ drop file to upload ]'
					: windowDragActive
						? '[ release file here to upload ]'
						: '[ drop file here or click to select ]'}
			</p>
			<p class="dropzone-meta">
				max {maxSize >= 1024 * 1024 * 1024
					? `${Math.round(maxSize / (1024 * 1024 * 1024))} GB`
					: `${Math.round(maxSize / (1024 * 1024))} MB`}
				· any file type · direct-to-S3 upload{globalPaste ? ' · Ctrl+V to paste a file' : ''}
			</p>
		</div>
		{/if}

		{#if active}
			<FileItem file={active.file} uploadState={active.state} onCancel={cancel} onRetry={retry} />
		{/if}

		{#if completed}
			<ResultPanel
				shareToken={completed.shareToken}
				shareUrl={completed.shareUrl}
				fullUrl={completed.fullUrl}
				proxyUrl={completed.proxyUrl}
				expiresAt={completed.expiresAt}
				filename={completed.filename}
				size={completed.size}
				startedAt={completed.startedAt}
				password={completed.password}
			/>
		{/if}
	</div>
</div>

{#if windowDragActive && !busy}
	<div class="global-drag-overlay" aria-hidden="true">
		<div class="global-drag-tip">
			↓ Drop file anywhere to start upload
		</div>
	</div>
{/if}
