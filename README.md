# PFx Frontlab Engine

Framework-independent browser runtime for HTML, CSS, and JavaScript experiments.

## Scope
- Assemble a document without rewriting user HTML.
- Execute in a sandboxed iframe with opaque origin and restrictive CSP.
- Distinguish build, runtime, and protocol diagnostics.
- Prevent stale preview messages from being applied after another run.
- Provide explicit lifecycle controls and CSS-only live updates via `engine.updateCSS(css)`.

## Security
**Development alpha:** only self-authored snippets are appropriate until the preview is hosted on a separate isolated origin. See [Threat model](docs/threat-model.md).

This library executes *untrusted code*. Treat the preview as hostile:
- Embed the frame with `sandbox="allow-scripts"`, **never** `allow-same-origin`.
- Do not grant the runner access to application credentials or private storage.
- Host the editor with a restrictive CSP; do not relax its CSP for previews.
- A sandbox is **not** a CPU or memory quota. Browsers can still be exhausted by malicious code.
- The default preview CSP blocks script-initiated network connections, external resources, and form submissions. The iframe sandbox blocks top-level navigation; preview self-navigation and browser resource behavior require separate testing and must not be considered completely blocked. Use a separate preview origin for stronger isolation.

## Development
```sh
npm install
npm test
npm run build
npm run typecheck
```

The engine has no UI-framework dependencies. See `docs/architecture.md` for protocol and threat-model details.
