"use client";

import { Button } from "@rosegriffon/ui";
import React from "react";

import { AlertTriangle, RefreshCw } from "@/lib/icons-config";

interface ErrorBoundaryProps {
	children: React.ReactNode;
	fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error, hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("Error Boundary caught:", error, errorInfo);
	}

	resetError = () => {
		this.setState({ error: undefined, hasError: false });
	};

	override render() {
		if (this.state.hasError) {
			return (
				this.props.fallback || (
					<div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
						<div className="text-center">
							<div className="flex justify-center mb-4">
								<AlertTriangle className="size-12 text-red-500" />
							</div>
							<h1 className="text-2xl font-bold text-foreground mb-2">Une erreur s'est produite</h1>
							<p className="text-muted-foreground mb-4">
								{this.state.error?.message || "Une erreur inattendue s'est produite"}
							</p>
							<div className="flex gap-3 justify-center">
								<Button onClick={this.resetError} className="gap-2">
									<RefreshCw className="size-4" />
									Réessayer
								</Button>
								<Button variant="outline" onClick={() => (window.location.href = "/admin")}>
									Retour au dashboard
								</Button>
							</div>
							{process.env.NODE_ENV === "development" && (
								<pre className="mt-8 text-left bg-muted p-4 rounded-lg overflow-auto max-w-md text-sm text-foreground/80">
									{this.state.error?.toString()}
								</pre>
							)}
						</div>
					</div>
				)
			);
		}

		return this.props.children;
	}
}
