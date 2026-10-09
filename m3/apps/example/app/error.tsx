"use client";
// SPDX-License-Identifier: Apache-2.0

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert">
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="text-on-surface-variant">{error.digest ?? error.message}</p>
      <button type="button" onClick={reset} className="text-primary">
        Try again
      </button>
    </section>
  );
}
