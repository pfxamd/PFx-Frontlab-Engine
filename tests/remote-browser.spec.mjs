import { test, expect } from '@playwright/test';

const source = (html = '', css = '', javascript = '') => ({ html, css, javascript });

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/browser-test-remote.html');
  await page.waitForFunction(() => !!window.frontlab?.engine);
});

test('runner uses a distinct origin, and user code stays inside nested opaque sandbox', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<button id="act">Press</button><output id="result">0</output>',
    '#result { color: rgb(4, 30, 60) }',
    'document.querySelector("#act").onclick=()=>{document.querySelector("#result").textContent="1";console.info("remote action")}'
  ));
  const outer = page.frameLocator('#preview iframe');
  const inner = outer.frameLocator('iframe');
  await expect(inner.locator('#result')).toHaveCSS('color','rgb(4, 30, 60)');
  await inner.locator('#act').click();
  await expect(inner.locator('#result')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => frontlab.engine.status)).toBe('running');
  await expect.poll(() => page.evaluate(() => frontlab.events.some(e =>
    e.type === 'diagnostic' && e.diagnostic.message.includes('remote action')))).toBe(true);
  expect((await page.locator('#preview iframe').getAttribute('src'))).toContain('127.0.0.1:4174');
  expect(await page.locator('#preview iframe').getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  expect(await outer.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await page.evaluate(() => {
    try { return Boolean(document.querySelector('#preview iframe').contentWindow.document); }
    catch { return false; }
  })).toBe(false);
});

test('remote CSS patch keeps the original preview JavaScript state', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<button id="click">Increment</button><output id="n">0</output>',
    '#n { color: red }',
    'let count=0;document.querySelector("#click").onclick=()=>document.querySelector("#n").textContent=String(++count)'
  ));
  const inner=page.frameLocator('#preview iframe').frameLocator('iframe');
  await inner.locator('#click').click();
  await expect(inner.locator('#n')).toHaveText('1');
  const oldId=await page.evaluate(()=>frontlab.engine.runId);
  await page.evaluate(()=>frontlab.engine.updateCSS('#n { color: rgb(10, 20, 30) }'));
  await expect(inner.locator('#n')).toHaveCSS('color','rgb(10, 20, 30)');
  await inner.locator('#click').click();
  await expect(inner.locator('#n')).toHaveText('2');
  expect(await page.evaluate(()=>frontlab.engine.runId)).toBe(oldId);
});

test('nested preview cannot inspect runner or editor DOM', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<output id="probe"></output>',
    '',
    'const n=document.querySelector("#probe");try {parent.document.querySelector("#stage");n.dataset.runner="exposed"}catch {n.dataset.runner="blocked"};try {top.document.querySelector("#host-secret");n.dataset.host="exposed"}catch {n.dataset.host="blocked"}'
  ));
  const node=page.frameLocator('#preview iframe').frameLocator('iframe').locator('#probe');
  await expect(node).toHaveAttribute('data-runner','blocked');
  await expect(node).toHaveAttribute('data-host','blocked');
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
});

test('rejects same-origin remote runner and unsafe runner URLs', async ({ page }) => {
  const result=await page.evaluate(()=>{
    const candidates=[
      location.origin+'/preview-host/runner.html',
      'javascript:alert(1)',
      'http://external.invalid/runner.html'
    ];
    return candidates.map(runnerUrl=>{
      try{new frontlab.FrontlabEngine(document.createElement('div'),{runnerUrl});return false}
      catch{return true}
    });
  });
  expect(result).toEqual([true,true,true]);
});

test('forged app-origin runtime messages do not reach listeners', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source('<p id="ok">Running</p>'));
  await expect(page.frameLocator('#preview iframe').frameLocator('iframe').locator('#ok')).toHaveText('Running');
  const previous=await page.evaluate(()=>frontlab.events.length);
  await page.evaluate(()=>window.postMessage({
    channel:'pfx-frontlab',type:'diagnostic',token:'a'.repeat(32),runId:frontlab.engine.runId,
    diagnostic:{level:'error',kind:'console',message:'fake diagnostic'}
  }, '*'));
  await page.waitForTimeout(70);
  const result=await page.evaluate(previous=>frontlab.events.slice(previous).some(
    e=>e.type==='diagnostic'&&e.diagnostic.message==='fake diagnostic'
  ),previous);
  expect(result).toBe(false);
});

test('missing runner handshake emits timeout, removes frame and allows restart', async ({ page }) => {
  await page.route('**/preview-host/runner.html', route=>route.fulfill({
    status:200,contentType:'text/html',body:'<!doctype html><title>Non-responsive runner</title>'
  }));
  await page.evaluate(()=>{
    frontlab.engine.dispose();
    frontlab.events.length=0;
    frontlab.engine=new frontlab.FrontlabEngine(document.querySelector('#preview'),{
      runnerUrl:'http://127.0.0.1:4174/preview-host/runner.html',
      startupTimeoutMs:700,onEvent:event=>frontlab.events.push(event)
    });
    frontlab.engine.update({html:'<p id="recover">Recovered</p>',css:'',javascript:''},true);
  });
  await expect.poll(()=>page.evaluate(()=>frontlab.engine.status),{timeout:6000}).toBe('stopped');
  expect(await page.evaluate(()=>frontlab.events.some(e=>e.type==='timeout'))).toBe(true);
  await expect(page.locator('#preview iframe')).toHaveCount(0);
  await page.unroute('**/preview-host/runner.html');
  await page.evaluate(()=>frontlab.engine.run());
  await expect(page.frameLocator('#preview iframe').frameLocator('iframe').locator('#recover')).toHaveText('Recovered');
  await expect.poll(()=>page.evaluate(()=>frontlab.engine.status)).toBe('running');
});

test('stopped preview cannot be revived by messages from a retired runner', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files,true),source('<p id="retired">One</p>'));
  await expect(page.frameLocator('#preview iframe').frameLocator('iframe').locator('#retired')).toBeVisible();
  await page.evaluate(()=>frontlab.engine.stop());
  await expect(page.locator('#preview iframe')).toHaveCount(0);
  await page.evaluate(()=>window.postMessage({channel:'pfx-frontlab-bridge',type:'runner-ready'}, '*'));
  await page.waitForTimeout(50);
  expect(await page.evaluate(()=>frontlab.engine.status)).toBe('stopped');
});

test('bounded CPU spike recovers on cross-origin preview', async ({ page }) => {
  await page.evaluate((files)=>frontlab.engine.update(files,true),source(
    '<output id="cpu">Loading</output>','',
    'const end=performance.now()+110;while(performance.now()<end){};document.querySelector("#cpu").textContent="Ready"'
  ));
  await expect(page.frameLocator('#preview iframe').frameLocator('iframe').locator('#cpu')).toHaveText('Ready');
  await page.evaluate((files)=>frontlab.engine.update(files,true),source('<p id="after">New frame</p>'));
  await expect(page.frameLocator('#preview iframe').frameLocator('iframe').locator('#after')).toHaveText('New frame');
  await expect(page.locator('#preview iframe')).toHaveCount(1);
});
