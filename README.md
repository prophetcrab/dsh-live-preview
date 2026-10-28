# dsh-live-preview

A right-sidebar **Live preview** for UI work in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
an embedded web page, or live frames of a running native window.

## What it adds

- **Right sidebar → Live preview** tab with two sources:
  - **Web**: an iframe on any http(s) URL (dev servers, localhost).
  - **Window**: live JPEG frames of a running window (Godot, a desktop app), 2/5/8 fps.
- **`preview_open`** and **`preview_status`** tools, so the agent opens the preview as part of normal UI work —
  the tab appears and follows the requested target without the user clicking anything.
- **`GET /live-preview/status`**, **`/live-preview/frame`**, **`/live-preview/events`** (SSE) on the Host.

## Notes

- Window capture uses `screencapture`, which needs Screen Recording permission for the app running DSH.
- The bundled `bin/window-list` helper is **macOS arm64**. Web preview works anywhere; window preview currently
  requires macOS.
- A captured window id dies with its process; the panel follows the app name and reconnects to its new window.

## Install

Add the market index `https://prophetcrab.github.io/dsh-plugins/index.json` in Settings → Plugins → Discover,
or add it manually:

```json
{
  "dependencies": {
    "dsh-live-preview": "github:prophetcrab/dsh-live-preview"
  }
}
```

Then include the bundle in `dsh.profile.bundles` (or add its `cordis.patch.yml` row to your profile patch).

## License

MIT

## Previewing the Harness GUI itself

The web GUI is served behind a launch-token cookie, so a plain iframe pointed at it returns
`dsh web authentication required`. The preview resolves its target through
`GET /live-preview/auth-url?url=...` first: when the URL is this app's own origin and root path, the
reply carries `connection.authenticatedUrl(...)` (the launch token), the iframe exchanges it for the
session cookie and the GUI loads; every other URL is returned untouched. `localhost` and `127.0.0.1`
on the same port count as the same origin.

A browser-level check for this flow lives at `GET /live-preview/selftest` — it fetches the resolved
URL, loads it in a sandboxed iframe and reports PASS/FAIL in the page.
