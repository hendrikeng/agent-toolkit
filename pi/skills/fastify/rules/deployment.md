# Production Deployment

- Build the app separately from the entrypoint so tests can use `inject()` without opening a socket.
- Listen on the host required by the platform; containers commonly need `0.0.0.0`.
- On shutdown, stop accepting traffic, let bounded in-flight work finish, close Fastify, and enforce an outer termination deadline.
- Configure request, keep-alive, connection, and handler timeouts deliberately. Arbitrary values inside route `config` do not enforce a timeout.
- Trust only known proxies and build public URLs from validated configuration.
- Health endpoints should distinguish process liveness from dependency readiness without exposing secrets.
- Bound metric cardinality. Label known routes with `request.routeOptions.url` and use a fixed value such as `unknown` for unmatched requests; never use raw attacker-controlled URLs.
- Run as a non-root user, ship only production artifacts, and test shutdown and readiness behavior in the target environment.

Official references: [Server](https://fastify.dev/docs/latest/Reference/Server/), [Hooks](https://fastify.dev/docs/latest/Reference/Hooks/).
