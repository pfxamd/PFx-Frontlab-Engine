import { describe,expect,it } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('dedicated runner production preparation', () => {
  const run = (origin) => spawnSync(process.execPath,['scripts/prepare-preview-host.mjs'],{
    cwd:process.cwd(),encoding:'utf8',env:{...process.env,FRONTLAB_EDITOR_ORIGIN:origin}
  });
  it('rejects missing editor origin (fail closed)',()=>{
    expect(run('').status).not.toBe(0);
  });
  it('rejects protocol and origin confusion',()=>{
    for(const origin of ['http://example.com','https://example.com/path','https://user:pass@example.com','javascript:alert(1)']) {
      expect(run(origin).status).not.toBe(0);
    }
  });
  it('generates deployable response headers scoped to an editor origin',async()=>{
    const result=run('https://editor.example.com');
    expect(result.status,result.stderr).toBe(0);
    const [html,headers]=await Promise.all([
      readFile('dist/preview-host/runner.html','utf8'),
      readFile('dist/preview-host/_headers','utf8')
    ]);
    expect(html).toContain('content="https://editor.example.com"');
    expect(headers).toContain('frame-ancestors https://editor.example.com');
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("connect-src 'none'");
  });
});
