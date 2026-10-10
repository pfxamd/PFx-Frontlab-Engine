import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const sourceDir = resolve('preview-host');
const outputDir = resolve('dist/preview-host');
// The deployed Frontlab editor is hosted at https://pfxamd.github.io/PFx-Frontlab/.
// An origin excludes the URL path. A valid explicit override remains supported.
export const DEFAULT_EDITOR_ORIGIN = 'https://pfxamd.github.io';
const supplied = process.env.FRONTLAB_EDITOR_ORIGIN?.trim() || DEFAULT_EDITOR_ORIGIN;

function validateOrigin(value) {
  if (!value) throw new Error('FRONTLAB_EDITOR_ORIGIN is required; refusing to build an unbound preview runner');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid FRONTLAB_EDITOR_ORIGIN URL'); }
  if (url.origin !== value || url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) {
    throw new Error('FRONTLAB_EDITOR_ORIGIN must be an HTTPS origin without path or query (HTTP loopback for tests only)');
  }
  return url.origin;
}

const editorOrigin = validateOrigin(supplied);
const original = await readFile(join(sourceDir,'runner.html'),'utf8');
const before = '<meta name="frontlab-editor-origin" content="">';
if (original.split(before).length !== 2) throw new Error('Runner origin placeholder missing or repeated');
const html = original.replace(before, '<meta name="frontlab-editor-origin" content="' + editorOrigin + '">');
const headerTemplate = await readFile(join(sourceDir,'_headers'),'utf8');
if (/\bframe-ancestors\b/.test(headerTemplate)) {
  throw new Error('Runner header template must not contain a static frame-ancestors directive');
}
const finalHeaders = headerTemplate.replace(/^(  Content-Security-Policy: [^\r\n]+)/m,
  "$1; frame-ancestors 'self' " + editorOrigin);
if (finalHeaders === headerTemplate) throw new Error('Runner CSP header not found');
if (!finalHeaders.includes("frame-ancestors 'self' " + editorOrigin)) throw new Error('Frame ancestors origin was not set');
await mkdir(outputDir,{recursive:true});
await writeFile(join(outputDir,'runner.html'),html,'utf8');
await writeFile(join(outputDir,'_headers'),finalHeaders,'utf8');
console.log('Prepared dedicated runner for editor origin:',editorOrigin);
