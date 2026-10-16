// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Layout.tsx), MIT, rebuilt on Material Design 3.

import type {
  ForwardRefExoticComponent,
  HTMLAttributes,
  RefAttributes,
} from "react";

import { tw } from "./utils";

// A small M3 outlined card for lists and grids (corner `small`).
const CardImpl = tw.div`flex px-4 py-2 text-body-medium text-on-surface rounded-small border border-outline-variant bg-surface`;

export const Card = CardImpl as unknown as ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>
>;

const GridLayoutImpl = tw.div`grid grid-cols-2 gap-3 expanded:grid-cols-3`;

export const GridLayout =
  GridLayoutImpl as unknown as ForwardRefExoticComponent<
    HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>
  >;
