// SPDX-License-Identifier: Apache-2.0
// MUI -> Material 3 on the Next 16 stack: the components that map one to one become Base UI wrappers
// (`@aphrody/m3-baseui`), layout and typography become elements with M3 Tailwind classes (`@aphrody/m3-tailwind`),
// and everything else is reported. The mapping data of the Lit stack (`@aphrody/m3-codemods`) stays there.
import type { CodemodResult } from "@aphrody/next-bun/codemods";
import { applyEdits, skippedSpans } from "@aphrody/next-bun/codemods/lex";
import { closingTag, findTags, stringValue, type Attr, type Tag } from "./jsx";

const unchanged = (code: string): CodemodResult => ({
  code,
  changes: [],
  warnings: [],
});

/** MUI component -> Base UI wrapper. */
const WRAPPERS: Record<string, string> = {
  Button: "M3Button",
  Switch: "M3Switch",
  Checkbox: "M3Checkbox",
  Divider: "M3Separator",
};

/** Typography variant -> element and M3 type class. */
const TYPOGRAPHY: Record<string, [string, string]> = {
  h1: ["h1", "text-display-large"],
  h2: ["h2", "text-display-medium"],
  h3: ["h3", "text-display-small"],
  h4: ["h4", "text-headline-large"],
  h5: ["h5", "text-headline-medium"],
  h6: ["h6", "text-headline-small"],
  subtitle1: ["h6", "text-title-medium"],
  subtitle2: ["h6", "text-title-small"],
  body1: ["p", "text-body-large"],
  body2: ["p", "text-body-medium"],
  caption: ["span", "text-body-small"],
  overline: ["span", "text-label-small uppercase"],
  button: ["span", "text-label-large"],
};

/** Components reported, not rewritten. */
const REPORTED = new Set([
  "TextField",
  "Select",
  "MenuItem",
  "Menu",
  "Dialog",
  "DialogTitle",
  "DialogContent",
  "DialogActions",
  "Tabs",
  "Tab",
  "Tooltip",
  "IconButton",
  "Avatar",
  "Chip",
  "Card",
  "CardContent",
  "CardActions",
  "AppBar",
  "Toolbar",
  "Drawer",
  "List",
  "ListItem",
  "Snackbar",
  "CircularProgress",
  "LinearProgress",
  "Slider",
  "Radio",
  "RadioGroup",
  "FormControlLabel",
  "Accordion",
  "Alert",
  "Badge",
]);

interface Imported {
  imported: string;
  local: string;
  /** `@mui/material` or a deep path. */
  statement: { start: number; end: number; clauseEnd: number };
}

/** The MUI imports of a file, by imported name. Deep imports (`@mui/material/Button`) count as named. */
function muiImports(src: string): {
  specs: Imported[];
  statements: { start: number; end: number; names: string[]; source: string }[];
} {
  const specs: Imported[] = [];
  const statements: {
    start: number;
    end: number;
    names: string[];
    source: string;
  }[] = [];
  const re =
    /import\s+([^'";]+?)\s+from\s+(["'])(@mui\/material(?:\/[\w/]+)?)\2\s*;?[ \t]*\n?/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const clause = m[1]!.trim();
    const start = m.index;
    const end = m.index + m[0].length;
    const source = m[3]!;
    const names: string[] = [];
    const deep = source.split("/")[2];
    const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (def && deep && !clause.startsWith("{")) {
      specs.push({
        imported: deep,
        local: def[1]!,
        statement: { start, end, clauseEnd: end },
      });
      names.push(def[1]!);
    }
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1]!.split(",")) {
        const p = part.trim();
        if (!p) continue;
        const [imported, local = imported] = p.split(/\s+as\s+/);
        specs.push({
          imported: imported!,
          local: local!,
          statement: { start, end, clauseEnd: end },
        });
        names.push(local!);
      }
    }
    statements.push({ start, end, names, source });
  }
  return { specs, statements };
}

const mergeClass = (
  attrs: Attr[],
  extra: string,
): { remove?: Attr; text: string } => {
  const existing = attrs.find((a) => a.name === "className");
  const value = stringValue(existing);
  if (existing && value !== undefined)
    return {
      remove: existing,
      text: `className="${`${extra} ${value}`.trim()}"`,
    };
  if (existing)
    return {
      remove: existing,
      text: `className={\`${extra} \${${existing.value!.replace(/^\{|\}$/g, "")}}\`}`,
    };
  return { text: `className="${extra}"` };
};

export function muiToM3(source: string): CodemodResult {
  if (!/@mui\/material/.test(source)) return unchanged(source);
  const spans = skippedSpans(source);
  const { specs, statements } = muiImports(source);
  const edits: { start: number; end: number; text: string }[] = [];
  const changes: string[] = [];
  const warnings: string[] = [];
  const wrappers = new Set<string>();
  const migrated = new Set<string>();

  const byLocal = new Map(specs.map((s) => [s.local, s]));
  const names = [...byLocal.keys()];
  const tags: Tag[] = names.length > 0 ? findTags(source, names, spans) : [];

  for (const tag of tags) {
    const spec = byLocal.get(tag.name)!;
    const kind = spec.imported;
    const close = closingTag(source, tag);
    const rename = (to: string) => {
      edits.push({ start: tag.nameStart, end: tag.nameEnd, text: to });
      if (close !== -1)
        edits.push({
          start: close + 2,
          end: close + 2 + tag.name.length,
          text: to,
        });
    };
    const drop = (attr: Attr) =>
      edits.push({
        start: attr.start - (/\s/.test(source[attr.start - 1] ?? "") ? 1 : 0),
        end: attr.end,
        text: "",
      });
    const attr = (name: string) => tag.attrs.find((a) => a.name === name);
    const withNote = (message: string) => {
      if (!warnings.includes(message)) warnings.push(message);
    };

    if (kind === "Button") {
      const variant = attr("variant");
      const value = stringValue(variant);
      const map: Record<string, string> = {
        contained: "filled",
        outlined: "outlined",
        text: "text",
      };
      if (variant) {
        if (value !== undefined && map[value] !== undefined)
          edits.push({
            start: variant.start,
            end: variant.end,
            text: `variant="${map[value]}"`,
          });
        else
          withNote(
            "Button: a dynamic `variant` is not mapped (MUI contained/outlined/text -> M3 filled/outlined/text)",
          );
      } else
        edits.push({
          start: tag.nameEnd,
          end: tag.nameEnd,
          text: ' variant="text"',
        }); // MUI's default variant is text
      const size = attr("size");
      const sizeValue = stringValue(size);
      if (size && sizeValue !== undefined) {
        const sizes: Record<string, string> = {
          small: "xs",
          medium: "sm",
          large: "md",
        };
        if (sizeValue === "medium") drop(size);
        else if (sizes[sizeValue])
          edits.push({
            start: size.start,
            end: size.end,
            text: `size="${sizes[sizeValue]}"`,
          });
      }
      const color = attr("color");
      if (color) {
        drop(color);
        withNote(
          'Button: `color` has no M3Button equivalent (the type decides the colour); use className="..." for error or custom roles',
        );
      }
      const full = attr("fullWidth");
      if (full) {
        const merged = mergeClass(tag.attrs, "w-full");
        if (merged.remove) {
          drop(full);
          edits.push({
            start: merged.remove.start,
            end: merged.remove.end,
            text: merged.text,
          });
        } else
          edits.push({ start: full.start, end: full.end, text: merged.text });
      }
      for (const name of ["startIcon", "endIcon"])
        if (attr(name))
          withNote(
            `Button: \`${name}\` is not a prop of M3Button: put the icon in the children`,
          );
      if (attr("href"))
        withNote(
          "Button: with `href`, render a link: <M3Button render={<a href=... />} nativeButton={false}>",
        );
      wrappers.add(WRAPPERS[kind]!);
      rename(WRAPPERS[kind]!);
    } else if (kind === "Switch" || kind === "Checkbox") {
      const onChange = attr("onChange");
      if (onChange) {
        edits.push({
          start: onChange.start,
          end: onChange.start + "onChange".length,
          text: "onCheckedChange",
        });
        withNote(
          `${kind}: onChange(event, checked) became onCheckedChange(checked, eventDetails): update the handler`,
        );
      }
      for (const name of ["color", "size", "sx"]) {
        const a = attr(name);
        if (a) {
          drop(a);
          if (name === "sx")
            withNote(`${kind}: \`sx\` was dropped: use className`);
        }
      }
      wrappers.add(WRAPPERS[kind]!);
      rename(WRAPPERS[kind]!);
    } else if (kind === "Divider") {
      const flex = attr("flexItem");
      if (flex) drop(flex);
      wrappers.add(WRAPPERS[kind]!);
      rename(WRAPPERS[kind]!);
    } else if (kind === "Typography") {
      const variant = attr("variant");
      const value = stringValue(variant) ?? "body1";
      const target = TYPOGRAPHY[value];
      if (!target) {
        withNote(`Typography: variant "${value}" is not mapped`);
        continue;
      }
      if (variant && stringValue(variant) !== undefined) drop(variant);
      const component = attr("component");
      const elementName = stringValue(component) ?? target[0];
      if (component) drop(component);
      const merged = mergeClass(tag.attrs, target[1]);
      if (merged.remove)
        edits.push({
          start: merged.remove.start,
          end: merged.remove.end,
          text: merged.text,
        });
      else
        edits.push({
          start: tag.nameEnd,
          end: tag.nameEnd,
          text: ` ${merged.text}`,
        });
      for (const name of ["sx", "gutterBottom", "color", "align"]) {
        const a = attr(name);
        if (a) {
          drop(a);
          withNote(
            `Typography: \`${name}\` was dropped: use Tailwind classes (mb-2, text-center, text-on-surface-variant)`,
          );
        }
      }
      rename(elementName);
    } else if (kind === "Stack") {
      const direction = stringValue(attr("direction")) ?? "column";
      const spacing = attr("spacing");
      const gap = spacing?.value && /^\{?\s*(\d+)\s*\}?$/.exec(spacing.value);
      const classes = [
        "flex",
        direction.startsWith("row") ? "flex-row" : "flex-col",
      ];
      if (gap) classes.push(`gap-${Number(gap[1]) * 2}`);
      else if (spacing)
        withNote("Stack: a dynamic `spacing` was dropped: add a gap-* class");
      for (const name of [
        "direction",
        "spacing",
        "sx",
        "alignItems",
        "justifyContent",
        "useFlexGap",
      ]) {
        const a = attr(name);
        if (a) drop(a);
      }
      const merged = mergeClass(tag.attrs, classes.join(" "));
      if (merged.remove)
        edits.push({
          start: merged.remove.start,
          end: merged.remove.end,
          text: merged.text,
        });
      else
        edits.push({
          start: tag.nameEnd,
          end: tag.nameEnd,
          text: ` ${merged.text}`,
        });
      rename("div");
    } else if (kind === "Box" || kind === "Paper") {
      const sx = attr("sx");
      if (sx) {
        drop(sx);
        withNote(
          `${kind}: \`sx\` was dropped: translate it to Tailwind classes`,
        );
      }
      for (const name of ["elevation", "variant", "square"]) {
        const a = attr(name);
        if (a) drop(a);
      }
      if (kind === "Paper") {
        const merged = mergeClass(
          tag.attrs,
          "rounded-medium bg-surface-container text-on-surface shadow-elevation-1",
        );
        if (merged.remove)
          edits.push({
            start: merged.remove.start,
            end: merged.remove.end,
            text: merged.text,
          });
        else
          edits.push({
            start: tag.nameEnd,
            end: tag.nameEnd,
            text: ` ${merged.text}`,
          });
      }
      rename("div");
    } else continue;
    migrated.add(spec.local);
    changes.push(
      `${kind} -> ${WRAPPERS[kind] ?? (kind === "Typography" ? "element with an M3 type class" : "div with M3 classes")}`,
    );
  }

  // Rewrite the imports: migrated specifiers leave, the wrappers arrive in one import.
  for (const statement of statements) {
    const remaining = specs.filter(
      (s) => s.statement.start === statement.start && !migrated.has(s.local),
    );
    const isDeep = statement.source !== "@mui/material";
    let text = "";
    if (remaining.length > 0) {
      const render = (s: Imported): string =>
        s.local === s.imported ? s.imported : `${s.imported} as ${s.local}`;
      text = isDeep
        ? `import ${remaining[0]!.local} from "${statement.source}";\n`
        : `import { ${remaining.map(render).join(", ")} } from "${statement.source}";\n`;
    }
    edits.push({ start: statement.start, end: statement.end, text });
  }
  if (wrappers.size > 0) {
    const first = statements[0]!;
    // oxlint-disable-next-line unicorn/no-array-sort -- a copy: ES2022 has no toSorted
    const importLine = `import { ${[...wrappers].sort().join(", ")} } from "@aphrody/m3-baseui";\n`;
    const e = edits.find(
      (x) => x.start === first.start && x.end === first.end,
    )!;
    e.text = importLine + e.text;
  }

  // Reported but not migrated.
  const unmigrated = specs.filter((s) => !migrated.has(s.local));
  const reported = [...new Set(unmigrated.map((s) => s.imported))].filter((n) =>
    REPORTED.has(n),
  );
  if (reported.length > 0)
    warnings.push(
      `not migrated (structure differs in Base UI; see @aphrody/m3-baseui): ${reported.join(", ")}`,
    );
  const others = [...new Set(unmigrated.map((s) => s.imported))].filter(
    (n) => !REPORTED.has(n),
  );
  if (others.length > 0) warnings.push(`left on MUI: ${others.join(", ")}`);
  if (/@mui\/icons-material/.test(source))
    warnings.push(
      "@mui/icons-material: use @aphrody/m3-icons (Material Symbols) or inline SVG",
    );
  if (/\bThemeProvider\b|\bcreateTheme\b|\bCssBaseline\b/.test(source))
    warnings.push(
      "ThemeProvider, createTheme and CssBaseline: the theme is M3Root from @aphrody/m3-next plus the m3.css sheets",
    );
  if (/\bstyled\(|@mui\/system|@mui\/styled-engine/.test(source))
    warnings.push(
      "styled() and @mui/system: use Tailwind classes or the Base UI wrappers",
    );

  if (edits.length === 0) return { code: source, changes, warnings };
  return {
    code: applyEdits(source, edits),
    changes: [...new Set(changes)],
    warnings,
  };
}
