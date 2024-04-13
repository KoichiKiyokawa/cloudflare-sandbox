import {
  createCookie,
  createWorkersKVSessionStorage,
} from "@remix-run/cloudflare";
import type { GetLoadContextFunction } from "@remix-run/cloudflare-pages";
import type { PlatformProxy } from "wrangler";
import { getDb } from "./app/lib/db";

type Cloudflare = Omit<PlatformProxy<Env>, "dispose">;

declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    cloudflare: Cloudflare;
    db: ReturnType<typeof getDb>;
    kvSession: ReturnType<typeof createWorkersKVSessionStorage<SessionData>>;
  }
}

type SessionData = {
  userId: string;
};

export const getLoadContext: GetLoadContextFunction<Env> = ({ context }) => ({
  ...context,
  db: getDb(context.cloudflare.env.DB),
  kvSession: createWorkersKVSessionStorage<SessionData>({
    kv: context.cloudflare.env.KV,
    cookie: createCookie("__session", {
      secrets: [context.cloudflare.env.SESSION_SECRET],
      sameSite: "lax",
      httpOnly: true,
      secure: context.cloudflare.env.APP_ENV === "prod",
    }),
  }),
});
