// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useForm, type FieldErrors, type Resolver } from "react-hook-form";
import {
  Form,
  InputField,
  TextAreaField,
  SelectField,
  CheckboxField,
  SwitchField,
} from "@aphrody/m3-forms";
import { Button } from "@aphrody/m3-primitives";
import { Card, Code, Page, Section } from "../ui.tsx";
import type { PageProps } from "./index.ts";

interface Profile {
  name: string;
  email: string;
  role: string;
  biography: string;
  consent: boolean;
  notifications: boolean;
}
const DEFAULTS: Profile = {
  name: "",
  email: "",
  role: "reader",
  biography: "",
  consent: false,
  notifications: true,
};
const validate: Resolver<Profile> = (values) => {
  const errors: FieldErrors<Profile> = {};
  if (values.name.trim().length < 2)
    errors.name = {
      type: "minLength",
      message: "Enter a name with at least two characters.",
    };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
    errors.email = { type: "pattern", message: "Enter a valid email address." };
  if (!values.consent)
    errors.consent = {
      type: "required",
      message: "Confirm this is local demonstration data.",
    };
  return Object.keys(errors).length
    ? { values: {}, errors }
    : { values, errors: {} };
};

export default function Forms({ adaptive }: PageProps) {
  const form = useForm<Profile>({
    defaultValues: DEFAULTS,
    resolver: validate,
    mode: "onBlur",
  });
  const [saved, setSaved] = useState<Profile | null>(null);
  return (
    <Page
      title="Forms"
      summary="Labelled Material 3 fields, supporting text and accessible validation built on react-hook-form. This form stores a preview in memory only."
      packages={["@aphrody/m3-forms", "@aphrody/m3-primitives"]}
      panes={adaptive.panes}
      aside={
        <Card>
          <h3 className="text-title-medium">Last valid preview</h3>
          {saved ? (
            <Code>{JSON.stringify(saved, null, 2)}</Code>
          ) : (
            <p className="mt-2 text-body-small text-on-surface-variant">
              Submit valid local sample values to preview them here.
            </p>
          )}
        </Card>
      }
    >
      <Section
        title="Local profile preview"
        description="Try submitting empty fields to see supporting error messages. Reset clears both values and errors."
      >
        <Card>
          <Form {...form}>
            <form
              noValidate
              onSubmit={form.handleSubmit((values) => setSaved(values))}
              className="flex flex-col gap-4"
            >
              <InputField
                name="name"
                label="Display name"
                placeholder="Ada"
                description="At least two characters."
                required
              />
              <InputField
                name="email"
                label="Email address"
                type="email"
                placeholder="ada@example.invalid"
                required
              />
              <SelectField
                name="role"
                label="Role"
                options={[
                  { value: "reader", label: "Reader" },
                  { value: "editor", label: "Editor" },
                  { value: "designer", label: "Designer" },
                ]}
              />
              <TextAreaField
                name="biography"
                label="About you"
                description="Optional local sample text."
              />
              <SwitchField name="notifications" label="Notifications" />
              <CheckboxField
                name="consent"
                label="These are local sample values"
                required
              />
              <div className="flex flex-wrap gap-3">
                <Button type="submit">Preview profile</Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    form.reset(DEFAULTS);
                    setSaved(null);
                  }}
                >
                  Reset form
                </Button>
              </div>
              <output className="block text-body-medium text-on-surface-variant">
                {saved
                  ? "Valid preview ready. No data was sent."
                  : "No profile has been saved."}
              </output>
            </form>
          </Form>
        </Card>
      </Section>
    </Page>
  );
}
