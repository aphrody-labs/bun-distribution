import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Calendar } from "../src/components/calendar";

const render = (props: React.ComponentProps<typeof Calendar>) =>
  renderToStaticMarkup(React.createElement(Calendar, props));

describe("Calendar (sans react-day-picker)", () => {
  test("octobre 2026 : légende, jours de la semaine et 31 boutons de jour", () => {
    const html = render({
      mode: "single",
      defaultMonth: new Date(2026, 9, 1),
      showOutsideDays: false,
    });
    expect(html).toContain("octobre 2026");
    expect(html).toContain(">lun.<");
    expect(html).toContain(">dim.<");
    expect(html.match(/data-date=/g)?.length).toBe(31);
    expect(html).toContain('aria-label="Mois précédent"');
  });

  test("jours hors mois affichés par défaut", () => {
    const html = render({ mode: "single", defaultMonth: new Date(2026, 9, 1) });
    expect(html.match(/data-date=/g)?.length).toBe(35);
  });

  test("sélection simple : un seul jour pressé", () => {
    const html = render({
      mode: "single",
      selected: new Date(2026, 9, 6),
      defaultMonth: new Date(2026, 9, 1),
      showOutsideDays: false,
    });
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html).toContain("mardi 6 octobre 2026");
  });

  test("plage : début, milieu et fin", () => {
    const html = render({
      mode: "range",
      selected: { from: new Date(2026, 9, 5), to: new Date(2026, 9, 8) },
      defaultMonth: new Date(2026, 9, 1),
      showOutsideDays: false,
    });
    expect(html.match(/data-range-start="true"/g)?.length).toBe(1);
    expect(html.match(/data-range-middle="true"/g)?.length).toBe(2);
    expect(html.match(/data-range-end="true"/g)?.length).toBe(1);
  });

  test("jours désactivés et locale anglaise (dimanche en premier)", () => {
    const html = render({
      mode: "single",
      locale: "en-US",
      defaultMonth: new Date(2026, 9, 1),
      disabled: { before: new Date(2026, 9, 10) },
      showOutsideDays: false,
    });
    expect(html).toContain("October 2026");
    expect(html.indexOf(">Sun<")).toBeLessThan(html.indexOf(">Mon<"));
    expect(html.match(/disabled=""/g)?.length).toBe(9);
  });

  test("numéros de semaine et plusieurs mois", () => {
    const html = render({
      mode: "single",
      defaultMonth: new Date(2026, 9, 1),
      numberOfMonths: 2,
      showWeekNumber: true,
    });
    expect(html).toContain("octobre 2026");
    expect(html).toContain("novembre 2026");
  });
});
