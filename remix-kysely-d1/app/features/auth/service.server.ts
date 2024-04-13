import { redirect, type AppLoadContext } from "@remix-run/cloudflare";

export const getCurrentUserId = async ({
  request,
  context,
}: {
  request: Request;
  context: AppLoadContext;
}) => {
  const session = await context.kvSession.getSession(
    request.headers.get("Cookie")
  );
  return session.get("userId");
};

export const requireCurrentUserId = async ({
  request,
  context,
}: {
  request: Request;
  context: AppLoadContext;
}) => {
  const userId = await getCurrentUserId({ request, context });
  if (!userId) throw redirect("/login");

  return userId;
};
