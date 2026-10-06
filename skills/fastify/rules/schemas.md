# Validation Schemas

- Fastify 5 expects full JSON Schema for `body`, `params`, `querystring`, and `headers`.
- Prefer one runtime schema source with a type provider such as TypeBox when the repository already uses it.
- Add shared schemas with a root `$id`, then reference them with `$ref`.
- Use `additionalProperties: false` where extra input is not accepted.
- Keep Fastify's safe Ajv defaults for untrusted requests; do not enable `allErrors` globally because it can amplify denial-of-service work.
- Perform only structural validation in schemas. Database access and authorization belong in hooks or handlers.
- Schemas are application code compiled with `new Function()`; never accept user-provided schemas.
- Define response schemas for every data-bearing status to improve serialization and prevent accidental field disclosure.
- Test accepted input, rejected input, coercion, defaults, unknown fields, and response shapes.

Official reference: [Validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
