# Architecture and threat model

## Scope
A lightweight browser-native runtime for plain HTML, CSS, and JavaScript. No package manager or bundler is required.

## Public API
- `new FrontlabEngine(container, { debounceMs, onEvent })`
- `update({html,css,javascript}, immediate?)`
- `run()`, `stop()`, `dispose()`, `subscribe(listener)`
- `status`, `runId`

## Runtime lifecycle
`idle → starting → running → stopped → disposed`. Each full run gets a new frame, monotonic run id, and unpredictable token. Old frames are removed and messages from stale frames are ignored.

## Security
The frame is `sandbox="allow-scripts"`, without `allow-same-origin`, resulting in an opaque origin. The document includes a CSP that blocks connections and external resources by default. Messages require matching source window, current run id, token, and schema. This is defense-in-depth against cross-frame message spoofing. The parent editor must never evaluate messages as code.

### Limitations
- Inline CSP applies only after parsing the policy; the document builder inserts it at the beginning of the document head. Treat user-provided preexisting HTML CSP/meta and exotic parser cases as an area requiring further hardening.
- `sandbox` does not provide guaranteed CPU/memory limits. Infinite loops can still stall a page; separate origin/process and stronger browser-level isolation should be evaluated before accepting shared untrusted code.
- Inline user JavaScript and HTML event handlers are allowed by design within the isolated frame.
- Network remains blocked; adding remote assets requires an explicit policy design.
- CSS-only changes use `updateCSS(css)` to send a scoped message to the active preview; this preserves DOM and JavaScript state. Pending or stopped previews start a fresh run.
- User HTML document injection is text-based in this initial version. A formal parser-aware composer is a future hardening task.

## Testing
Unit tests validate document assembly and protocol shape. Browser integration tests across Chromium, Firefox, and WebKit are required before claiming security and cross-browser compatibility. Performance targets are not benchmarked yet.
