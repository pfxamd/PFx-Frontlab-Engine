# PFx Frontlab Engine

Framework-independent browser runtime for HTML, CSS, and JavaScript experiments.

## Scope
- Assemble a document without rewriting user HTML.
- Execute in a sandboxed iframe with opaque origin and restrictive CSP.
- Distinguish build, runtime, and protocol diagnostics.
- Prevent stale preview messages from being applied after another run.
- Provide explicit lifecycle controls and optional CSS-only hot updates.

## Security
This library executes *untrusted code*. Treat the preview as hostile:
- Embed the frame with `sandbox="allow-scripts"`, **never** `allow-same-origin`.
- Do not grant the runner access to application credentials or private storage.
- Host the editor with a restrictive CSP; do not relax its CSP for previews.
- A sandbox is **not** a CPU or memory quota. Browsers can still be exhausted by malicious code.
- The default preview CSP blocks network connections, external resources, form submissions, and navigation; use a separate origin and explicit policy when remote resources are required.

## Development
```sh
npm install
npm test
npm run build
npm run typecheck
```

The engine has no UI-framework dependencies. See `docs/architecture.md` for protocol and threat-model details.
