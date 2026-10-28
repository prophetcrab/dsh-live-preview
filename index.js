/**
 * Live preview, Host half.
 *
 * Three routes and two tools feed the right-Sidebar preview tab:
 *   GET /live-preview/status            → capturable windows + permission state
 *   GET /live-preview/frame?window=<id> → one JPEG frame (or ?screen=1)
 *   GET /live-preview/events            → SSE stream of agent preview requests
 *
 * Window enumeration runs the bundled `bin/window-list` helper (CoreGraphics,
 * no Accessibility prompt). Frame capture shells out to `screencapture`, which
 * requires Screen Recording permission for DeepSeek Harness; without it every
 * capture fails, so the status route probes once and the frame route answers
 * 503 `permission` and lets the panel show the grant instructions.
 *
 * `preview_open` is the agent-facing entry point: it writes the requested
 * target into the stream, and the Client half opens the tab and follows it.
 *
 * @module dsh-live-preview
 */

import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'live-preview'

/** Required services: the HTTP host, the tool registry, and prompt assembly. */
export const inject = ['webServer', 'tools', 'systemPrompt']

const STATUS_PATH = '/live-preview/status'
const FRAME_PATH = '/live-preview/frame'
const EVENTS_PATH = '/live-preview/events'
const AUTH_URL_PATH = '/live-preview/auth-url'
const SELFTEST_PATH = '/live-preview/selftest'
const APP_URL_PATH = '/live-preview/app-url'
const WINDOW_LIST = fileURLToPath(new URL('./bin/window-list', import.meta.url))
const SCREENCAPTURE = '/usr/sbin/screencapture'
const TMP_PREFIX = 'dsh-live-preview-'

/** Milliseconds a captured frame is reused before another capture runs. */
const FRAME_TTL_MS = 120

/** Millisecond `screencapture` gets before it is killed. */
const CAPTURE_TIMEOUT_MS = 6000

/** The preview target the agent last requested; `mode: null` means nothing yet. */
const previewState = {
  seq: 0,
  mode: null,
  url: null,
  windowId: null,
  app: null,
  fps: null,
  updatedAt: null,
}

/** Open SSE responses. */
const eventClients = new Set()

/** Tell every connected Client about the current target. */
function broadcast() {
  const payload = `data: ${JSON.stringify(previewState)}\n\n`
  for (const res of eventClients) {
    try {
      res.write(payload)
    } catch {
      eventClients.delete(res)
    }
  }
}

/**
 * Run one helper process without throwing.
 * @param file - executable path.
 * @param args - arguments.
 * @param timeoutMs - kill deadline.
 * @returns success flag plus stdout/stderr.
 */
function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        message: error === null ? '' : String(error.message ?? error),
      })
    })
  })
}

/** Last capability probe result, so status polling does not capture every time. */
let probe = { at: 0, available: false }

/**
 * Whether this process may capture the screen.
 * @returns true when a tiny region capture succeeds.
 */
async function screenRecordingAvailable() {
  const now = Date.now()
  if (now - probe.at < 5000) return probe.available
  const file = join(tmpdir(), `${TMP_PREFIX}probe-${randomUUID()}.jpg`)
  const result = await run(SCREENCAPTURE, ['-x', '-t', 'jpg', '-R', '0,0,8,8', file], 4000)
  await rm(file, { force: true }).catch(() => {})
  probe = { at: now, available: result.ok }
  return result.ok
}

/**
 * List on-screen windows.
 * @returns window records plus the helper's error, if any.
 */
async function listWindows() {
  const result = await run(WINDOW_LIST, [], 4000)
  if (!result.ok) return { windows: [], error: result.stderr.trim() || result.message || 'window-list failed' }
  try {
    const parsed = JSON.parse(result.stdout)
    return { windows: Array.isArray(parsed) ? parsed : [], error: null }
  } catch (error) {
    return { windows: [], error: `window-list output: ${String(error?.message ?? error)}` }
  }
}

/** Captures run one at a time: a sidebar poll must not fork a dozen processes. */
let chain = Promise.resolve()

/** Last captured frame per target. */
const frames = new Map()

/**
 * Capture one target into a JPEG buffer, reusing a very recent frame.
 * @param key - cache key for the target.
 * @param args - target arguments for `screencapture`.
 * @returns the buffer, or an error string.
 */
function capture(key, args) {
  const cached = frames.get(key)
  if (cached !== undefined && Date.now() - cached.at < FRAME_TTL_MS) return Promise.resolve({ buffer: cached.buffer })
  const task = chain.then(async () => {
    const file = join(tmpdir(), `${TMP_PREFIX}${randomUUID()}.jpg`)
    const result = await run(SCREENCAPTURE, ['-x', '-t', 'jpg', ...args, file], CAPTURE_TIMEOUT_MS)
    if (!result.ok) {
      await rm(file, { force: true }).catch(() => {})
      return { error: result.stderr.trim() || result.message || 'capture failed' }
    }
    try {
      const buffer = await readFile(file)
      frames.set(key, { at: Date.now(), buffer })
      return { buffer }
    } catch (error) {
      return { error: `read frame: ${String(error?.message ?? error)}` }
    } finally {
      await rm(file, { force: true }).catch(() => {})
    }
  })
  chain = task.catch(() => {})
  return task
}

/**
 * Write one JSON response.
 * @param res - the node response.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 */
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * Resolve an app/window reference against the on-screen windows.
 * @param query - window id, app name fragment, title fragment, or "screen".
 * @returns the chosen window (id 0 = whole screen), the full list, and any error.
 */
async function resolveWindow(query) {
  const listed = await listWindows()
  const windows = listed.windows
  if (typeof query === 'number' && Number.isInteger(query) && query >= 0) {
    const match = windows.find(item => item.id === query)
    return { window: match ?? null, windows, error: listed.error }
  }
  const needle = String(query ?? '').trim().toLowerCase()
  if (needle === '' || needle === 'screen' || needle === 'fullscreen' || needle === 'whole screen') {
    return { window: { id: 0, app: 'screen', title: '' }, windows, error: null }
  }
  const match = windows.find(item => item.app.toLowerCase().includes(needle))
    ?? windows.find(item => String(item.title ?? '').toLowerCase().includes(needle))
  return { window: match ?? null, windows, error: listed.error }
}

/**
 * One line listing the capturable windows, for tool output.
 * @param windows - window records.
 * @returns human-readable list.
 */
function describeWindows(windows) {
  if (windows.length === 0) return 'no capturable windows'
  return windows.map(item => `${item.app}${item.title === '' ? '' : ` (${item.title})`}`).join(', ')
}

/** Register the routes, the two agent tools, and their prompt guidance. */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:live-preview',
    order: 2350,
    text: 'Live preview: when you build or change a web UI, open it for the user so they watch the result '
      + 'instead of reading a description: preview_open({ mode: "web", url: "http://localhost:5173" }). '
      + 'Native windows (Godot, any app) already show themselves on screen — preview one with '
      + 'preview_open({ mode: "window", window: "Godot" }) only when the user asks for it or the window '
      + 'would otherwise be hidden. preview_status lists the capturable windows.',
  })

  ctx.tools.register({
    name: 'preview_open',
    description:
      'Show a live preview in the right sidebar: an embedded web page (mode "web") or live frames of a running '
      + 'window such as a Godot game (mode "window"). Use it while developing UI so the user sees the real result. '
      + 'For window mode pass an app name fragment like "Godot" or "screen"; preview_status lists candidates.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['web', 'window'],
          description: 'Which source to preview. Defaults to web when url is given, window otherwise.',
        },
        url: {
          type: 'string',
          description: 'Web mode: the page to embed, e.g. http://localhost:5173.',
        },
        window: {
          type: 'string',
          description: 'Window mode: app name fragment ("Godot"), window title fragment, window id, or "screen".',
        },
        fps: {
          type: 'number',
          description: 'Window mode frame rate: 2, 5 (default) or 8.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args) => {
      const wanted = args?.mode === 'web' || args?.mode === 'window'
        ? args.mode
        : typeof args?.url === 'string' && args.url.trim() !== '' ? 'web' : 'window'
      if (wanted === 'web') {
        const raw = typeof args?.url === 'string' ? args.url.trim() : ''
        if (raw === '') {
          return 'preview_open: web mode needs a url, for example {"mode":"web","url":"http://localhost:5173"}'
        }
        const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
        Object.assign(previewState, {
          seq: previewState.seq + 1,
          mode: 'web',
          url,
          windowId: null,
          app: null,
          fps: null,
          updatedAt: new Date().toISOString(),
        })
        broadcast()
        return `Live preview is showing ${url} in the right sidebar.`
      }
      let query = args?.window
      if (typeof query === 'number') query = String(query)
      if (typeof query === 'string' && /^\d+$/.test(query.trim())) query = Number(query.trim())
      const resolved = await resolveWindow(query)
      if (resolved.window === null) {
        return `No window matched ${JSON.stringify(String(query ?? ''))}. Capturable windows: ${describeWindows(resolved.windows) || resolved.error || 'none'}. `
          + 'Ask the user to make the window visible on screen, or pass "screen" to preview the whole display.'
      }
      const fps = args?.fps === 2 || args?.fps === 8 ? args.fps : 5
      Object.assign(previewState, {
        seq: previewState.seq + 1,
        mode: 'window',
        url: null,
        windowId: resolved.window.id,
        app: resolved.window.app,
        fps,
        updatedAt: new Date().toISOString(),
      })
      broadcast()
      return resolved.window.id === 0
        ? `Live preview is showing the whole screen at ${fps} fps in the right sidebar.`
        : `Live preview is showing ${resolved.window.app}${resolved.window.title === '' ? '' : ` — ${resolved.window.title}`} at ${fps} fps in the right sidebar.`
    },
  })

  ctx.tools.register({
    name: 'preview_status',
    description:
      'List the windows available for live preview plus the target currently shown. Read-only; use it before '
      + 'preview_open when you do not know the app name.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async () => {
      const [listed, screenRecording] = await Promise.all([listWindows(), screenRecordingAvailable()])
      return JSON.stringify({
        preview: previewState,
        screenRecording,
        windows: listed.windows,
        error: listed.error,
      }, null, 2)
    },
  })

  ctx.inject(['webServer'], (child) => {
    // The Harness GUI itself is behind a launch-token cookie, and the desktop app
    // loads it from its own scheme (dsh-app://app) — so the request's Host header
    // says nothing about the web listener. Compare against the listener's own
    // origin instead, and hand back that origin for the "this app" shortcut.
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: AUTH_URL_PATH,
      handler: (req, res) => {
        void (async () => {
          const url = new URL(req.url ?? AUTH_URL_PATH, 'http://127.0.0.1')
          const target = url.searchParams.get('url') ?? ''
          let serverOrigin = null
          try {
            serverOrigin = child.webServer.getOrigin()
          } catch {
            serverOrigin = null
          }
          const loopback = hostname => hostname === '127.0.0.1' || hostname === 'localhost'
          let next = target
          let suggestion
          try {
            const parsed = new URL(target)
            if (serverOrigin !== null) {
              const own = new URL(serverOrigin)
              const samePort = parsed.port === own.port
              const sameHost = parsed.host === own.host
                || (loopback(parsed.hostname) && loopback(own.hostname))
              const httpish = parsed.protocol === 'http:' || parsed.protocol === 'https:'
              if (httpish && samePort && sameHost && parsed.pathname === '/') {
                const connection = ctx.get('connection')
                if (connection !== undefined && typeof connection.authenticatedUrl === 'function') {
                  next = connection.authenticatedUrl(parsed.href)
                }
              } else if (httpish && loopback(parsed.hostname)) {
                const reachable = await new Promise((resolveProbe) => {
                  const timer = setTimeout(() => resolveProbe(false), 900)
                  fetch(`${parsed.origin}/`, { method: 'HEAD', signal: AbortSignal.timeout(900) })
                    .then(() => resolveProbe(true))
                    .catch(() => resolveProbe(false))
                    .finally(() => clearTimeout(timer))
                })
                if (!reachable) suggestion = `${serverOrigin}/`
              }
            }
          } catch {
            // Not a URL: hand the original value back and let the iframe try.
          }
          const body = { url: next }
          if (suggestion !== undefined) body.suggestion = suggestion
          if (serverOrigin !== null) body.appUrl = `${serverOrigin}/`
          sendJson(res, 200, body)
        })().catch((error) => {
          if (!res.headersSent) sendJson(res, 500, { error: String(error?.message ?? error) })
        })
      },
    }), 'live-preview: auth-url route')

    // The address the desktop app's own web listener answers on; the panel uses
    // it for the "this app" shortcut because window.location.origin is the
    // dsh-app:// scheme inside Electron.
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: APP_URL_PATH,
      handler: (req, res) => {
        let origin = null
        try {
          origin = child.webServer.getOrigin()
        } catch {
          origin = null
        }
        sendJson(res, 200, { url: origin === null ? null : `${origin}/` })
      },
    }), 'live-preview: app-url route')

    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: FRAME_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        void (async () => {
          const url = new URL(req.url ?? FRAME_PATH, 'http://127.0.0.1')
          const screen = url.searchParams.get('screen') === '1'
          const windowId = Number(url.searchParams.get('window') ?? '')
          if (!screen && (!Number.isInteger(windowId) || windowId <= 0)) {
            sendJson(res, 400, { code: 'bad-target', error: 'window=<id> or screen=1 is required' })
            return
          }
          if (!(await screenRecordingAvailable())) {
            sendJson(res, 503, {
              code: 'permission',
              error: 'Screen Recording permission is not granted to DeepSeek Harness',
            })
            return
          }
          const key = screen ? 'screen' : `window:${windowId}`
          const captured = await capture(key, screen ? [] : ['-l', String(windowId)])
          if (captured.buffer === undefined) {
            sendJson(res, 503, { code: 'capture-failed', error: captured.error })
            return
          }
          res.writeHead(200, {
            'content-type': 'image/jpeg',
            'content-length': String(captured.buffer.length),
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : captured.buffer)
        })().catch((error) => {
          if (!res.headersSent) sendJson(res, 500, { error: String(error?.message ?? error) })
          else res.destroy()
        })
      },
    }), 'live-preview: frame route')

    // A tiny browser self-test: fetch the authenticated URL, load it in a
    // sandboxed iframe, and report whether the Harness GUI came up instead of
    // the "authentication required" page.
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: SELFTEST_PATH,
      handler: (req, res) => {
        const html = [
          '<!doctype html><meta charset="utf-8"><title>live-preview selftest</title>',
          '<style>body{font:14px -apple-system,system-ui;margin:24px;color:#1d1d1f}h1{font-size:18px}',
          'pre{background:#f5f5f7;padding:10px;border-radius:8px;white-space:pre-wrap;word-break:break-all}',
          'iframe{width:100%;height:520px;border:1px solid #d2d2d7;border-radius:8px;margin-top:12px}',
          '.ok{color:#1a7f37;font-weight:700}.bad{color:#c00;font-weight:700}</style>',
          '<h1>live-preview self-test</h1><div id="status">running</div><pre id="detail"></pre>',
          '<iframe id="frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>',
          '<script>',
          'var NL = String.fromCharCode(10)',
          'var status = document.getElementById("status")',
          'var detail = document.getElementById("detail")',
          'var frame = document.getElementById("frame")',
          'var target = location.origin + "/"',
          'function log(line) { detail.textContent = detail.textContent + line + NL }',
          'log("fetching auth-url for " + target)',
          'fetch("/live-preview/auth-url?url=" + encodeURIComponent(target))',
          '  .then(function (r) { return r.json() })',
          '  .then(function (body) {',
          '    log("resolved: " + body.url.replace(/token=[^&]+/, "token=<redacted>"))',
          '    var tries = 0',
          '    var timer = setInterval(function () {',
          '      tries = tries + 1',
          '      var text = ""',
          '      try { text = (frame.contentDocument.body.textContent || "") } catch (e) { text = "" }',
          '      if (/authentication required/i.test(text)) {',
          '        clearInterval(timer)',
          '        status.className = "bad"',
          '        status.textContent = "FAIL — iframe still shows the auth page"',
          '        log("iframe body: " + text.slice(0, 160))',
          '        return',
          '      }',
          '      if (text.length > 200) {',
          '        clearInterval(timer)',
          '        status.className = "ok"',
          '        status.textContent = "PASS — the GUI loaded inside the iframe"',
          '        log("iframe DOM: " + text.slice(0, 120).replace(/\s+/g, " "))',
          '        return',
          '      }',
          '      if (tries > 20) {',
          '        clearInterval(timer)',
          '        status.className = "bad"',
          '        status.textContent = "FAIL — iframe stayed empty"',
          '      }',
          '    }, 500)',
          '    frame.src = body.url',
          '  })',
          '  .catch(function (error) {',
          '    status.className = "bad"',
          '    status.textContent = "FAIL — request failed: " + error.message',
          '  })',
          '</script>',
        ].join("\n")
        const payload = Buffer.from(html, 'utf8')
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(payload.length),
          'cache-control': 'no-store',
        })
        res.end(payload)
      },
    }), 'live-preview: selftest route')

    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: EVENTS_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        res.write('retry: 3000\n\n')
        res.write(`data: ${JSON.stringify(previewState)}\n\n`)
        eventClients.add(res)
        const keepAlive = setInterval(() => {
          try {
            res.write(': ping\n\n')
          } catch {
            eventClients.delete(res)
          }
        }, 15000)
        const cleanup = () => {
          clearInterval(keepAlive)
          eventClients.delete(res)
        }
        req.on('close', cleanup)
        res.on('close', cleanup)
      },
    }), 'live-preview: events route')
  })
}
