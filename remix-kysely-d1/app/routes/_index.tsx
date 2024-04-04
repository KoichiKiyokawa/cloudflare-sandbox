import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
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

  if (request.method === "DELETE") {
    await context.db
      .deleteFrom("users")
      .where("id", "=", Number(formData.get("id")))
      .execute();
    return { ok: true };
  }

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
    <div className="container">
      <fetcher.Form method="POST" ref={formRef}>
        <input
          type="text"
          name="name"
          disabled={fetcher.state === "submitting"}
        />
        <button disabled={fetcher.state === "submitting"}>submit</button>
      </fetcher.Form>

      <div className="space-y-4">
        {users.map((user) => (
          <div key={user.id} className="border">
            <pre>{JSON.stringify(user, null, 2)}</pre>
            <Form
              method="DELETE"
              onSubmit={(e) => {
                if (!confirm("Are you sure?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={user.id ?? undefined} />
              <button className="bg-red-500 px-2 text-white rounded">
                delete
              </button>
            </Form>
          </div>
        ))}
      </div>
    </div>
  );
}
