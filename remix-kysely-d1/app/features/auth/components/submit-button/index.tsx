import cx from "clsx/lite";

export function SubmitButton(props: React.ComponentPropsWithoutRef<"button">) {
	return (
		<button
			{...props}
			className={cx("bg-black text-white px-4 py-2 rounded", props.className)}
		/>
	);
}
