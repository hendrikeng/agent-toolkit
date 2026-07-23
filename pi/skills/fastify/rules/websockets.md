# WebSockets

- Register `@fastify/websocket` before WebSocket routes and keep connection policy in the same encapsulated plugin.
- Authenticate browser connections with an HttpOnly session cookie or exchange a short-lived single-use ticket; never put reusable credentials in the URL.
- Apply origin checks where the browser threat model requires them. CORS does not govern WebSocket connections.
- Bound message size, parse and validate every message, and rate-limit work per connection or identity.
- Attach message handlers synchronously when the connection opens so early messages are not dropped.
- Implement heartbeat, idle timeout, backpressure, error, and close handling.
- Remove connection state and timers on close, and close active sockets during application shutdown.
- Keep authorization per operation when a connected identity can access multiple resources.

Official reference: [@fastify/websocket](https://github.com/fastify/fastify-websocket).
