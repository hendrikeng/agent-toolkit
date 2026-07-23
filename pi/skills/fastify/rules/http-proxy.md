# HTTP Proxying

- Prefer `@fastify/http-proxy` for a fixed upstream and `@fastify/reply-from` when routes choose among a small trusted set.
- Never derive an unrestricted upstream URL from request input; that creates server-side request forgery risk.
- Allowlist protocols, hosts, ports, paths, and forwarded headers.
- Set connection and request timeouts, body limits, and response-size expectations.
- Decide explicitly which identity, trace, and client headers cross the boundary; strip hop-by-hop and untrusted forwarded headers.
- Preserve upstream status deliberately and map internal failures without leaking private topology.
- Treat retries as an idempotency decision, not a generic proxy default.
- Test disconnects, timeouts, oversized payloads, and unavailable upstreams.

Official references: [@fastify/http-proxy](https://github.com/fastify/fastify-http-proxy), [@fastify/reply-from](https://github.com/fastify/fastify-reply-from).
