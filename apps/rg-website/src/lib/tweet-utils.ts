export const formatDate = (date: Date) =>
	new Intl.DateTimeFormat("fr-FR", {
		hour: "numeric",
		minute: "numeric",
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(date);

export const formatNumber = (n: number) =>
	new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(n);
