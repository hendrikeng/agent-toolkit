# CORS and Transport Security

- Use an explicit allowlist of trusted origins. Never combine reflected arbitrary origins with `credentials: true`.
- Remember that CORS is a browser read policy, not authentication or authorization.
- For cookie-authenticated writes, configure CSRF protection. Signed CSRF cookies require `@fastify/cookie` to have a validated signing secret.
- Register `@fastify/helmet` unless a documented deployment layer owns equivalent headers.
- Set request-size and rate limits at the application edge and again where sensitive routes need stricter bounds.
- Configure `trustProxy` with exact proxy addresses, CIDRs, or a verified hop count. Use `true` only when network policy prevents direct client access.
- Build redirects from a validated canonical origin, never from an untrusted `Host` or forwarded-host header.
- Validate secure-cookie behavior, proxy headers, CORS preflights, and CSRF failures in the deployed topology.

Official references: [Server `trustProxy`](https://fastify.dev/docs/latest/Reference/Server/#trustproxy), [@fastify/cors](https://github.com/fastify/fastify-cors), [@fastify/helmet](https://github.com/fastify/fastify-helmet).
