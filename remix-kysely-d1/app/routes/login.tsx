import { getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { redirect, type ActionFunctionArgs } from "@remix-run/cloudflare";
import { Form, Link, useActionData } from "@remix-run/react";
import bcrypt from "bcryptjs";
import { sql } from "kysely";
import { z } from "zod";
import { Card } from "~/features/auth/components/card";
import { ErrorMessageList } from "~/features/auth/components/error-message-list";
import { Input } from "~/features/auth/components/input";
import { SubmitButton } from "~/features/auth/components/submit-button";

const getClientIp = (request: Request) => {
	return request.headers.get("CF-Connecting-IP") ?? "127.0.0.1";
};

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string(), // No need to validate password length here
	shouldRemember: z.boolean().optional(),
});

const MAX_ALLOWED_FAILED_COUNT_IN_SOME_MINUTES = 4;

export async function action({ request, context }: ActionFunctionArgs) {
	const submission = parseWithZod(await request.formData(), {
		schema: loginSchema,
	});
	if (submission.status !== "success") return submission.reply();

	const respondTooManyFailedAttempts = () =>
		submission.reply({
			formErrors: ["Too many failed login attempts. Please try again later."],
		});
	const fakeError = () =>
		submission.reply({ formErrors: ["Invalid email or password"] });

	const ip = getClientIp(request);

	const { failedCount: failedCountByIp } = await context.db
		.selectFrom("login_failed")
		.select(({ fn }) => fn.countAll<number>().as("failedCount"))
		.where("ip_or_email", "==", ip)
		.where("failed_at", ">", sql<string>`DATETIME('now', '-5 minutes')`)
		.executeTakeFirstOrThrow();

	if (failedCountByIp > MAX_ALLOWED_FAILED_COUNT_IN_SOME_MINUTES)
		return respondTooManyFailedAttempts();

	const targetUser = await context.db
		.selectFrom("users")
		.selectAll()
		.where("email", "==", submission.value.email)
		.executeTakeFirst();

	if (!targetUser) {
		await context.db
			.insertInto("login_failed")
			.values({ ip_or_email: ip })
			.executeTakeFirstOrThrow();

		return failedCountByIp === MAX_ALLOWED_FAILED_COUNT_IN_SOME_MINUTES
			? respondTooManyFailedAttempts()
			: fakeError();
	}

	const { failedCount: failedCountByEmail } = await context.db
		.selectFrom("login_failed")
		.select(({ fn }) => fn.countAll<number>().as("failedCount"))
		.where("ip_or_email", "==", submission.value.email)
		.where("failed_at", ">", sql<string>`DATETIME('now', '-5 minutes')`)
		.executeTakeFirstOrThrow();

	if (failedCountByEmail > MAX_ALLOWED_FAILED_COUNT_IN_SOME_MINUTES)
		return respondTooManyFailedAttempts();

	if (
		!bcrypt.compareSync(submission.value.password, targetUser.password_hash)
	) {
		await context.db
			.insertInto("login_failed")
			.values({ ip_or_email: submission.value.email })
			.executeTakeFirstOrThrow();

		return failedCountByEmail === MAX_ALLOWED_FAILED_COUNT_IN_SOME_MINUTES
			? respondTooManyFailedAttempts()
			: fakeError();
	}

	const session = await context.kvSession.getSession(
		request.headers.get("Cookie"),
	);
	session.set("userId", targetUser.id);
	throw redirect("/", {
		headers: {
			"Set-Cookie": await context.kvSession.commitSession(session, {
				maxAge: submission.value.shouldRemember
					? /* 30 days */ 86400 * 30
					: /* 1 day */ 86400,
			}),
		},
	});
}

export default function LoginForm() {
	const lastResult = useActionData<ReturnType<typeof action>>();
	const [form, fields] = useForm({
		lastResult,
		onValidate: ({ formData }) =>
			parseWithZod(formData, { schema: loginSchema }),
		shouldValidate: "onBlur",
	});

	return (
		<Card>
			<h1 className="text-xl">Login</h1>
			<ErrorMessageList>{form.errors}</ErrorMessageList>
			<Form
				method="POST"
				id={form.id}
				onSubmit={form.onSubmit}
				className="space-y-4"
			>
				<Input
					errors={fields.email.errors}
					label="Email"
					placeholder="example@example.com"
					{...getInputProps(fields.email, { type: "email" })}
				/>
				<Input
					errors={fields.password.errors}
					label="Password"
					{...getInputProps(fields.password, { type: "password" })}
				/>

				<label className="flex items-center">
					<input
						className="mr-2"
						{...getInputProps(fields.shouldRemember, { type: "checkbox" })}
					/>
					Remember me
				</label>

				<SubmitButton>Login</SubmitButton>
			</Form>

			<p>
				Still don't have an account?
				<Link to="/sign-up" className="text-blue-500 underline ml-2">
					Sign Up
				</Link>
			</p>
		</Card>
	);
}
