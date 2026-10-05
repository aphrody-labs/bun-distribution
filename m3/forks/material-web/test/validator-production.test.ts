// SPDX-License-Identifier: Apache-2.0
// Browser conditions exercise real Lit construction; the preload supplies native WebIDL coercion.
import { afterEach, describe, expect, test } from "bun:test";
import { MdOutlinedTextField } from "../textfield/outlined-text-field.js";

afterEach(() => document.body.replaceChildren());

describe("browser text field validation contract", () => {
  test("input.type coerces DOMString values and preserves the invalid-value fallback", () => {
    const input = document.createElement("input");
    Reflect.set(input, "type", undefined);
    expect(input.getAttribute("type")).toBe("undefined");
    expect(input.type).toBe("text");
    Reflect.set(input, "type", null);
    expect(input.getAttribute("type")).toBe("null");
    expect(input.type).toBe("text");
  });

  test("constructs a field and preserves required and email constraints", async () => {
    expect(customElements.get("md-outlined-text-field")).toBe(MdOutlinedTextField);
    const field = new MdOutlinedTextField();
    field.type = "email";
    field.required = true;
    document.body.append(field);
    await field.updateComplete;
    expect(field.validity.valueMissing).toBe(true);
    field.value = "not-an-email";
    expect(field.validity.typeMismatch).toBe(true);
    field.value = "reader@example.test";
    expect(field.checkValidity()).toBe(true);
    expect(field.shadowRoot!.querySelector("input")?.type).toBe("email");
  });

  test("keeps number range validation active after construction", async () => {
    const field = new MdOutlinedTextField();
    field.type = "number";
    field.min = "10";
    field.max = "20";
    document.body.append(field);
    await field.updateComplete;
    field.value = "9";
    expect(field.validity.rangeUnderflow).toBe(true);
    field.value = "21";
    expect(field.validity.rangeOverflow).toBe(true);
    field.value = "15";
    expect(field.checkValidity()).toBe(true);
  });
});
