export default function DashboardLoading() {
	return (
		<main className="mx-auto min-h-screen max-w-6xl animate-pulse px-4 py-8 md:px-8">
			<div className="h-14 rounded-2xl bg-white/[.06]" />
			<div className="mt-8 grid gap-6 lg:grid-cols-2">
				<div className="h-72 rounded-3xl bg-white/[.05]" />
				<div className="h-72 rounded-3xl bg-white/[.05]" />
			</div>
			<div className="mt-8 h-64 rounded-3xl bg-white/[.05]" />
		</main>
	);
}
