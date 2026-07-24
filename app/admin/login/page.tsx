"use client";

import { useState, useEffect, type FormEvent } from "react";

/**
 * /admin/login
 *
 * Plain password form that posts to /api/admin/login. On success the server
 * sets an HttpOnly `cf_admin` cookie and we redirect to /admin.
 *
 * If the caller is already authenticated (valid cookie), we skip the form
 * and redirect straight through.
 */
export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Already logged in? Skip the form.
    fetch("/api/admin/me", { credentials: "same-origin" })
      .then((r) => {
        if (r.ok) window.location.replace("/admin");
      })
      .catch(() => {
        /* ignore — stay on the form */
      });
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const txt = await res.text();
        let msg = "Login failed";
        try {
          const parsed = JSON.parse(txt) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch {
          /* keep generic message */
        }
        setError(msg);
        return;
      }
      window.location.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold mb-1 text-neutral-900 dark:text-neutral-100">
          Admin login
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
          Enter the admin password.
        </p>

        <label
          htmlFor="password"
          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        />

        {error && (
          <p
            role="alert"
            className="mt-3 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !password}
          className="mt-4 w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md font-medium text-sm transition-colors"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}