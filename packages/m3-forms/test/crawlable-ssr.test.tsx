// SPDX-License-Identifier: Apache-2.0
// Crawlability of the server-rendered form markup: labelled controls, deterministic test hooks and
// aria-describedby that never points at an id missing from the document.

import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  InputField,
  SelectField,
  SwitchField,
} from "../src/index";

function Harness({ children }: { children: ReactNode }) {
  const form = useForm({ defaultValues: { name: "", role: "user", notify: true } });
  return (
    <Form {...form}>
      <form>{children}</form>
    </Form>
  );
}
const render = (node: ReactNode) => renderToStaticMarkup(<Harness>{node}</Harness>);

/** Ids referenced by aria-describedby / for that do not exist in the markup. */
function danglingRefs(html: string): string[] {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!));
  const refs = [...html.matchAll(/ (?:aria-describedby|for)="([^"]+)"/g)].flatMap((m) =>
    m[1]!.split(/\s+/),
  );
  return refs.filter((ref) => !ids.has(ref));
}

describe("crawlable SSR markup (m3-forms)", () => {
  test("a field exposes a label tied to its control and stable hooks", () => {
    const html = render(<InputField name="name" label="Full name" required />);
    expect(html).toContain('data-m3-component="InputField"');
    expect(html).toContain('data-testid="field-name"');
    expect(html).toMatch(/<label[^>]* for="([^"]+)"[^>]*>Full name/);
    expect(danglingRefs(html)).toEqual([]);
  });

  test("no aria-describedby without a description, one with it", () => {
    const bare = render(<InputField name="name" label="Name" />);
    expect(bare).not.toContain("aria-describedby");
    const described = render(<InputField name="name" label="Name" description="Public name" />);
    expect(described).toMatch(/aria-describedby="[^"]*-form-item-description"/);
    expect(danglingRefs(described)).toEqual([]);
  });

  test("select and switch fields never leave dangling references", () => {
    const html = render(
      <>
        <SelectField name="role" label="Role" options={[{ value: "user", label: "User" }]} />
        <SwitchField name="notify" label="Notify me" description="Weekly summary" />
      </>,
    );
    expect(danglingRefs(html)).toEqual([]);
    expect(html).toContain('data-m3-component="SelectField"');
    expect(html).toContain('data-testid="field-notify"');
  });

  test("composed items keep their description association, including inside wrapper elements", () => {
    const html = render(
      <FormField
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <input {...field} />
            </FormControl>
            <div>
              <FormDescription>Wrapped description</FormDescription>
            </div>
          </FormItem>
        )}
      />,
    );
    expect(html).toMatch(/aria-describedby="[^"]*-form-item-description"/);
    expect(danglingRefs(html)).toEqual([]);
  });
});
