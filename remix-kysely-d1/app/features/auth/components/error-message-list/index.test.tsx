import { test, expect } from "@playwright/experimental-ct-react";
import { ErrorMessageList } from ".";

test("should render error messages", async ({ mount }) => {
	const errorMessages = ["error1", "error2"];
	const component = await mount(
		<ErrorMessageList>{errorMessages}</ErrorMessageList>,
	);

	await expect(component).toBeVisible();
	await expect(component).toHaveText("error1error2");
});

test("should render nothing when error messages are empty", async ({
	mount,
}) => {
	const errorMessages: string[] = [];
	const component = await mount(
		<ErrorMessageList>{errorMessages}</ErrorMessageList>,
	);

	expect(await component.innerText()).toBe("");
});
