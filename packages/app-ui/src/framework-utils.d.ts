// SPDX-License-Identifier: Apache-2.0
// react-selecto@1.26 types its imperative methods (checkScroll, findSelectableTargets, ...) through
// `MethodInterface` from framework-utils, which it does not declare as a dependency. With the
// isolated, non-hoisted linker that import is unresolvable and the methods vanish from `Selecto`.
// This ambient module supplies the one type it needs (simplified: methods returning the vanilla
// instance keep their vanilla signature). build.ts resolves the runtime import the same way.
declare module "framework-utils" {
  export type MethodInterface<
    Methods,
    _Target extends Methods,
    _ReturnTarget,
    _Duplicate = {},
  > = {
    [K in keyof Methods]: Methods[K];
  };
}
