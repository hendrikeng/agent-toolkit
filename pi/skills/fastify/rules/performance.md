# Performance

- Measure before changing architecture; Fastify is already optimized for its normal schema-and-plugin path.
- Define request and response schemas so validation and serialization compile once at startup.
- Never compile attacker-supplied schemas.
- Keep handlers non-blocking. Move CPU-heavy work off the event loop and stream large responses where appropriate.
- Bound bodies, concurrency, queues, database pools, cache entries, timeouts, and retries.
- Cache only when ownership, invalidation, privacy scope, and failure behavior are explicit.
- Keep logs and metrics low-cardinality; use route templates and fixed fallback labels, never raw URLs.
- Benchmark representative behavior with logging, schemas, hooks, and dependencies enabled.

Official references: [Benchmarking](https://fastify.dev/benchmarks/), [Validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
