import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Utilitaires pour standardiser les réponses API
 */

export interface ApiSuccessResponse<T = unknown> {
	success: true;
	data: T;
}

export interface ApiErrorResponse {
	success: false;
	error: {
		message: string;
		code?: string;
		details?: unknown;
	};
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Crée une réponse de succès standardisée
 */
export function apiSuccess<T>(data: T, status = 200) {
	return NextResponse.json<ApiSuccessResponse<T>>(
		{
			data,
			success: true,
		},
		{ status }
	);
}

/**
 * Crée une réponse d'erreur standardisée
 */
export function apiError(message: string, status = 500, code?: string, details?: unknown) {
	return NextResponse.json<ApiErrorResponse>(
		{
			error: {
				code,
				details: process.env.NODE_ENV === "development" ? details : undefined,
				message,
			},
			success: false,
		},
		{ status }
	);
}

/**
 * Gestionnaire d'erreurs pour les routes API
 */
export function handleApiError(error: unknown) {
	if (error instanceof z.ZodError) {
		return apiError("Données invalides", 400, "VALIDATION_ERROR", error.issues);
	}

	if (error instanceof Error) {
		// Ne pas exposer les détails des erreurs en production
		const message =
			process.env.NODE_ENV === "development" ? error.message : "Une erreur est survenue";

		return apiError(message, 500, "INTERNAL_ERROR", error.stack);
	}

	return apiError("Une erreur inconnue est survenue", 500);
}

/**
 * Wrapper pour gérer les erreurs dans les routes API
 */
export function withErrorHandler<T extends unknown[]>(
	handler: (...args: T) => Promise<NextResponse>
) {
	return async (...args: T): Promise<NextResponse> => {
		try {
			return await handler(...args);
		} catch (error) {
			return handleApiError(error);
		}
	};
}
