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
2. On Cloudflare Pages, the generated `dist/preview-host/_headers` configures real HTTP response headers, including `frame-ancestors` for the configured editor origin.
3. Enforce that only trusted preview bridge files are deployed. Do not allow untrusted code to be written into the runner document or stored on the preview origin. Verify the response security headers after deployment.
4. Configure `runnerUrl` in the editor after the domain is deployed and verified. The engine rejects same-origin runners and non-HTTPS remote URLs (HTTP loopback is permitted for development).
5. Test all browser suites with `npm run test:browser`.

## Cloudflare Pages production deployment

The deployment build must prepare `dist/preview-host`; **do not publish the raw `preview-host` directory**. Without the generated origin binding and `frame-ancestors` HTTP header the preview is not production-ready.

Connect the existing GitHub repository to a separate Cloudflare Pages project with:

- **Production branch:** `main`
- **Framework preset:** `None`
- **Root directory:** repository root (`/`)
- **Build command:** `npm run build:runner`
- **Build output directory:** `dist/preview-host`
- **Environment variable:** `FRONTLAB_EDITOR_ORIGIN` = the actual, exact HTTPS origin of the future editor UI, for example `https://editor.example.com` (placeholder only).

The build fails closed if `FRONTLAB_EDITOR_ORIGIN` is missing, includes a path, or uses non-HTTPS (except local test origins). The output `_headers` adds a real HTTP `frame-ancestors` restriction, and the trusted bridge only accepts parent messages originating from the configured editor.

When deployed, verify the real response (not just the GitHub source):

```sh
FRONTLAB_EDITOR_ORIGIN=https://editor.example.com \
  node scripts/verify-preview-host.mjs https://your-actual-preview-domain.example/runner.html
```

Production deployment and live header verification are **not complete** until those checks succeed against an actual deployed URL.

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
