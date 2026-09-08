/**
 * Client-side site preferences: the cookie/privacy consent flag, and the
 * "clear site preferences & cache" action exposed from the Settings panel.
 *
 * Deliberately separate from resume.ts (which owns the upload-resume
 * localStorage entries) — this module is the one place that knows the full
 * list of local state cf-share keeps, so Settings can wipe all of it
 * without hunting through every component for a storage key.
 */

import { KEY_PREFIX as RESUME_KEY_PREFIX } from './resume';

const CONSENT_KEY = 'cf-share:consent';

export function hasConsented(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(CONSENT_KEY) === '1';
	} catch {
		return true; // storage unavailable — don't block the page on it
	}
}

export function setConsented(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(CONSENT_KEY, '1');
	} catch {
		// ignore
	}
}

/** Count of persisted upload-resume entries (cf-share:upload:*), for display in Settings. */
export function countResumeEntries(): number {
	if (typeof localStorage === 'undefined') return 0;
	let n = 0;
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith(RESUME_KEY_PREFIX)) n++;
		}
	} catch {
		// ignore
	}
	return n;
}

function clearResumeEntries(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const toRemove: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith(RESUME_KEY_PREFIX)) toRemove.push(k);
		}
		for (const k of toRemove) localStorage.removeItem(k);
	} catch {
		// ignore
	}
}

function clearConsent(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(CONSENT_KEY);
	} catch {
		// ignore
	}
}

/**
 * Clear everything Settings offers: the `cf_owned` delete-grant cookie
 * (server-side, HttpOnly — cleared via API), persisted upload-resume state,
 * and the cookie-consent flag. Returns what was cleared for a confirmation
 * message.
 */
export async function clearAllSitePrefs(): Promise<{ ownedCleared: boolean }> {
	clearResumeEntries();
	clearConsent();
	let ownedCleared = false;
	try {
		const r = await fetch('/api/share/mine', { method: 'DELETE' });
		ownedCleared = r.ok;
	} catch {
		ownedCleared = false;
	}
	return { ownedCleared };
}
