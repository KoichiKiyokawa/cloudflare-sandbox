import cx from "clsx/lite";

export function SubmitButton(props: React.ComponentPropsWithoutRef<"button">) {
	return (
		<button
			{...props}
			className={cx(
				"bg-black text-white px-4 py-2 rounded hover:opacity-50 cursor-pointer max-w-sm w-full block mx-auto",
				props.className,
			)}
		/>
	);
}
