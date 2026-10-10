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
- Inline CSP applies only after parsing the policy. The builder uses an HTML-aware boundary locator to skip comments, quoted attributes, and raw-text tags while placing the policy ahead of user scripts. It is not a full WHATWG HTML parser; unusual malformed markup and document navigation still require separate tests.
- `sandbox` does not provide guaranteed CPU/memory limits. Infinite loops can still stall a page; separate origin/process and stronger browser-level isolation should be evaluated before accepting shared untrusted code.
- Inline user JavaScript and HTML event handlers are allowed by design within the isolated frame.
- Fetch/XHR and configured external resource loads are blocked by the current CSP, but self-navigation by a sandboxed frame is not equivalent to a fetch and is not reliably stopped by the meta CSP.
- CSS-only changes use `updateCSS(css)` to send a scoped message to the active preview; this preserves DOM and JavaScript state. Pending or stopped previews start a fresh run.
- HTML injection is boundary-aware but not a full standards-compliant parser. For arbitrary hostile shared documents, enforce CSP headers on a dedicated preview origin.

## Testing
See [threat model](./threat-model.md) for adversarial test scope and release requirements.

Unit tests validate document assembly and protocol shape. Browser integration tests across Chromium, Firefox, and WebKit are required before claiming security and cross-browser compatibility. Performance targets are not benchmarked yet.

## Browser diagnostic differences

The sandboxed preview uses an opaque origin. In the tested Linux WebKit build, uncaught inline JavaScript errors are reported as the generic `Script error.` message even though the runtime error event is delivered. Chromium and Firefox expose the original text in the same integration test. Do not promise full exception details across browsers. This is a browser limitation with the current sandbox strategy, not a reason to relax iframe isolation.

## Performance measurements

Run `npm run benchmark` after `npm run build` to measure document-assembly median, p95, and worst-case timing for 1 KiB, 32 KiB, and 256 KiB samples. Results are printed to GitHub Actions logs on each commit. These are indicative Node timings, not preview rendering latency or proof of memory limits. Browser-level performance and stress validation require separate measurements on actual hardware.
