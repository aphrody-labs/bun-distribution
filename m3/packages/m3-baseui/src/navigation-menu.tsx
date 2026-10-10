// SPDX-License-Identifier: Apache-2.0
// Navigation menu: site navigation with flyout content.
// Parts without a visual role (Root, Portal, Trigger, handles, hooks) are Base UI's own; the rest carry the M3 classes
// of `css/navigation-menu.css`.
"use client";
import { NavigationMenu as B } from "@base-ui/react/navigation-menu";
import { part } from "./part";

export const Arrow = B.Arrow;
export const Backdrop = B.Backdrop;
export const Content = part(B.Content, "m3-bui-nav__content");
export const Icon = part(B.Icon, "m3-bui-nav__icon");
export const Item = part(B.Item, "m3-bui-nav__item");
export const Link = part(B.Link, "m3-bui-nav__link m3-bui-state");
export const List = part(B.List, "m3-bui-nav__list");
export const Popup = part(B.Popup, "m3-bui-nav__popup m3-bui-popup");
export const Portal = B.Portal;
export const Positioner = part(B.Positioner, "m3-bui-positioner");
export const Root = part(B.Root, "m3-bui-nav");
export const Trigger = part(B.Trigger, "m3-bui-nav__trigger m3-bui-state");
export const Viewport = part(B.Viewport, "m3-bui-nav__viewport");
