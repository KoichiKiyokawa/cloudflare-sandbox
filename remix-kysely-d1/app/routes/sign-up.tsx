import { getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import {
  type ActionFunctionArgs,
  createCookie,
  redirect,
} from "@remix-run/cloudflare";
import { Form, useActionData } from "@remix-run/react";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { AuthForm, parseRequest } from "~/features/auth/components/auth-form";
import { Input } from "~/features/auth/components/input";

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function action({ request, context }: ActionFunctionArgs) {
  const submission = parseWithZod(await request.formData(), {
    schema: signUpSchema,
  });
  if (submission.status !== "success") return submission.reply();

  const emailExists = await context.db
    .selectFrom("users")
    .select("email")
    .where("email", "==", submission.value.email)
    .executeTakeFirst();

  if (emailExists) throw new Response("Internal Server Error", { status: 500 });

  const newId = crypto.randomUUID();
  await context.db
    .insertInto("users")
    .values({
      id: newId,
      name: "",
      email: submission.value.email,
      password_hash: bcrypt.hashSync(submission.value.password),
    })
    .execute();

  const session = await context.kvSession.getSession(
    request.headers.get("Cookie")
  );
  session.set("userId", newId);
  throw redirect("/", {
    headers: {
      "Set-Cookie": await context.kvSession.commitSession(session),
    },
  });
}

export default function SignUpForm() {
  const lastResult = useActionData<ReturnType<typeof action>>();
  const [form, fields] = useForm({
    // Sync the result of last submission
    lastResult,

    // Reuse the validation logic on the client
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: signUpSchema });
    },

    // Validate the form on blur event triggered
    shouldValidate: "onBlur",
  });

  return (
    <div>
      <h1>Login</h1>
      <div>{form.errors}</div>
      <Form method="POST" id={form.id} onSubmit={form.onSubmit}>
        <Input
          errors={fields.email.errors}
          label="Email"
          {...getInputProps(fields.email, { type: "email" })}
        />
        <Input
          errors={fields.password.errors}
          label="Password"
          {...getInputProps(fields.password, { type: "password" })}
        />

        <button type="submit">Submit</button>
      </Form>
    </div>
  );
}
