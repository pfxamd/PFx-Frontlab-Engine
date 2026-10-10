const target=process.argv[2];
const origin=process.env.FRONTLAB_EDITOR_ORIGIN?.trim();
if (!target || !origin) {
  console.error('Usage: FRONTLAB_EDITOR_ORIGIN=https://editor.example node scripts/verify-preview-host.mjs https://preview.example/runner.html');
  process.exit(2);
}
const expected = new URL(origin);
if (expected.origin !== origin) throw new Error('Expected exact editor origin without a path');
const url = new URL(target);
if (url.protocol !== 'https:') throw new Error('Production runner must use HTTPS');
if (url.origin === expected.origin) throw new Error('Editor and runner must not share the same origin');
const response = await fetch(url, {redirect:'error',cache:'no-store'});
if (!response.ok) throw new Error('Runner returned HTTP '+response.status);
const csp=response.headers.get('content-security-policy')||'';
const required=[
  "default-src 'none'", "connect-src 'none'", "object-src 'none'",
  "form-action 'none'", "frame-ancestors "+origin
];
for(const fragment of required) {
  if(!csp.includes(fragment)) throw new Error('Missing HTTP CSP directive: '+fragment);
}
if ((response.headers.get('x-content-type-options')||'').toLowerCase()!=='nosniff') {
  throw new Error('Missing X-Content-Type-Options: nosniff');
}
const html=await response.text();
if(!html.includes('content="'+origin+'"') || !html.includes('pfx-frontlab-bridge')) {
  throw new Error('Runner was not built for the configured editor origin');
}
console.log('Verified HTTP response headers and runner origin binding:',url.href);
