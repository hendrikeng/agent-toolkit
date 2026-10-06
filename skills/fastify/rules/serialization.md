# Response Serialization

- Define response schemas by status code. They improve speed and act as an output allowlist.
- Include only fields the caller is authorized to see; serialization is not a substitute for authorization.
- Keep schema and handler values aligned for nullable fields, dates, large integers, and binary or streamed responses.
- Register shared response schemas once and reference them by `$id`.
- Treat serialization failures as server bugs: log details internally and return a generic 5xx response.
- Use `preSerialization` only for deliberate envelope transformations, not hidden business logic.
- Streams and pre-serialized payloads follow different paths; test headers, errors, and disconnect behavior explicitly.

Official reference: [Reply serialization](https://fastify.dev/docs/latest/Reference/Reply/), [Validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
