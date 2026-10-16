"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface AuthContextType {
	user: typeof authClient.$Infer.Session.user | null;
	isLoading: boolean;
	error: string | null;
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<typeof authClient.$Infer.Session.user | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		authClient
			.getSession()
			.then(({ data }) => {
				if (active) {
					setUser(data?.user ?? null);
					setIsLoading(false);
				}
			})
			.catch((err) => {
				if (active) {
					setError(err ? String(err) : null);
					setIsLoading(false);
				}
			});
		return () => {
			active = false;
		};
	}, []);

	const logout = async () => {
		await authClient.signOut();
		setUser(null);
	};

	const value: AuthContextType = {
		error,
		isLoading,
		logout,
		user,
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth doit être utilisé dans un AuthProvider");
	}
	return context;
}

export function useIsAuthenticated(): boolean {
	const { user, isLoading } = useAuth();
	return !isLoading && user !== null;
}

export function useUserId(): string | null {
	const { user } = useAuth();
	return user?.id ?? null;
}
