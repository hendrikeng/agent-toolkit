# Plugins and Encapsulation

- Treat every feature as a plugin registered with `fastify.register()`.
- Registration creates an encapsulated child context: decorators, hooks, schemas, and routes flow to descendants, not ancestors or siblings.
- Use this boundary for route groups and dependencies instead of global mutable state.
- Use `fastify-plugin` only when a decorator or hook intentionally needs to escape that boundary, or when plugin metadata is required.
- Register dependencies before consumers and use plugin names/dependencies when ordering must be explicit.
- Keep plugin options small and validated; prefer one app-owned value over speculative configuration.
- Initialize resources during registration and close them in `onClose`.
- Test important plugins through a minimal Fastify instance and `inject()`.

Official references: [Plugins](https://fastify.dev/docs/latest/Reference/Plugins/), [Plugin guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/), [Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/).
