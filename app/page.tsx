import { Uploader } from "../components/uploader/Uploader";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="w-full max-w-xl text-center mt-12 mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Share
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Upload a file, get a short-lived shareable download link.
        </p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-500">
          <a
            href="/docs"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            API Documentation →
          </a>
          <span className="mx-2">&middot;</span>
          <a
            href="/admin"
            className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400 underline"
          >
            Admin
          </a>
        </p>
      </div>
      <Uploader />
    </main>
  );
}
