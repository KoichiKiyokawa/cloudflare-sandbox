type Props = {
  label: string;
  errors?: string[];
} & React.ComponentPropsWithoutRef<"input">;

export function Input({ label, errors, ...props }: Props) {
  return (
    <div>
      <label>{label}</label>
      <input {...props} />
      <div>{errors}</div>
    </div>
  );
}
