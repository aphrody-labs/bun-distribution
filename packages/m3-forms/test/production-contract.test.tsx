// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { useForm } from "react-hook-form";
import { Form, SelectField } from "../src/index.ts";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function SampleForm() {
  const form = useForm({ defaultValues: { role: "reader" } });
  return (
    <Form {...form}>
      <SelectField
        name="role"
        label="Role"
        options={[
          { value: "reader", label: "Reader" },
          { value: "editor", label: "Editor" },
        ]}
      />
      <button type="button" onClick={() => form.reset({ role: "editor" })}>
        Reset to editor
      </button>
      <button type="button" onClick={() => form.setFocus("role")}>
        Focus role
      </button>
    </Form>
  );
}

describe("production form synchronization", () => {
  test("SelectField follows react-hook-form resets and forwards its control ref", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(<SampleForm />));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.textContent).toContain("Reader");
    const controls = [...host.querySelectorAll<HTMLButtonElement>("button")];
    flushSync(() =>
      controls
        .find((control) => control.textContent === "Reset to editor")!
        .click(),
    );
    expect(trigger.textContent).toContain("Editor");
    flushSync(() =>
      controls.find((control) => control.textContent === "Focus role")!.click(),
    );
    // react-hook-form 7.89 schedules setFocus with setTimeout.
    await Bun.sleep(10);
    expect(
      document.activeElement === host!.querySelector('[role="combobox"]'),
    ).toBe(true);
  });
});
