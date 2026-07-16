# Lazy web access for Pi

Keeps `pi-web-access` tool schemas out of model requests until needed.

Pi starts each session with one compact `enable_web_access` loader. The model may call it when current information or external documentation is required; the full web tools become active on the following turn. GPT-5.4+ models use Pi's native deferred tool loading.

Manual controls:

```text
/web on
/web off
/web status
```

`/web off` leaves only the loader active. The package's browser-cookie access is disabled in the managed config, and search uses raw results without opening the curator UI.
