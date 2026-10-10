# Separate-origin runner

This directory is a **standalone static site** for the trusted bridge page `runner.html`.

The editor must use a different web origin (scheme + hostname + port). Configure the engine:

```ts
const engine = new FrontlabEngine(previewContainer, {
  runnerUrl: 'https://YOUR-DEDICATED-PREVIEW-ORIGIN.example/runner.html',
  startupTimeoutMs: 12000,
});
```

1. Deploy `preview-host/` as a separate **static project** on a dedicated domain/subdomain with no user credentials, cookies or privileged routes. Never point it to the editor's origin.
2. On Cloudflare Pages, `_headers` can supply runner headers when `preview-host/` is the publish directory. Enforce a real `frame-ancestors` allowlist for your actual editor domain in the production HTTP CSP header. The sample intentionally omits it because no production editor URL has been finalized.
3. Enforce that only trusted preview bridge files are deployed. Do not allow untrusted code to be written into the runner document or stored on the preview origin. Verify the response security headers after deployment.
4. Configure `runnerUrl` in the editor. The engine rejects same-origin runners and non-HTTPS remote URLs (HTTP loopback is permitted for development).
5. Test all browser suites with `npm run test:browser`.

## Cross-origin message flow

`editor → trusted runner → opaque sandboxed user iframe`.

The runner starts by sending `runner-ready`. The editor verifies the runner URL's origin and `WindowProxy`, then sends `mount` with a serialized preview document and run/session identifiers using an **exact** `targetOrigin`. The runner forwards validated events from its single sandboxed inner frame; the engine validates the outer frame source and origin, run ID, and message schema.

The nested frame remains `sandbox="allow-scripts"` without `allow-same-origin`.

### Important limitations

- The remote runner does not create a separate OS process guarantee. Unbounded loops and memory exhaustion can still block the browser or tab.
- Timeout/recovery is **best effort**. Timers won't execute when the relevant event loop is blocked.
- The opaque nested frame inherits relevant CSP restrictions, but user-triggered self-navigation and CSP inheritance differences require browser-specific verification.
- These files and automated tests do **not** mean the dedicated production origin has been deployed.
- Host policies must also be enforced as response headers on the dedicated origin. A static HTTP server used by tests does not implement `_headers` automatically.
