import { ErrorMessageList } from "../error-message-list";

type Props = {
	label: string;
	errors?: string[];
} & React.ComponentPropsWithoutRef<"input">;

export function Input({ label, errors, ...props }: Props) {
	return (
		<div>
			<label className="block">{label}</label>
			<input {...props} className="rounded w-full p-2" />
			<ErrorMessageList>{errors}</ErrorMessageList>
		</div>
	);
}
