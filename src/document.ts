import type { FrontlabFiles } from './types.js';

export const PREVIEW_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; img-src data: blob:; font-src data:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

function safeScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}
function safeStyle(source: string): string {
  return source.replace(/<\/style/gi, '<\\/style');
}

type Tag = { name: string; closing: boolean; start: number; end: number; templateDepth: number };
const rawTextTags = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);

/**
 * Locate actual markup boundaries without treating comments, quoted attributes,
 * or raw-text elements as tags. This is a constrained locator, not an HTML parser.
 */
function scanTags(source: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;
  let templateDepth = 0;
  while (i < source.length) {
    const start = source.indexOf('<', i);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      i = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', start) || source.startsWith('<?', start)) {
      const end = source.indexOf('>', start + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    let cursor = start + 1;
    const closing = source[cursor] === '/';
    if (closing) cursor++;
    if (!/[A-Za-z]/.test(source[cursor] ?? '')) {
      i = start + 1;
      continue;
    }
    const nameStart = cursor;
    while (/[A-Za-z0-9:-]/.test(source[cursor] ?? '')) cursor++;
    const name = source.slice(nameStart, cursor).toLowerCase();
    if (!/[\s/>]/.test(source[cursor] ?? '')) {
      i = cursor;
      continue;
    }
    let quote: string | null = null;
    while (cursor < source.length) {
      const char = source[cursor];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        cursor++;
        break;
      }
      cursor++;
    }
    if (quote || source[cursor - 1] !== '>') break;
    if (closing && name === 'template') templateDepth = Math.max(0, templateDepth - 1);
    tags.push({ name, closing, start, end: cursor, templateDepth });
    if (!closing && name === 'template') templateDepth++;
    i = cursor;

    if (!closing && rawTextTags.has(name)) {
      const expression = new RegExp('</' + name + '(?=[\\s>])', 'gi');
      expression.lastIndex = i;
      const match = expression.exec(source);
      if (!match) {
        i = source.length;
      } else {
        // The next scan sees the closing tag, but skips apparent tags in raw text.
        i = match.index;
      }
    }
  }
  return tags;
}

function bootstrap(token: string, runId: number): string {
  return `(function(){
    'use strict';
    const token=${JSON.stringify(token)},runId=${runId};
    // Cap ordinary diagnostics at their source so console storms don't flood the host.
    // Malicious code in the same realm can still call parent.postMessage directly.
    let sentDiagnostics=0;
    const maxDiagnostics=200,maxMessageLength=16384;
    const send=(type,diagnostic)=>{
      if(diagnostic){
        if(sentDiagnostics>=maxDiagnostics) return;
        sentDiagnostics++;
        diagnostic={...diagnostic,message:String(diagnostic.message).slice(0,maxMessageLength)};
      }
      parent.postMessage({channel:'pfx-frontlab',token,runId,type,...(diagnostic?{diagnostic}:{})},'*');
    };
    const stringify=(x)=>{try{return typeof x==='string'?x:JSON.stringify(x)??String(x)}catch{return String(x)}};
    for(const level of ['log','info','warn','error']){
      const old=console[level].bind(console);
      console[level]=(...args)=>{
        if(sentDiagnostics<maxDiagnostics){
          send('diagnostic',{level,kind:'console',message:args.map(stringify).join(' ')});
          old(...args);
        }
      };
    }
    addEventListener('error',e=>send('diagnostic',{level:'error',kind:'runtime',message:String(e.message||'Script error')}));
    addEventListener('unhandledrejection',e=>send('diagnostic',{level:'error',kind:'promise',message:stringify(e.reason)}));
    addEventListener('message',event=>{
      const d=event.data;
      if(event.source!==parent || !d || d.channel!=='pfx-frontlab' ||
         d.type!=='css-patch' || d.token!==token || d.runId!==runId ||
         typeof d.css!=='string') return;
      const style=document.querySelector('style[data-frontlab-css]');
      if(style){style.textContent=d.css;send('css-updated');}
    });
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',()=>send('ready'),{once:true});
    }else{
      send('ready');
    }
  })();`;
}

export function buildDocument(files: FrontlabFiles, token: string, runId: number): string {
  if (!Number.isSafeInteger(runId) || runId < 1) throw new RangeError('Invalid runId');
  const policy = '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">';
  const headContent = policy + '<script>' + safeScript(bootstrap(token, runId)) +
    '</script><style data-frontlab-css>' + safeStyle(files.css) + '</style>';
  const javascript = '<script>' + safeScript(files.javascript) + '</script>';

  let html = files.html;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) html = html.slice(doctype[0].length);
  const tags = scanTags(html);
  const first = tags.find(tag => !tag.closing && tag.templateDepth === 0);
  const afterHtml = first?.name === 'html' ? tags.find(tag => tag.start >= first.end && tag.templateDepth === 0) : undefined;
  let headAt: number;
  let headMarkup: string;
  if (first?.name === 'head') {
    headAt = first.end;
    headMarkup = headContent;
  } else if (first?.name === 'html' && afterHtml?.name === 'head' && !afterHtml.closing) {
    headAt = afterHtml.end;
    headMarkup = headContent;
  } else if (first?.name === 'html') {
    headAt = first.end;
    headMarkup = '<head>' + headContent + '</head>';
  } else {
    // Always put CSP before the first user-supplied executable element.
    headAt = 0;
    headMarkup = '<head>' + headContent + '</head>';
  }

  const bodyEnd = [...tags].reverse().find(tag => tag.closing && tag.name === 'body' && tag.templateDepth === 0);
  const htmlEnd = [...tags].reverse().find(tag => tag.closing && tag.name === 'html' && tag.templateDepth === 0);
  const jsAt = bodyEnd?.start ?? htmlEnd?.start ?? html.length;
  if (headAt > jsAt) throw new Error('Unexpected document tag order');
  return (doctype?.[0] ?? '<!doctype html>') + html.slice(0, headAt) + headMarkup +
    html.slice(headAt, jsAt) + javascript + html.slice(jsAt);
}
