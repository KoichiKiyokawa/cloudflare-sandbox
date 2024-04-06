import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { FormWithConfirmation } from "~/components/functional/form-with-confirmation";
import {
  throwBadRequest,
  throwMethodNotAllowed,
} from "~/utils/response.server";

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

  switch (request.method) {
    case "POST": {
      const result = z
        .object({ name: z.string().min(1) })
        .safeParse(Object.fromEntries(formData));
      if (!result.success) throwBadRequest();

      await context.db
        .insertInto("users")
        .values({ name: result.data.name, id: crypto.randomUUID() })
        .execute();

      return { ok: true };
    }
    case "DELETE": {
      const result = z
        .object({ id: z.string().uuid() })
        .safeParse(Object.fromEntries(formData));
      if (!result.success) throwBadRequest();

      await context.db
        .deleteFrom("users")
        .where("id", "=", result.data.id)
        .execute();

      return { ok: true };
    }
    default:
      throwMethodNotAllowed();
  }
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
            <FormWithConfirmation method="DELETE">
              <input type="hidden" name="id" value={user.id ?? undefined} />
              <button className="bg-red-500 px-2 text-white rounded">
                delete
              </button>
            </FormWithConfirmation>
          </div>
        ))}
      </div>
    </div>
  );
}
