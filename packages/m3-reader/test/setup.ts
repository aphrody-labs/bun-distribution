// SPDX-License-Identifier: Apache-2.0
// `swiper/react` imports `react` without declaring it as a peer, so Bun's isolated linker
// cannot resolve it from inside swiper's store folder. Rewrite that import to this package's React.
import { plugin } from "bun";

const react = Bun.resolveSync("react", import.meta.dir);

plugin({
  name: "swiper-react-peer",
  setup(build) {
    build.onLoad({ filter: /\/swiper@[^/]+\/node_modules\/swiper\/swiper-react\.mjs$/ }, async args => {
      const source = await Bun.file(args.path).text();
      return {
        contents: source.replace(/from\s+(['"])react\1/g, `from ${JSON.stringify(react)}`),
        loader: "js",
      };
    });
  },
});
