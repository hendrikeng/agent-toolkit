# Error Handling

- Throw or return errors from handlers and hooks; do not mix promise and callback styles.
- Use one application error handler, with narrower plugin handlers only when the response contract intentionally differs.
- Map expected domain and validation failures to stable 4xx responses.
- Log unexpected errors with request context, then return a fixed generic 5xx message. Never expose raw database, upstream, filesystem, or credential-bearing error messages.
- Define error response schemas so serialization cannot leak undeclared fields.
- Keep `onError` for observation and cleanup; do not attempt a second response there.
- Include causes in internal logs where useful, but do not serialize cause chains to clients.
- Test validation, not-found, expected domain, and unexpected 5xx behavior.

Official reference: [Errors](https://fastify.dev/docs/latest/Reference/Errors/).
