import {
  redirect,
  type ActionFunctionArgs,
  createCookie,
} from "@remix-run/cloudflare";
import { AuthForm, parseRequest } from "~/features/auth/components/auth-form";
import bcrypt from "bcryptjs";
import { parseWithZod } from "@conform-to/zod";
import { z } from "zod";
import { getInputProps, useForm } from "@conform-to/react";
import { Form, useActionData } from "@remix-run/react";
import { Input } from "~/features/auth/components/input";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(), // No need to validate password length here
});

export async function action({ request, context }: ActionFunctionArgs) {
  const submission = parseWithZod(await request.formData(), {
    schema: loginSchema,
  });
  if (submission.status !== "success") return submission.reply();

  const targetUser = await context.db
    .selectFrom("users")
    .selectAll()
    .where("email", "==", submission.value.email)
    .executeTakeFirst();

  if (
    !targetUser ||
    !bcrypt.compareSync(submission.value.password, targetUser.password_hash)
  )
    return submission.reply({ formErrors: ["Invalid email or password"] });

  const session = await context.kvSession.getSession(
    request.headers.get("Cookie")
  );
  session.set("userId", targetUser.id);
  throw redirect("/", {
    headers: {
      "Set-Cookie": await context.kvSession.commitSession(session),
    },
  });
}

export default function LoginForm() {
  const lastResult = useActionData<ReturnType<typeof action>>();
  const [form, fields] = useForm({
    // Sync the result of last submission
    lastResult,

    // Reuse the validation logic on the client
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: loginSchema });
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
