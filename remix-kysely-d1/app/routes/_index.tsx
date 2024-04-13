import {
	FormProvider,
	getInputProps,
	getTextareaProps,
	useField,
	useForm,
} from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import type {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
} from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import { z } from "zod";
import { FormWithConfirmation } from "~/components/functional/form-with-confirmation";
import { requireCurrentUserId } from "~/features/auth/service.server";
import { throwMethodNotAllowed } from "~/utils/response.server";
import cx from "clsx/lite";
import { ErrorMessageList } from "~/features/auth/components/error-message-list";

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

const postTitleMaxLength = 100;
const postBodyMaxLength = 140;

const postSchema = z.object({
	title: z.string().max(postTitleMaxLength),
	body: z.string().max(postBodyMaxLength),
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

			return submission.reply({ resetForm: true });
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
	const fetcher = useFetcher<typeof action>();

	const [form, fields] = useForm({
		lastResult: fetcher.data,
		onValidate: ({ formData }) =>
			parseWithZod(formData, { schema: postSchema }),
		shouldValidate: "onBlur",
	});

	return (
		<FormProvider context={form.context}>
			<fetcher.Form method="POST" id={form.id}>
				<label className="block">
					<span className="block">title</span>
					<input {...getInputProps(fields.title, { type: "text" })} />
				</label>
				<InputCount name={fields.title.name} maxLength={100} />
				<ErrorMessageList>{fields.title.errors}</ErrorMessageList>

				<label className="block">
					<span className="block">body</span>
					<textarea {...getTextareaProps(fields.body)} />
				</label>
				<InputCount name={fields.body.name} maxLength={140} />
				<ErrorMessageList>{fields.body.errors}</ErrorMessageList>

				<button type="submit" disabled={fetcher.state === "submitting"}>
					submit
				</button>
			</fetcher.Form>
		</FormProvider>
	);
}

// Avoid re-rendering the entire form when the input value changes
function InputCount({ name, maxLength }: { name: string; maxLength: number }) {
	const [meta] = useField<string>(name);
	const length = meta.value?.length ?? 0;
	const isOverLimit = length > maxLength;
	return (
		<p
			role={isOverLimit ? "alert" : undefined}
			className={cx(isOverLimit && "text-red-500")}
		>
			{length} / {maxLength}
		</p>
	);
}
