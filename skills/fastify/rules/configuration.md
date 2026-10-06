# Application Configuration

- Read configuration once at startup, validate it against a schema, and fail before listening when required values are absent or invalid.
- Decorate the Fastify instance with the validated, immutable configuration when routes or plugins need it.
- Keep secrets in the deployment secret store; never log them or return them in diagnostics.
- Prefer explicit settings such as `LOG_LEVEL` and `PUBLIC_ORIGIN` over behavior hidden behind `NODE_ENV`.
- Validate URLs, ports, origins, proxy addresses, timeouts, and numeric limits with useful bounds.
- Treat runtime configuration changes as a separate feature requiring an authoritative source, validation, and failure behavior.

Official references: [Server options](https://fastify.dev/docs/latest/Reference/Server/), [Plugins](https://fastify.dev/docs/latest/Reference/Plugins/).
