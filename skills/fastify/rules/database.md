# Database Integration

- Own each pool in one Fastify plugin and close it in `onClose`.
- Parameterize all values. SQL placeholders do not protect identifiers, so map sortable fields, columns, and table names through fixed allowlists.
- Keep route handlers thin; put domain queries in the smallest existing repository or service boundary.
- Bound pool size, query time, retries, and result size. Do not retry non-idempotent writes blindly.
- Complete commit or rollback before sending a success response.
- Tests that rely on rollback isolation must route application queries through the same transaction-bound connection; opening an unrelated client does not isolate injected requests.
- Translate expected constraint failures without exposing SQL, hosts, credentials, or internal schema details.

Official references: [Plugins](https://fastify.dev/docs/latest/Reference/Plugins/), [Application lifecycle](https://fastify.dev/docs/latest/Reference/Hooks/#onclose).
