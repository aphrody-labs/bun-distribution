import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageContent = readFileSync(
	join(import.meta.dir, "../src/app/wiki/interviews/page.tsx"),
	"utf8"
);
const explorerContent = readFileSync(
	join(import.meta.dir, "../src/components/wiki/InterviewsExplorer.tsx"),
	"utf8"
);

describe("InterviewsExplorer et page /wiki/interviews", () => {
	test("la page délègue l'affichage au composant interactif InterviewsExplorer", () => {
		expect(pageContent).toContain("InterviewsExplorer");
		expect(pageContent).toContain("<InterviewsExplorer groups={groups}");
	});

	test("le composant InterviewsExplorer implémente la liste dépliable avec flèche", () => {
		expect(explorerContent).toContain("openGroups");
		expect(explorerContent).toContain("toggleGroup");
		expect(explorerContent).toContain("aria-expanded");
		expect(explorerContent).toContain("Tout déplier");
		expect(explorerContent).toContain("Tout replier");
	});

	test("le composant implémente le tri et la recherche", () => {
		expect(explorerContent).toContain("sortOrder");
		expect(explorerContent).toContain("date-desc");
		expect(explorerContent).toContain("date-asc");
		expect(explorerContent).toContain("count-desc");
		expect(explorerContent).toContain("title-asc");
		expect(explorerContent).toContain("interview-search");
	});

	test("le composant supporte le filtrage par décennie", () => {
		expect(explorerContent).toContain("decadeFilter");
		expect(explorerContent).toContain("80s");
		expect(explorerContent).toContain("Années 80 (1980-89)");
		expect(explorerContent).toContain("90s");
		expect(explorerContent).toContain("2000s");
		expect(explorerContent).toContain("2010s");
		expect(explorerContent).toContain("aria-pressed={decadeFilter === pill.id}");
		expect(explorerContent).toContain('aria-live="polite"');
		expect(explorerContent).toContain("openGroupsInView");
	});
});
