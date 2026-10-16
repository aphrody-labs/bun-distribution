"use client";

import React, { Component } from "react";
import type { ReactNode } from "react";

import { AlertCircle } from "@/lib/icons-config";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error Boundary pour capturer et gérer les erreurs React
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { error: null, hasError: false };
	}

	static getDerivedStateFromError(error: Error): State {
		return { error, hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("ErrorBoundary a capturé une erreur:", error, errorInfo);

		// Appeler le callback onError si fourni
		this.props.onError?.(error, errorInfo);
	}

	override render() {
		if (this.state.hasError) {
			// Afficher le fallback personnalisé si fourni
			if (this.props.fallback) {
				return this.props.fallback;
			}

			// Sinon, afficher le fallback par défaut
			return (
				<div className="flex min-h-[200px] flex-col items-center justify-center p-8">
					<div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center shadow-sm dark:border-red-900 dark:bg-red-950">
						<AlertCircle className="mx-auto mb-4 size-12 text-red-500" />
						<h2 className="mb-2 text-lg font-semibold text-red-900 dark:text-red-100">
							Une erreur est survenue
						</h2>
						<p className="mb-4 text-sm text-red-700 dark:text-red-300">
							{this.state.error?.message || "Une erreur inattendue s'est produite"}
						</p>
						<button
							onClick={() => this.setState({ error: null, hasError: false })}
							className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
						>
							Réessayer
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}

/**
 * Error Boundary simplifié pour des composants spécifiques
 */
export function SimpleErrorBoundary({
	children,
	message = "Une erreur est survenue",
}: {
	children: ReactNode;
	message?: string;
}) {
	return (
		<ErrorBoundary
			fallback={
				<div className="flex items-center justify-center p-4">
					<div className="text-center">
						<AlertCircle className="mx-auto mb-2 size-8 text-red-500" />
						<p className="text-sm text-muted-foreground">{message}</p>
					</div>
				</div>
			}
		>
			{children}
		</ErrorBoundary>
	);
}
