# Decorators

- Use `decorate`, `decorateRequest`, and `decorateReply` to establish plugin-owned capabilities before routes consume them.
- Declare the initial shape synchronously. Initialize per-request object values in a hook so requests never share mutable state.
- Let encapsulation control visibility; use `fastify-plugin` only when a capability intentionally crosses the registration boundary.
- Declare plugin names and dependencies when ordering matters.
- Extend Fastify's TypeScript interfaces with module declaration merging, and keep runtime decorators aligned with those declarations.
- Check for required decorators at plugin startup and fail before listening rather than in the first request.

Official reference: [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/).
