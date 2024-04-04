import {
  vitePlugin as remix,
  cloudflareDevProxyVitePlugin as remixCloudflareDevProxy,
} from "@remix-run/dev";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { getLoadContext } from "./load-context";

export default defineConfig({
  plugins: [
    remixCloudflareDevProxy({
      // @ts-expect-error remix pluginと型が合わないが、実害はない
      getLoadContext,
    }),
    remix(),
    tsconfigPaths(),
    tailwindcss(),
  ],
});
