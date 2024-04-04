import { LoaderFunctionArgs, json } from "@remix-run/cloudflare";

export async function loader({ context }: LoaderFunctionArgs) {
  if (process.env.NODE_ENV !== "development") throw Error("Not allowed");

  for (let i = 1; i <= 10; i++) {
    await context.db
      .insertInto("users")
      .values({
        name: `User ${i}`,
      })
      .execute();
  }

  return json({ message: "ok" });
}
