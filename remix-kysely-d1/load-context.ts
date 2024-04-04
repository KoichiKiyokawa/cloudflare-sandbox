import { GetLoadContextFunction } from "@remix-run/cloudflare-pages";
import { type PlatformProxy } from "wrangler";
import { getDb } from "./app/lib/db";

type Cloudflare = Omit<PlatformProxy<Env>, "dispose">;

declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    cloudflare: Cloudflare;
    db: ReturnType<typeof getDb>;
  }
}

export const getLoadContext: GetLoadContextFunction<Env> = ({ context }) => ({
  ...context,
  db: getDb(context.cloudflare.env.DB),
});
