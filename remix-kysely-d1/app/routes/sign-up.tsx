import { getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { redirect, type ActionFunctionArgs } from "@remix-run/cloudflare";
import { Form, useActionData } from "@remix-run/react";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Card } from "~/features/auth/components/card";
import { ErrorMessageList } from "~/features/auth/components/error-message-list";
import { Input } from "~/features/auth/components/input";
import { SubmitButton } from "~/features/auth/components/submit-button";

const signUpSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    passwordConfirmation: z.string().min(8),
  })
  .refine(
    ({ password, passwordConfirmation }) => password === passwordConfirmation,
    { message: "Passwords do not match", path: ["passwordConfirmation"] }
  );

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

  if (emailExists)
    return submission.reply({ formErrors: ["Some error happened"] });

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
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: signUpSchema });
    },
    shouldValidate: "onBlur",
  });

  return (
    <Card>
      <h1 className="text-lg">Sign Up</h1>
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
          {...getInputProps(fields.email, { type: "email" })}
        />
        <Input
          errors={fields.password.errors}
          label="Password"
          {...getInputProps(fields.password, { type: "password" })}
        />
        <Input
          errors={fields.passwordConfirmation.errors}
          label="Password(Confirmation)"
          {...getInputProps(fields.passwordConfirmation, { type: "password" })}
        />

        <SubmitButton>Sign Up</SubmitButton>
      </Form>
    </Card>
  );
}
