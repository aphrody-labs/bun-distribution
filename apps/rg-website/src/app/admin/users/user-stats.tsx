"use client";

import { DashboardStatsCard as StatsCard } from "@rosegriffon/ui";
import { Clock, Shield, UserCheck, Users } from "@/lib/icons-config";

interface UserStatsProps {
	totalUsers: number;
	adminUsers: number;
	moderatorUsers: number;
	newUsers: number;
}

export function UserStats({ totalUsers, adminUsers, moderatorUsers, newUsers }: UserStatsProps) {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatsCard title="Total utilisateurs" value={totalUsers} icon={Users} accent="sky" />
			<StatsCard title="Administrateurs" value={adminUsers} icon={Shield} accent="violet" />
			<StatsCard title="Modérateurs" value={moderatorUsers} icon={UserCheck} accent="emerald" />
			<StatsCard title="Nouveaux (30j)" value={newUsers} icon={Clock} accent="amber" />
		</div>
	);
}
