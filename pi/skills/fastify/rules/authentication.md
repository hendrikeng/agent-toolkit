# Authentication and Authorization

- Authenticate in a scoped plugin or hook and authorize each protected resource server-side.
- Prefer HttpOnly, `Secure`, `SameSite` cookies for browser sessions. For bearer tokens, require the `Authorization` header.
- Never place reusable credentials in URLs, redirects, WebSocket query strings, or logs.
- Keep authentication and authorization separate: a valid identity does not imply access to a tenant or resource.
- Use constant-time verification where applicable, rotate secrets, bound token lifetimes, and revoke sessions server-side when required.
- Apply stricter rate limits to login, token, recovery, and verification routes.
- Test missing, malformed, expired, revoked, wrong-issuer, wrong-audience, cross-tenant, and insufficient-role cases.

Official references: [Hooks](https://fastify.dev/docs/latest/Reference/Hooks/), [@fastify/jwt](https://github.com/fastify/fastify-jwt), [@fastify/session](https://github.com/fastify/session).
