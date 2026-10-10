# Threat model and release gates

## Trust boundary

Host UI and its local data are trusted. Preview HTML, CSS, and JavaScript are **untrusted**, even when copied from third parties. A sandboxed iframe provides a distinct opaque origin (`sandbox="allow-scripts"`, without `allow-same-origin`). The main window validates the iframe window, opaque event origin, schema, current run ID, and a correlation token.

The correlation token **is not a security authentication secret**: executable preview code can inspect its own bootstrapping source or send forged events. Never treat runtime logs, preview status messages, or console output as authoritative or privileged. The host must not execute preview messages as code, use them as DOM HTML, or connect them to privileged APIs.

## Risks and default controls

| Risk | Current control | Residual risk |
| --- | --- | --- |
| Access to host DOM/storage/cookies | Opaque sandbox origin | Errors or browser bugs still possible; test browser updates |
| Top-level navigation/popup attempts | iframe sandbox disallows them | May vary by browser and activation, keep regression tests |
| XHR/fetch/worker/form/network assets | Meta CSP and iframe sandbox | Navigation of the preview itself is **not blocked by CSP connect-src** |
| Console/error storms | 200 forwarded events; 200 bootstrapped logs per run | User code may bypass interception or exhaust CPU |
| Infinite loops/heap growth | None; code runs in browser renderer | **No guaranteed preemption or memory quota**, can freeze a tab |
| Same-frame hostile messages | Validated protocol and run IDs | Preview code can still forge messages from its own frame |
| Malformed HTML boundary tricks | Conservative document boundary locator | Not a standards-compliant HTML parser |
| User-content navigation away from srcdoc | Sandbox flags persist | Inline CSP may no longer apply to the destination document |

## Required before shared, remote, or unknown snippets

1. Serve previews on a separate origin with no application cookies, credentials, or storage privileges; never embed sensitive information in preview URLs.
2. Apply navigation, resource and permission policies via HTTP response headers on that origin; do not rely on an injected meta CSP after self-navigation.
3. Isolate resource-heavy executions in a replaceable browser process/context if hard cancellation and resource recovery are required. `postMessage` heartbeats and `setTimeout` cannot guarantee cancellation of a synchronous infinite loop sharing a blocked main thread.
4. Keep a conservative default of **no remote packages/assets** until network permissions are explicitly modeled.

## Test categories

- `npm test`: deterministic unit/contract tests
- `npm run test:browser`: real browser integration and bounded adversity across Chromium, Firefox and WebKit
- `npm run benchmark`: document assembly only (not end-to-end or security proof)
- Never put true infinite loops or unbounded memory allocation in routine shared CI runners.

## Release status

Development-only engine, version 0.3.0-alpha.0. Passing bounded stress tests is **not** certification that hostile code is safe. Do not label a stable release until the separate-origin hosting boundary is implemented and verified.

## Current cross-origin milestone

An opt-in cross-origin runner adapter and bounded startup watchdog are implemented. The runner has not been deployed to a verified production origin. Dedicated origin deployment, actual HTTP CSP `frame-ancestors` and response-header verification remain release gates. A watchdog cannot forcibly preempt a blocked browser renderer.
