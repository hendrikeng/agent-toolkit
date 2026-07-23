# Hooks and Request Lifecycle

Lifecycle order is broadly: `onRequest` → `preParsing` → `preValidation` → validation → `preHandler` → handler → `preSerialization` → `onSend` → `onResponse`.

- Register hooks inside plugins so encapsulation defines which routes they affect.
- Put authentication on a protected plugin scope or explicit route hook. Never bypass it with raw URL-prefix checks.
- Use `preValidation` only for changes that must occur before schema validation and `preHandler` for work after validation.
- Do not read a body in `onRequest`; parsing has not happened yet.
- `onResponse` runs after the response is sent. Use it for metrics and cleanup, never for transactions or work whose failure must change the response.
- Commit or roll back transactions before response serialization, in a handler/service wrapper that owns the transaction.
- Never log raw request bodies, authorization headers, cookies, or tokens. Prefer request IDs and allowlisted metadata.
- Use either async hooks or callback hooks, never both forms together.

Official reference: [Hooks](https://fastify.dev/docs/latest/Reference/Hooks/).
