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
  it('validates run ids',()=>{
    expect(()=>buildDocument(files,'abc',0)).toThrow();
  });
});
