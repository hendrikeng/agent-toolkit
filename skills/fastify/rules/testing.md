# Testing

- Export an application factory that registers plugins and routes without calling `listen()`.
- Use `app.inject()` for request tests; it waits until plugins are ready and exercises Fastify without a network socket.
- Close the app after tests so pools, timers, and plugin resources are released.
- Assert status, headers, and response payloads for success and designed failure paths.
- Test validation, authentication, authorization, not-found, and unexpected-error behavior at the HTTP boundary.
- Override dependencies through plugin encapsulation or app-factory options; avoid global mutable mocks.
- For rollback isolation, ensure application queries actually use the transaction-bound connection. A separate checked-out test client cannot roll back writes made through the normal pool.
- Keep tests deterministic and avoid fixed ports unless the behavior specifically requires a real socket.

Official reference: [Testing](https://fastify.dev/docs/latest/Guides/Testing/).
