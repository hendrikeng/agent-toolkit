# Content-Type Parsing

- Prefer Fastify's built-in JSON and text parsers. Add a parser only for media types the application actually accepts.
- Set `bodyLimit` for every buffered custom parser. Never accumulate an unbounded request stream in memory.
- Treat parser input as untrusted and return a 4xx response for malformed payloads.
- For `@fastify/multipart`, set explicit limits for bytes, files, fields, and parts.
- Choose one multipart consumption model: attached fields or `request.file()` / `request.files()` / `request.parts()`. Attached fields consume the stream.
- Stream large uploads to bounded storage and handle truncation and aborted requests.
- Reject unsupported media types instead of installing a catch-all parser unless fallback behavior is required and bounded.

Official references: [Content type parser](https://fastify.dev/docs/latest/Reference/ContentTypeParser/), [@fastify/multipart](https://github.com/fastify/fastify-multipart).
