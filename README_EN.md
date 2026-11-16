<div align="center">
  <img src="icon.svg" alt="Our Free Model standalone service" width="120">

# our-free-model-standalone

**English** | [简体中文](README.md)

</div>

> One command turns thirteen free account channels into a local OpenAI-compatible
> gateway: `npx our-free-model-standalone` (short command `ofm`). No login, no
> sign-up, no API key.

**Our Free Model** is a free-model aggregation gateway that runs on your machine:

- **One model name, `auto`**: smart scheduling relays across channel models in the
  order you pick; an exhausted model is skipped for the rest of the day and a fully
  exhausted pool answers with 429 plus per-model reset times.
- **OpenAI-compatible API**: `/v1/chat/completions`, `/v1/responses`, `/v1/messages`
  and `/v1/models`; point your existing clients at the local base URL.
- **Web console**: models, account channels, smart scheduling, usage calendar,
  request log and usage statistics, light/dark themes, loopback-only listener.
- **Zero runtime dependencies**: Node.js 22.19+/24+ is all it needs; all data stays local.

```bash
npx our-free-model-standalone        # or: npm i -g our-free-model-standalone && ofm
```

| Path | Contents |
| --- | --- |
| `packages/standalone/` | the service itself (CLI, HTTP server, management API, web UI) |
| `src/` | shared kernel (forwarding pipeline, channel abstraction, storage, token savers) |
| `vendor/` | pinned channel-pack and magpie engine assets |
| `scripts/` | build / pack / test scripts |

License: see `LICENSE` and `THIRD_PARTY_NOTICES.txt`.
