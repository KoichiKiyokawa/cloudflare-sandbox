import type { ActionFunctionArgs, LinksFunction } from "@remix-run/cloudflare";
import {
  Form,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  redirect,
  useRouteError,
} from "@remix-run/react";
import stylesheet from "./app.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export async function action({ request, context }: ActionFunctionArgs) {
  const session = await context.kvSession.getSession(
    request.headers.get("Cookie")
  );
  await context.kvSession.destroySession(session);
  throw redirect("/login");
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <header>
          <nav>
            <Form method="POST">
              <button type="submit">Logout</button>
            </Form>
          </nav>
        </header>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
