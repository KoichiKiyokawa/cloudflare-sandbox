export function throwBadRequest(): never {
  throw new Response("Bad Request", { status: 400 });
}

export function throwMethodNotAllowed(): never {
  throw new Response("Method Not Allowed", { status: 405 });
}
