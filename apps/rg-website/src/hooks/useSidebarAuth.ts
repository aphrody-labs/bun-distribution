"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/contexts/auth-context";
import { authClient } from "@/lib/auth-client";
import { getCurrentPublicProfile } from "@/app/settings/actions";
import type { PublicProfile } from "@rosegriffon/db";

type Profile = PublicProfile;
type AuthUser = typeof authClient.$Infer.Session.user;

interface UseSidebarAuthReturn {
	user: AuthUser | null;
	profile: Profile | null;
	loading: boolean;
	error: string | null;
}

export function useSidebarAuth(): UseSidebarAuthReturn {
	const queryClient = useQueryClient();
	const _router = useRouter();

	const { user, isLoading: sessionPending } = useAuth();

	const {
		data: profile,
		isLoading: profileLoading,
		error: profileError,
	} = useQuery({
		enabled: !!user?.id,
		gcTime: 1000 * 60 * 60 * 24,
		queryFn: async () => {
			if (!user?.id) return null;
			return await getCurrentPublicProfile();
		},
		queryKey: ["auth", "profile", user?.id],
		retry: 1,
		staleTime: 1000 * 60 * 15,
	});

	// Synchroniser le router quand la session change
	useEffect(() => {
		if (!sessionPending) {
			queryClient.invalidateQueries({ queryKey: ["auth"] });
		}
	}, [sessionPending, queryClient]);

	return {
		error: profileError ? (profileError as Error).message : null,
		loading: sessionPending || (!!user && profileLoading),
		profile: profile ?? null,
		user,
	};
}
