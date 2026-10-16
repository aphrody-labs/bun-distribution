/** Preserve literal text from legacy COPY imports without inventing missing game fields. */
export function decodeProjectionJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // COPY importers historically collapsed JSON backslashes one level too far.
  }
  let output = "";
  let quoted = false;
  let changed = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') quoted = !quoted;
    if (quoted && character === "\\") {
      const next = text[index + 1];
      const valid =
        next !== undefined &&
        ('"\\/bfnrt'.includes(next) ||
          (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))));
      if (valid) {
        output += character + next;
        index++;
        continue;
      }
      output += "\\\\";
      changed = true;
      continue;
    }
    output += character;
  }
  if (!changed) throw new Error("Invalid imported JSON projection metadata");
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Invalid imported JSON projection metadata");
  }
}
