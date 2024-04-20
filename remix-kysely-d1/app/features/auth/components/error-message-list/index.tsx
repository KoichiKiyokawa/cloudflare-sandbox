import React from "react";

export function ErrorMessageList({ children }: { children?: string[] }) {
	return children === undefined || children.length === 0 ? undefined : (
		<div role="alert" className="text-red-500">
			{React.Children.map(children, (child, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
				<p key={i}>{child}</p>
			))}
		</div>
	);
}
