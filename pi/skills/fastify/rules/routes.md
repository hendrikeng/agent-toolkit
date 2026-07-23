# Routes and Handlers

- Group routes by feature in async plugins and register them with a prefix.
- Keep handlers focused on request orchestration; reuse existing domain services for business rules and persistence.
- Define complete JSON Schemas for params, query, headers, body, and each meaningful response status. Fastify 5 requires full JSON Schema objects.
- Return a value from async handlers or send with `reply`; do not do both.
- Set status and headers before returning the response body.
- Prefer route encapsulation or explicit hooks for authorization; never infer public access from a raw URL prefix.
- If `@fastify/autoload` maps parameter directories such as `_id`, enable its documented `routeParams` option. Otherwise define `/:id` explicitly.
- Use route constraints only when their routing and fallback behavior is tested.

Official references: [Routes](https://fastify.dev/docs/latest/Reference/Routes/), [@fastify/autoload](https://github.com/fastify/fastify-autoload).
