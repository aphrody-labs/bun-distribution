// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Typography.tsx), MIT, rebuilt on Material Design 3.

import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from "react";

import { tw } from "./utils";

// M3 section header: title-small on on-surface-variant.
const CategoryHeadingImpl = tw.h3`text-title-small text-on-surface-variant`;

export const CategoryHeading = CategoryHeadingImpl as unknown as ForwardRefExoticComponent<
  HTMLAttributes<HTMLHeadingElement> & RefAttributes<HTMLHeadingElement>
>;

// M3 screen title: headline-small on on-surface.
const ScreenHeadingImpl = tw.h3`text-headline-small text-on-surface`;

export const ScreenHeading = ScreenHeadingImpl as unknown as ForwardRefExoticComponent<
  HTMLAttributes<HTMLHeadingElement> & RefAttributes<HTMLHeadingElement>
>;
