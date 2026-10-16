"use client";

import { AdminError } from "@/components/admin/admin-error";

export default function UsersError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return <AdminError error={error} reset={reset} />;
}
