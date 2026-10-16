/*
 * This file exports a object which contains Different Kinds of Icons.
 */
import * as Code from "./Code";
import * as Extras from "./Extras";

// Preserve the concrete module types. An explicit React component annotation here would resolve
// through a different workspace package boundary on Bun and make otherwise identical React types
// nominally incompatible.
type LayeredIcon =
  (typeof Code)[keyof typeof Code] | (typeof Extras)[keyof typeof Extras];

export const LayeredIcons: Record<string, Record<string, LayeredIcon>> = {
  Code,
  Extras,
};
