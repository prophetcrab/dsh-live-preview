/**
 * Live preview, browser half.
 *
 * One right-Sidebar tab type with two sources:
 *   - Web:    an iframe on any http(s) URL (dev servers, localhost).
 *   - Window: live JPEG frames from `/live-preview/frame`, refreshed on a timer,
 *             for native UI such as a running Godot game or editor.
 *
 * Frame capture needs Screen Recording permission for the desktop app; the panel
 * detects the refusal through the failed frame request and shows the grant steps.
 */
window.__ModuleLoader__.load({
  id: 'dsh-live-preview',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'live.preview'
    const TYPE_ID = 'live-preview'
    const STORAGE_KEY = 'dsh.live-preview.v1'

    const en = {
      title: 'Live preview',
      description: 'Embed a web page or watch a running window update live.',
      web: 'Web',
      thisApp: 'This app',
      openWindow: 'Open in window',
      selfTitle: 'The app cannot preview itself',
      selfBody: 'DeepSeek Harness allows a single client connection, so embedding it in its own tab stalls at "Loading plugins…". Open it in a separate window, or watch this window through capture mode.',
      selfCapture: 'Watch this window instead',
      emptyFrameTitle: 'The preview stayed empty',
      emptyFrameBody: 'An embedded app that refuses framing can be opened in its own window instead.',
      frameInfo: 'frame',
      staleTitle: 'Preview target unreachable',
      staleBody: 'The previewed port refused the connection (the app may have restarted on a new port).',
      staleUse: 'Use the current app address',
      window: 'Window',
      urlPlaceholder: 'http://localhost:5173/',
      refresh: 'Reload',
      target: 'Target',
      fullScreen: 'Whole screen',
      fps: 'Rate',
      loading: 'Watching…',
      noWindows: 'No capturable windows found.',
      permissionTitle: 'Screen Recording permission needed',
      permissionBody: 'Grant DeepSeek Harness Screen Recording in System Settings → Privacy & Security → Screen & System Audio Recording, then restart the app.',
      captureFailed: 'Capture failed',
      waitingTitle: 'Window closed',
      waitingBody: 'Waiting for this app to open a window again:',
      pickWindow: 'Pick a window',
      emptyUrl: 'Enter a URL to preview.',
    }

    const zh = {
      title: '实时预览',
      description: '嵌入网页，或实时查看正在运行的窗口画面。',
      web: '网页',
      thisApp: '本应用',
      openWindow: '新窗口打开',
      selfTitle: '本应用不能内嵌自身',
      selfBody: 'DeepSeek Harness 只接受一个客户端连接，嵌在自己的标签里会一直停在 Loading plugins。可以改成独立窗口打开，或用窗口捕获的方式在侧栏里实时看这个窗口。',
      selfCapture: '用窗口捕获看这个窗口',
      emptyFrameTitle: '画面一直是空的',
      emptyFrameBody: '有些页面不允许被内嵌，可以直接在新窗口打开。',
      frameInfo: '画面',
      staleTitle: '预览地址无法连接',
      staleBody: '预览的端口拒绝连接（应用可能重启后换了端口）。',
      staleUse: '改用当前应用地址',
      window: '窗口',
      urlPlaceholder: 'http://localhost:5173/',
      refresh: '重载',
      target: '目标',
      fullScreen: '整个屏幕',
      fps: '帧率',
      loading: '正在观看…',
      noWindows: '没有可捕获的窗口。',
      permissionTitle: '需要屏幕录制权限',
      permissionBody: '在「系统设置 → 隐私与安全性 → 屏幕与系统音频录制」中勾选 DeepSeek Harness，然后重启应用。',
      captureFailed: '抓帧失败',
      waitingTitle: '窗口已关闭',
      waitingBody: '正在等待该应用重新打开窗口：',
      pickWindow: '选择一个窗口',
      emptyUrl: '输入要预览的网址。',
    }

    const COLOR = {
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      tertiary: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l1)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      link: 'var(--dsw-alias-link)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px', padding: '10px' },
      bar: { display: 'flex', alignItems: 'center', gap: '6px', flex: 'none' },
      segmented: { display: 'flex', border: `0.5px solid ${COLOR.border}`, borderRadius: '7px', overflow: 'hidden' },
      segButton: (active) => ({
        appearance: 'none', border: 'none', cursor: 'pointer',
        background: active ? 'var(--dsw-alias-bg-layer-3)' : 'transparent',
        color: active ? COLOR.primary : COLOR.tertiary,
        fontSize: '11.5px', lineHeight: 1.2, padding: '4px 9px',
      }),
      input: {
        flex: 1, minWidth: 0, font: 'inherit', fontSize: '11.5px', lineHeight: 1.3,
        color: COLOR.primary, background: COLOR.surface,
        border: `0.5px solid ${COLOR.border}`, borderRadius: '7px', padding: '4px 8px',
      },
      select: {
        flex: 1, minWidth: 0, font: 'inherit', fontSize: '11.5px', lineHeight: 1.3,
        color: COLOR.primary, background: COLOR.surface,
        border: `0.5px solid ${COLOR.border}`, borderRadius: '7px', padding: '4px 6px',
      },
      button: {
        appearance: 'none', border: `0.5px solid ${COLOR.border}`, background: 'transparent',
        color: COLOR.primary, fontSize: '11.5px', lineHeight: 1.2, padding: '4px 8px',
        borderRadius: '7px', cursor: 'pointer', flex: 'none',
      },
      viewport: {
        position: 'relative', flex: 1, minHeight: '180px', borderRadius: '10px',
        overflow: 'hidden', border: `0.5px solid ${COLOR.border}`, background: '#fff',
      },
      frame: { display: 'block', width: '100%', height: '100%', border: 0, background: '#fff' },
      notice: {
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '6px', padding: '14px',
        background: 'var(--dsw-alias-bg-layer-1)', color: COLOR.secondary,
        fontSize: '12px', lineHeight: 1.55,
      },
      noticeTitle: { color: COLOR.error, fontSize: '12.5px', fontWeight: 500 },
      hint: { color: COLOR.tertiary, fontSize: '11.5px' },
    }

    function PreviewIcon(props) {
      const size = props && props.size ? props.size : 16
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('rect', { x: 1.5, y: 2.5, width: 13, height: 9, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M5.5 13.5h5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M8 7.2v2.6M6.7 8.5 8 9.8l1.3-1.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function readStored() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw === null ? {} : JSON.parse(raw)
      } catch {
        return {}
      }
    }

    function normalizeUrl(value) {
      const text = value.trim()
      if (text === '') return ''
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
      return `http://${text}`
    }

    function StatusNotice(props) {
      return h('div', { style: styles.notice },
        h('div', { style: styles.noticeTitle }, props.title),
        h('div', null, props.body),
        props.hint !== undefined && h('div', { style: styles.hint }, props.hint))
    }

    /**
     * Last target the agent pushed, shared between the tab opener and the body.
     * Kept outside React so one SSE message can open the tab and update an open
     * body in the same pass.
     */
    const previewStore = {
      state: null,
      listeners: new Set(),
      publish(next) {
        previewStore.state = next
        for (const listener of previewStore.listeners) {
          try {
            listener(next)
          } catch {
            // A throwing subscriber must not stop the others from updating.
          }
        }
      },
      subscribe(listener) {
        previewStore.listeners.add(listener)
        return () => { previewStore.listeners.delete(listener) }
      },
    }

    function PreviewBody(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const stored = React.useMemo(readStored, [])
      const [mode, setMode] = React.useState(stored.mode === 'window' ? 'window' : 'web')
      const [url, setUrl] = React.useState(typeof stored.url === 'string' ? stored.url : 'http://localhost:5173/')
      const [committedUrl, setCommittedUrl] = React.useState(typeof stored.url === 'string' ? stored.url : 'http://localhost:5173/')
      const [frameUrl, setFrameUrl] = React.useState('')
      const [suggestion, setSuggestion] = React.useState(null)
      const [frameInfo, setFrameInfo] = React.useState('')
      const [frameEmpty, setFrameEmpty] = React.useState(false)
      const [appUrl, setAppUrl] = React.useState('')
      const [windowId, setWindowId] = React.useState(typeof stored.windowId === 'number' ? stored.windowId : null)
      const [targetApp, setTargetApp] = React.useState(typeof stored.app === 'string' ? stored.app : null)
      const [rate, setRate] = React.useState(stored.rate === 2 || stored.rate === 8 ? stored.rate : 5)
      const [status, setStatus] = React.useState({ phase: 'loading', screenRecording: true, windows: [] })
      const [reloadKey, setReloadKey] = React.useState(0)
      const [tick, setTick] = React.useState(0)
      const [frameError, setFrameError] = React.useState(null)
      const lastError = React.useRef(0)

      React.useEffect(() => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, url, windowId, rate, app: targetApp }))
        } catch {
          // Storage may be unavailable; the panel keeps working without it.
        }
      }, [mode, url, windowId, rate, targetApp])

      const loadStatus = React.useCallback(() => {
        fetch('/live-preview/status', { cache: 'no-store', headers: { accept: 'application/json' } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
          .then((data) => {
            setStatus({
              phase: 'ready',
              screenRecording: data.screenRecording === true,
              windows: Array.isArray(data.windows) ? data.windows : [],
              error: data.error ?? null,
            })
          })
          .catch((error) => {
            setStatus(previous => ({
              ...previous,
              phase: 'error',
              error: error && error.message ? error.message : String(error),
            }))
          })
      }, [])

      React.useEffect(() => {
        loadStatus()
        const timer = window.setInterval(loadStatus, 15000)
        return () => { window.clearInterval(timer) }
      }, [loadStatus])

      // Auto-pick a window once the list arrives, so the panel is never blank.
      React.useEffect(() => {
        if (status.phase !== 'ready' || mode !== 'window') return
        if (windowId !== null) return
        if (status.windows.length > 0) {
          setWindowId(status.windows[0].id)
          setTargetApp(status.windows[0].app)
        }
      }, [status, mode, windowId])

      // Follow the same app across restarts: the captured window id dies with
      // the process, but the app name survives, so pick its new window.
      React.useEffect(() => {
        if (mode !== 'window' || status.phase !== 'ready' || targetApp === null) return
        if (windowId === 0) return
        if (windowId !== null && status.windows.some(item => item.id === windowId)) return
        const replacement = status.windows.find(item => item.app === targetApp)
        if (replacement !== undefined) {
          setWindowId(replacement.id)
          setFrameError(null)
        }
      }, [status, mode, windowId, targetApp])

      // Resolve the final URL first: the Harness GUI itself sits behind a launch
      // token, so a same-origin iframe needs the token on its first request. The
      // host returns every other URL untouched.
      React.useEffect(() => {
        let cancelled = false
        fetch('/live-preview/app-url', { cache: 'no-store' })
          .then(response => (response.ok ? response.json() : null))
          .then((body) => {
            if (cancelled || body === null || typeof body.url !== 'string') return
            setAppUrl(body.url)
          })
          .catch(() => {})
        return () => { cancelled = true }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        if (committedUrl.trim() === '') {
          setFrameUrl('')
          return () => { cancelled = true }
        }
        setSuggestion(null)
        setFrameEmpty(false)
        fetch(`/live-preview/auth-url?url=${encodeURIComponent(committedUrl)}`, { cache: 'no-store' })
          .then(response => (response.ok ? response.json() : null))
          .then((body) => {
            if (cancelled || body === null) return
            if (typeof body.url === 'string') setFrameUrl(body.url)
            setSuggestion(typeof body.suggestion === 'string' ? body.suggestion : null)
          })
          .catch(() => { if (!cancelled) setFrameUrl(committedUrl) })
        return () => { cancelled = true }
      }, [committedUrl, reloadKey])

      // Follow what the agent pushed: mode, URL, window and frame rate all move
      // without reopening the tab.
      React.useEffect(() => {
        const apply = (next) => {
          if (next === null || typeof next !== 'object') return
          if (next.mode !== 'web' && next.mode !== 'window') return
          setMode(next.mode)
          if (next.mode === 'web' && typeof next.url === 'string' && next.url !== '') {
            setUrl(next.url)
            setCommittedUrl(next.url)
          }
          if (next.mode === 'window') {
            if (typeof next.windowId === 'number') {
              setWindowId(next.windowId)
              setFrameError(null)
            }
            if (typeof next.app === 'string' && next.app !== '') setTargetApp(next.app)
            loadStatus()
          }
          if (next.fps === 2 || next.fps === 5 || next.fps === 8) setRate(next.fps)
        }
        apply(previewStore.state)
        return previewStore.subscribe(apply)
      }, [loadStatus])

      // A captured window id dies with its process; report that as "waiting",
      // not as a capture failure, and stop polling the dead id.
      const missing = mode === 'window' && status.phase === 'ready' && targetApp !== null
        && windowId !== null && windowId !== 0 && !status.windows.some(item => item.id === windowId)

      const frameOn = mode === 'window' && windowId !== null && status.screenRecording && !missing
      React.useEffect(() => {
        if (!frameOn) return undefined
        const timer = window.setInterval(() => { setTick(value => value + 1) }, Math.round(1000 / rate))
        return () => { window.clearInterval(timer) }
      }, [frameOn, rate])

      React.useEffect(() => {
        if (mode !== 'web' || frameUrl === '') return undefined
        let attempts = 0
        const timer = window.setInterval(() => {
          attempts += 1
          const node = document.querySelector('[data-live-preview-frame]')
          if (node === null) return
          try {
            const doc = node.contentDocument
            const href = node.contentWindow?.location?.href ?? ''
            const title = doc?.title ?? ''
            const bodyLength = (doc?.body?.textContent ?? '').length
            setFrameInfo(`${t('frameInfo')}: ${href.slice(0, 60)} · title=${title.slice(0, 24)} · text=${bodyLength}`)
            if (attempts >= 5 && bodyLength === 0) setFrameEmpty(true)
          } catch (error) {
            setFrameInfo(`${t('frameInfo')}: unreadable (${error instanceof Error ? error.message : String(error)})`)
          }
          if (attempts > 8) window.clearInterval(timer)
        }, 1200)
        return () => window.clearInterval(timer)
      }, [mode, frameUrl, t])

      const originOf = (value) => {
        try { return new URL(value).origin } catch { return '' }
      }
      const isSelfTarget = committedUrl.trim() !== '' && (() => {
        const target = originOf(committedUrl)
        if (target === '') return false
        return target === window.location.origin || (appUrl !== '' && target === originOf(appUrl))
      })()

      const submitUrl = () => {
        const next = normalizeUrl(url)
        setUrl(next)
        setCommittedUrl(next)
      }

      const frameSrc = windowId === 0
        ? `/live-preview/frame?screen=1&t=${tick}`
        : `/live-preview/frame?window=${windowId ?? 0}&t=${tick}`

      const toolbar = mode === 'web'
        ? [
            h('input', {
              key: 'url', style: styles.input, value: url, spellCheck: false,
              placeholder: t('urlPlaceholder'), 'aria-label': t('urlPlaceholder'),
              onChange: (event) => { setUrl(event.currentTarget.value) },
              onKeyDown: (event) => { if (event.key === 'Enter') submitUrl() },
            }),
            h('button', {
              key: 'this-app',
              type: 'button',
              style: styles.button,
              title: t('thisApp'),
              onClick: () => {
                const own = `${window.location.origin}/`
                const next = own !== 'null/' ? own : appUrl
                setUrl(next)
                setCommittedUrl(next)
              },
            }, t('thisApp')),
            h('button', { key: 'go', type: 'button', style: styles.button, onClick: submitUrl }, t('refresh')),
            h('button', {
              key: 'open',
              type: 'button',
              style: styles.button,
              title: t('openWindow'),
              onClick: () => {
                const target = frameUrl !== '' ? frameUrl : committedUrl
                if (target !== '') window.open(target, '_blank', 'noopener,noreferrer')
              },
            }, '↗'),
          ]
        : [
            h('select', {
              key: 'target', style: styles.select, value: windowId ?? '',
              'aria-label': t('target'),
              onChange: (event) => {
                const value = Number(event.currentTarget.value)
                setWindowId(Number.isFinite(value) ? value : null)
                const picked = status.windows.find(item => item.id === value)
                setTargetApp(picked === undefined ? null : picked.app)
                setFrameError(null)
              },
            },
              status.windows.length === 0
                ? h('option', { value: '' }, t('pickWindow'))
                : status.windows.map(item => h('option', { key: item.id, value: item.id },
                    `${item.app}${item.title === '' ? '' : ' — ' + item.title}`)),
              h('option', { value: 0 }, t('fullScreen')),
            ),
            h('select', {
              key: 'rate', style: { ...styles.select, flex: 'none', width: '64px' }, value: rate,
              'aria-label': t('fps'),
              onChange: (event) => { setRate(Number(event.currentTarget.value)) },
            },
              h('option', { value: 2 }, '2 fps'),
              h('option', { value: 5 }, '5 fps'),
              h('option', { value: 8 }, '8 fps'),
            ),
          ]

      // A captured window id dies with its process; report that as "waiting",
      // not as a capture failure, and stop polling the dead id.
      let notice = null
      if (mode === 'web' && committedUrl.trim() === '') {
        notice = h(StatusNotice, { title: t('title'), body: t('emptyUrl') })
      } else if (mode === 'window' && status.phase === 'ready' && !status.screenRecording) {
        notice = h(StatusNotice, { title: t('permissionTitle'), body: t('permissionBody') })
      } else if (mode === 'web' && isSelfTarget) {
        notice = h('div', { style: styles.notice },
          h('div', { style: styles.noticeTitle }, t('selfTitle')),
          h('div', null, t('selfBody')),
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: () => window.open(frameUrl !== '' ? frameUrl : committedUrl, '_blank', 'noopener,noreferrer'),
            }, t('openWindow')),
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: () => {
                setMode('window')
                const target = status.windows.find(item => (item.app ?? '').includes('DeepSeek'))
                if (target !== undefined) {
                  setWindowId(target.id)
                  setTargetApp(target.app)
                }
                loadStatus()
              },
            }, t('selfCapture')),
          ),
        )
      } else if (mode === 'web' && frameEmpty) {
        notice = h('div', { style: styles.notice },
          h('div', { style: styles.noticeTitle }, t('emptyFrameTitle')),
          h('div', null, t('emptyFrameBody')),
          h('button', {
            type: 'button',
            style: { ...styles.button, marginTop: '8px' },
            onClick: () => window.open(frameUrl !== '' ? frameUrl : committedUrl, '_blank', 'noopener,noreferrer'),
          }, t('openWindow')),
        )
      } else if (mode === 'web' && suggestion !== null) {
        notice = h('div', { style: styles.notice },
          h('div', { style: styles.noticeTitle }, t('staleTitle')),
          h('div', null, t('staleBody')),
          h('button', {
            type: 'button',
            style: { ...styles.button, marginTop: '8px' },
            onClick: () => {
              setUrl(suggestion)
              setCommittedUrl(suggestion)
              setSuggestion(null)
            },
          }, t('staleUse')),
        )
      } else if (mode === 'window' && missing) {
        notice = h(StatusNotice, { title: t('waitingTitle'), body: `${t('waitingBody')} ${targetApp ?? ''}` })
      } else if (mode === 'window' && frameError !== null) {
        notice = h(StatusNotice, { title: t('captureFailed'), body: frameError })
      }

      return h('section', { style: styles.root },
        h('div', { style: styles.bar },
          h('div', { style: styles.segmented },
            h('button', {
              type: 'button', style: styles.segButton(mode === 'web'),
              'aria-pressed': mode === 'web',
              onClick: () => { setMode('web') },
            }, t('web')),
            h('button', {
              type: 'button', style: styles.segButton(mode === 'window'),
              'aria-pressed': mode === 'window',
              onClick: () => { setMode('window'); loadStatus() },
            }, t('window')),
          ),
          ...toolbar,
        ),
        mode === 'web' && frameInfo !== '' && h('div', { style: styles.hint, title: frameInfo }, frameInfo),
        h('div', { style: styles.viewport },
          mode === 'web' && committedUrl.trim() !== '' && !isSelfTarget && h('iframe', {
            key: `${frameUrl}#${reloadKey}`,
            src: frameUrl,
            'data-live-preview-frame': '',
            style: styles.frame,
            title: t('title'),
            allow: 'clipboard-read; clipboard-write; fullscreen',
            sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals',
          }),
          mode === 'window' && frameOn && h('img', {
            src: frameSrc,
            style: { ...styles.frame, objectFit: 'contain', background: 'var(--dsw-alias-bg-layer-2)' },
            alt: t('title'),
            onError: () => {
              const now = Date.now()
              if (now - lastError.current < 2000) return
              lastError.current = now
              setFrameError(t('captureFailed'))
              loadStatus()
              fetch(frameSrc, { cache: 'no-store' })
                .then(response => response.ok ? null : response.json())
                .then(body => {
                  if (body !== null && typeof body.error === 'string' && body.error !== '') setFrameError(body.error)
                })
                .catch(() => {})
            },
            onLoad: () => { if (frameError !== null) setFrameError(null) },
          }),
          mode === 'window' && !frameOn && status.phase === 'ready' && status.screenRecording
            && h(StatusNotice, { title: t('title'), body: t('noWindows') }),
          notice,
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'live-preview: copy dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: TYPE_ID,
          multiple: false,
          title: () => t('title'),
          guide: [{
            id: 'open',
            order: 30,
            title: () => t('title'),
            description: () => t('description'),
            icon: PreviewIcon,
          }],
        }), 'live-preview: tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
          locale: NS,
        }, PreviewBody)), 'live-preview: tab body')

        // Restore the tab on load: once a target is stored, the pane should be
        // there after a refresh instead of hiding behind the sidebar's guide list.
        ctx.effect(() => {
          const stored = readStored()
          const hasTarget = stored.mode === 'window'
            ? stored.windowId !== undefined && stored.windowId !== null
            : (typeof stored.url === 'string' && stored.url !== '')
          if (!hasTarget) return () => {}
          const timer = window.setTimeout(() => {
            try {
              ctx.sidebarRight.openTab(TYPE_ID, {})
            } catch (error) {
              console.error('[live-preview] restore tab failed', error)
            }
          }, 400)
          return () => window.clearTimeout(timer)
        }, 'live-preview: restore tab')

        // The agent half: follow preview requests pushed by the Host tools and
        // bring the tab forward so the user sees the result without asking.
        ctx.effect(() => {
          if (typeof EventSource === 'undefined') return () => {}
          const source = new EventSource('/live-preview/events')
          source.onmessage = (event) => {
            let next
            try {
              next = JSON.parse(event.data)
            } catch {
              return
            }
            if (next === null || typeof next !== 'object') return
            const previous = previewStore.state
            previewStore.publish(next)
            const changed = previous === null || next.seq !== previous.seq
            if (changed && (next.mode === 'web' || next.mode === 'window')) {
              try {
                ctx.sidebarRight.openTab(TYPE_ID, {})
              } catch (error) {
                console.error('[live-preview] openTab failed', error)
              }
            }
          }
          return () => { source.close() }
        }, 'live-preview: preview events')
      },
    }
  },
})
