import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { FormWithConfirmation } from "~/components/functional/form-with-confirmation";
import { requireCurrentUserId } from "~/features/auth/service.server";
import { throwMethodNotAllowed } from "~/utils/response.server";

export const meta: MetaFunction = () => {
  return [
    { title: "New Remix App" },
    {
      name: "description",
      content: "Welcome to Remix! Using Vite and Cloudflare!",
    },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const currentUserId = await requireCurrentUserId({ request, context });

  const postsPromise = context.db
    .selectFrom("posts")
    .selectAll()
    .orderBy("updated_at desc")
    .execute();

  return {
    posts: await postsPromise,
    currentUserId,
  };
}

const postSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export async function action({ request, context }: ActionFunctionArgs) {
  const currentUserId = await requireCurrentUserId({ request, context });
  const formData = await request.formData();

  switch (request.method) {
    case "POST": {
      const submission = parseWithZod(formData, { schema: postSchema });
      if (submission.status !== "success") return submission.reply();

      await context.db
        .insertInto("posts")
        .values({
          id: crypto.randomUUID(),
          title: submission.value.title,
          body: submission.value.body,
          user_id: currentUserId,
        })
        .execute();

      return submission.reply();
    }
    case "DELETE": {
      const submission = parseWithZod(formData, {
        schema: z.object({ id: z.string().uuid() }),
      });
      if (submission.status !== "success") return submission.reply();

      await context.db
        .deleteFrom("posts")
        .where("id", "=", submission.value.id)
        .execute();

      return submission.reply();
    }
    default:
      throwMethodNotAllowed();
  }
}

export default function Index() {
  const { posts, currentUserId } = useLoaderData<typeof loader>();

  return (
    <div className="container">
      <PostForm />

      <div className="space-y-4">
        {posts.map((post) => (
          <div key={post.id} className="border">
            <pre>{JSON.stringify(post, null, 2)}</pre>
            {post.user_id === currentUserId && (
              <FormWithConfirmation method="DELETE">
                <button
                  name="id"
                  value={post.id}
                  type="submit"
                  className="bg-red-500 px-2 text-white rounded"
                >
                  delete
                </button>
              </FormWithConfirmation>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PostForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const fetcher = useFetcher<typeof action>();

  const [form, fields] = useForm({
    lastResult: fetcher.data,
  });

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error === undefined)
      formRef.current?.reset();
  }, [fetcher.data?.error, fetcher.state]);

  return (
    <fetcher.Form method="POST" ref={formRef} id={form.id}>
      <input
        type="text"
        name="name"
        disabled={fetcher.state === "submitting"}
      />
      <button type="submit" disabled={fetcher.state === "submitting"}>
        submit
      </button>
    </fetcher.Form>
  );
}
