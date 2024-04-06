import { Form } from "@remix-run/react";
import { forwardRef } from "react";

type Props = { message?: string } & React.ComponentPropsWithoutRef<typeof Form>;

export const FormWithConfirmation = forwardRef<HTMLFormElement, Props>(
  function FormWithConfirmation({ message, ...props }, ref) {
    return (
      <Form
        ref={ref}
        {...props}
        onSubmit={(e) => {
          props.onSubmit?.(e);
          if (!confirm(message ?? "Are you sure?")) e.preventDefault();
        }}
      />
    );
  }
);
