import {
  vitePlugin as remix,
  cloudflareDevProxyVitePlugin as remixCloudflareDevProxy,
} from "@remix-run/dev";
import { getLoadContext } from "./load-context";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    remixCloudflareDevProxy({
      // @ts-expect-error remix pluginと型が合わないが、実害はない
      getLoadContext,
    }),
    remix(),
    tsconfigPaths(),
  ],
});
