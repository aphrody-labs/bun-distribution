import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-surface p-8">
      <div className="max-w-2xl rounded-small border border-outline-variant bg-surface-container p-8 shadow-md3-3">
        <h1 className="mb-4 text-headline-small font-bold text-on-surface">
          Something went wrong
        </h1>
        <p className="mb-4 text-on-surface-variant">
          The application encountered an error. Please try restarting.
        </p>
        <details className="mb-4">
          <summary className="cursor-pointer text-body-medium text-outline hover:text-on-surface-variant">
            Error details
          </summary>
          <pre className="mt-2 overflow-auto rounded-extra-small bg-app-darkBox p-4 text-body-small text-outline">
            {error.toString()}
            {error.stack}
          </pre>
        </details>
        <button
          onClick={onReset}
          className="rounded-extra-small bg-primary px-4 py-2 text-white hover:bg-primary"
        >
          Reload application
        </button>
      </div>
    </div>
  );
}

/**
 * Error boundary for catching and displaying React errors.
 *
 * Must be a class component as React doesn't provide hook-based error boundaries yet.
 * The fallback UI is extracted as a functional component for cleaner code.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback error={this.state.error} onReset={this.handleReset} />
      );
    }

    return this.props.children;
  }
}
