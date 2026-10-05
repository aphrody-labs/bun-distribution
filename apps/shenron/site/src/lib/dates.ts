// Dates françaises par Intl (natif, navigateur comme serveur) : remplace date-fns `format(…, { locale: fr })`.
const courte = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const longue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** `5 oct. 2026` (date-fns `d MMM yyyy`). */
export const dateCourte = (valeur: Date | string | number): string => courte.format(new Date(valeur));

/** `5 octobre 2026` (date-fns `d MMMM yyyy`). */
export const dateLongue = (valeur: Date | string | number): string => longue.format(new Date(valeur));
