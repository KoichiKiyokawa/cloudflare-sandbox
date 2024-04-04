import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef } from "react";

export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    {
      name: "description",
      content: "Welcome to Remix! Using Vite and Cloudflare!",
    },
  ];
};

export async function loader({ context }: LoaderFunctionArgs) {
  try {
    const usersPromise = context.db
      .selectFrom("users")
      .selectAll()
      .orderBy("updated_at desc")
      .execute();
    return {
      users: await usersPromise,
    };
  } catch (e) {
    console.error(e);
    return {
      users: [],
    };
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  await context.db
    .insertInto("users")
    .values({ name: String(formData.get("name") ?? badRequest()) })
    .execute();

  return { ok: true };
}

function badRequest(): never {
  throw new Response("Bad Request", { status: 400 });
}

export default function Index() {
  const formRef = useRef<HTMLFormElement>(null);
  const { users } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      formRef.current?.reset();
    }
  }, [fetcher.data?.ok, fetcher.state]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <fetcher.Form method="POST" ref={formRef}>
        <input type="text" name="name" />
        <button>submit</button>
      </fetcher.Form>

      <pre>{JSON.stringify(users, null, 2)}</pre>
    </div>
  );
}
