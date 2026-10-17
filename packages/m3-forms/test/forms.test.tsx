// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type FieldErrors, useForm } from "react-hook-form";

import {
  CheckboxField,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  InputField,
  RadioGroupField,
  SelectField,
  SwitchField,
  TextAreaField,
} from "../src/index";

const SPACEUI_VOCABULARY = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

function Harness({ children, errors }: { children: ReactNode; errors?: FieldErrors }) {
  const form = useForm({
    defaultValues: {
      name: "",
      bio: "",
      role: "user",
      agree: false,
      plan: "free",
      notify: true,
    },
    errors,
  });
  return (
    <Form {...form}>
      <form>{children}</form>
    </Form>
  );
}

function render(node: ReactNode, errors?: FieldErrors): string {
  return renderToStaticMarkup(<Harness errors={errors}>{node}</Harness>);
}

function expectM3(html: string) {
  expect(html).not.toMatch(SPACEUI_VOCABULARY);
  expect(html).not.toContain("text-white");
}

const options = [
  { value: "admin", label: "Administrator" },
  { value: "user", label: "User" },
];

describe("Form anatomy", () => {
  test("label, description and message follow M3 supporting-text rules", () => {
    const html = render(
      <FormField
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>Name</FormLabel>
            <FormControl>
              <input {...field} />
            </FormControl>
            <FormDescription>Your public name</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />,
      { name: { type: "required", message: "Name is required" } },
    );
    expect(html).toContain("text-label-large");
    expect(html).toContain("text-body-small text-on-surface-variant");
    expect(html).toContain("text-error");
    expect(html).toContain("Name is required");
    expect(html).toContain(">error</span>"); // leading Material Symbols `error` glyph
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]*-form-item-description [^"]*-form-item-message"/);
    expect(html).toContain("*");
    expectM3(html);
  });

  test("no message without an error", () => {
    const html = render(
      <FormField
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />,
    );
    expect(html).not.toContain("text-error");
    expect(html).toContain('aria-invalid="false"');
  });
});

describe("fields", () => {
  test("InputField: error reaches the control and supporting text is inset 16px", () => {
    const html = render(<InputField name="name" label="Name" description="Shown on your profile" required />, {
      name: { type: "required", message: "Required" },
    });
    expect(html).toContain("border-error");
    expect(html).toContain("px-4");
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("text-error");
    expectM3(html);
  });

  test("TextAreaField renders the M3 textarea", () => {
    const html = render(<TextAreaField name="bio" label="Bio" rows={3} />);
    expect(html).toContain("<textarea");
    expect(html).toContain("text-body-large");
    expectM3(html);
  });

  test("SelectField renders its trigger", () => {
    const html = render(<SelectField name="role" label="Role" options={options} />, {
      role: { type: "required", message: "Pick one" },
    });
    expect(html).toContain("Role");
    expect(html).toContain("border-error");
    expectM3(html);
  });

  test("CheckboxField uses an inline body-large label", () => {
    const html = render(<CheckboxField name="agree" label="I agree" description="Required to continue" />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("text-body-large");
    expectM3(html);
  });

  test("RadioGroupField renders every option", () => {
    const html = render(
      <RadioGroupField
        name="plan"
        label="Plan"
        options={[
          { value: "free", label: "Free" },
          { value: "pro", label: "Pro" },
        ]}
      />,
    );
    expect(html).toContain("Free");
    expect(html).toContain("Pro");
    expect(html).toContain('role="radiogroup"');
    expectM3(html);
  });

  test("SwitchField renders a switch; disabled dims label and supporting text", () => {
    const html = render(<SwitchField name="notify" label="Notifications" description="Push alerts" disabled />);
    expect(html).toContain('role="switch"');
    expect(html).toContain("data-disabled");
    expect(html).toContain("group-data-[disabled]/field:opacity-38");
    expectM3(html);
  });
});
