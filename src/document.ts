import type { FrontlabFiles } from './types.js';

export const PREVIEW_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; img-src data: blob:; font-src data:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

function safeScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}
function safeStyle(source: string): string {
  return source.replace(/<\/style/gi, '<\\/style');
}
function addToHead(html: string, additions: string): string {
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, m => m + additions);
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, m => m + '<head>' + additions + '</head>');
  return '<head>' + additions + '</head>' + html;
}
function addToBody(html: string, additions: string): string {
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, additions + '</body>');
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, additions + '</html>');
  return html + additions;
}
function bootstrap(token: string, runId: number): string {
  // Token is JSON-escaped and never interpreted as source text.
  return `(function(){
    'use strict';
    const token=${JSON.stringify(token)},runId=${runId};
    const send=(type,diagnostic)=>parent.postMessage({channel:'pfx-frontlab',token,runId,type,...(diagnostic?{diagnostic}:{})},'*');
    const stringify=(x)=>{try{return typeof x==='string'?x:JSON.stringify(x)??String(x)}catch{return String(x)}};
    for(const level of ['log','info','warn','error']){
      const old=console[level].bind(console);
      console[level]=(...args)=>{send('diagnostic',{level,kind:'console',message:args.map(stringify).join(' ')});old(...args)};
    }
    addEventListener('error',e=>send('diagnostic',{level:'error',kind:'runtime',message:String(e.message||'Script error')}));
    addEventListener('unhandledrejection',e=>send('diagnostic',{level:'error',kind:'promise',message:stringify(e.reason)}));
    send('ready');
  })();`;
}
export function buildDocument(files: FrontlabFiles, token: string, runId: number): string {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new RangeError('Invalid runId');
  const policy = '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">';
  const head = policy + '<script>' + safeScript(bootstrap(token,runId)) + '</script>' + '<style data-frontlab-css>' + safeStyle(files.css) + '</style>';
  const javascript = '<script>' + safeScript(files.javascript) + '</script>';
  // Preserve complete HTML documents as well as fragments. Never use innerHTML for execution.
  let html = files.html;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) html = html.slice(doctype[0].length);
  html = addToHead(html, head);
  html = addToBody(html, javascript);
  return (doctype?.[0] ?? '<!doctype html>') + html;
}
