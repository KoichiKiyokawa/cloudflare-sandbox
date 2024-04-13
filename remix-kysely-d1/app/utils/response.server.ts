export function throwBadRequest(): never {
  throw new Response("Bad Request", { status: 400 });
}

export function throwMethodNotAllowed(): never {
  throw new Response("Method Not Allowed", { status: 405 });
}

export function throwInternalServerError(): never {
  throw new Response("Internal Server Error", { status: 500 });
}
