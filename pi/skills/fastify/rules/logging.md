# Logging with Pino

- Use Fastify's logger and `request.log` so request IDs and child context are preserved.
- Log structured fields, not interpolated prose.
- Configure redaction for authorization headers, cookies, tokens, passwords, and application-specific secrets.
- Do not log raw request or response bodies by default.
- Pass errors as `err` so Pino's error serializer retains useful stack and cause information.
- Keep high-cardinality user input out of logger bindings and metric labels.
- Send production logs to stdout or a dedicated transport outside the request process; avoid synchronous pretty printing in production.
- Define who owns duplicate request-completion and error logs before adding hooks.

Official reference: [Logging](https://fastify.dev/docs/latest/Reference/Logging/).
