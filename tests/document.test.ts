import { describe, expect, it } from 'vitest';
import { buildDocument, PREVIEW_CSP } from '../src/document.js';
describe('document', () => {
  const files = { html:'<html><head><title>x</title></head><body><p>ok</p></body></html>', css:'p{color:red}', javascript:'console.log("yes")' };
  it('preserves full document and injects styles and scripts', () => {
    const result=buildDocument(files,'abc',1);
    expect(result).toContain('<title>x</title>');
    expect(result).toContain('p{color:red}');
    expect(result).toContain('console.log("yes")');
    expect(result).toContain('Content-Security-Policy');
  });
  it('supports fragments', () => {
    expect(buildDocument({...files,html:'<p>x</p>'},'abc',1)).toContain('<p>x</p>');
  });
  it('blocks external network capabilities by default',()=>{
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).toContain("default-src 'none'");
  });
  it('escapes script and style end tags in supplied source',()=>{
    const result=buildDocument({html:'',css:'a{} </style> broken',javascript:'const s="</script>";'},'abc',1);
    expect(result).toContain('<\\/script>');
    expect(result).toContain('<\\/style>');
  });
  it('ignores fake head tags inside HTML comments', () => {
    const source = '<!-- <head> --><script id="early">window.marker=1</script>';
    const result = buildDocument({ html:source,css:'',javascript:'' }, 'safe', 2);
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<script id="early">'));
    expect(result).toContain('<!-- <head> -->');
  });
  it('ignores fake head tags inside script strings', () => {
    const html = '<html><script>const sample="<head>";</script><body><p>ok</p></body></html>';
    const result = buildDocument({html,css:'',javascript:''},'safe',3);
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<script>const sample'));
  });
  it('does not inject user JavaScript into HTML comments or raw text', () => {
    const html = '<html><head></head><body><!-- </body> --><script>const s="</body>";</script><p>ok</p></body></html>';
    const result = buildDocument({html,css:'',javascript:'window.finished=true'},'safe',4);
    expect(result.indexOf('window.finished=true')).toBeGreaterThan(result.indexOf('<p>ok</p>'));
    expect(result.indexOf('window.finished=true')).toBeLessThan(result.lastIndexOf('</body>'));
  });
  it('ignores fake closing body tags inside templates', () => {
    const html = '<html><body><template></body></template><p>normal</p></body></html>';
    const result = buildDocument({html,css:'',javascript:'window.finished=true'},'safe',5);
    expect(result.indexOf('window.finished=true')).toBeGreaterThan(result.indexOf('<p>normal</p>'));
  });
  it('preserves quoted attributes containing angle brackets', () => {
    const html = '<html data-info="<head>"><head><title>fine</title></head><body>ok</body></html>';
    const result = buildDocument({html,css:'',javascript:''},'safe',6);
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<title>fine</title>'));
    expect(result).toContain('data-info="<head>"');
  });
  it('validates run ids',()=>{
    expect(()=>buildDocument(files,'abc',0)).toThrow();
  });
});
