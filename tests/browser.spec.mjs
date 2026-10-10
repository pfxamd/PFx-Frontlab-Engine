import { test, expect } from '@playwright/test';

const source = (html = '', css = '', javascript = '') => ({ html, css, javascript });

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/browser-test.html');
  await page.waitForFunction(() => !!window.frontlab?.engine);
});

test('executes HTML/CSS/JavaScript and reports console output', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<button id="action">Tap</button><output id="count">0</output>',
    '#count { color: rgb(18, 52, 86) }',
    'document.querySelector("#action").onclick = () => { document.querySelector("#count").textContent = "1"; console.log("frontlab-click"); };'
  ));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#count')).toHaveCSS('color', 'rgb(18, 52, 86)');
  await preview.locator('#action').click();
  await expect(preview.locator('#count')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => frontlab.events.some(e =>
    e.type === 'diagnostic' && e.diagnostic.message.includes('frontlab-click')
  ))).toBe(true);
});

test('CSS-only update preserves DOM and JavaScript state', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<button id="action">Increment</button><output id="count">0</output>',
    '#count { color: rgb(1, 2, 3) }',
    'let clicks = 0; document.querySelector("#action").onclick = () => document.querySelector("#count").textContent = String(++clicks);'
  ));
  const preview = page.frameLocator('#preview iframe');
  await preview.locator('#action').click();
  await expect(preview.locator('#count')).toHaveText('1');
  const originalRun = await page.evaluate(() => frontlab.engine.runId);
  await page.evaluate(() => frontlab.engine.updateCSS('#count { color: rgb(20, 40, 60) }'));
  await expect(preview.locator('#count')).toHaveCSS('color', 'rgb(20, 40, 60)');
  await expect(preview.locator('#count')).toHaveText('1');
  await preview.locator('#action').click();
  await expect(preview.locator('#count')).toHaveText('2');
  expect(await page.evaluate(() => frontlab.engine.runId)).toBe(originalRun);
});

test('sandbox blocks host document access and CSP blocks fetch', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<output id="security"></output>',
    '',
    `const target = document.querySelector("#security");
     try { parent.document.querySelector("#host-secret"); target.dataset.parent = "leaked"; }
     catch (error) { target.dataset.parent = "blocked"; }
     fetch("https://example.com/private").then(
       () => target.dataset.network = "allowed",
       () => target.dataset.network = "blocked"
     );`
  ));
  const target = page.frameLocator('#preview iframe').locator('#security');
  await expect(target).toHaveAttribute('data-parent', 'blocked');
  await expect(target).toHaveAttribute('data-network', 'blocked');
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
  expect(await page.locator('#preview iframe').getAttribute('sandbox')).toBe('allow-scripts');
});

test('runtime errors reach diagnostics without crashing the editor', async ({ page, browserName }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<h2 id="status">Safe</h2>',
    '',
    'throw new Error("frontlab-runtime-failure");'
  ));
  await expect(page.frameLocator('#preview iframe').locator('#status')).toHaveText('Safe');
  // Sandboxed WebKit reports opaque-origin script exceptions as "Script error."
  // while Chromium and Firefox expose the original error message.
  await expect.poll(() => page.evaluate((engineName) => frontlab.events.some(e =>
    e.type === 'diagnostic' && e.diagnostic.kind === 'runtime' &&
    (engineName === 'webkit'
      ? e.diagnostic.message === 'Script error.'
      : e.diagnostic.message.includes('frontlab-runtime-failure'))
  ), browserName)).toBe(true);
});

test('rapid runs show the last document and discard old frames', async ({ page }) => {
  await page.evaluate(() => {
    frontlab.engine.update({ html: '<p id="old">Old</p>', css: '', javascript: 'console.log("old")' }, true);
    frontlab.engine.update({ html: '<p id="latest">Latest</p>', css: '', javascript: '' }, true);
  });
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#latest')).toHaveText('Latest');
  await expect(page.locator('#preview iframe')).toHaveCount(1);
  await expect(preview.locator('#old')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => frontlab.engine.status)).toBe('running');
});

test('stop and dispose remove the sandbox and reject further updates', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source('<p>OK</p>'));
  await expect(page.frameLocator('#preview iframe').locator('p')).toHaveText('OK');
  await page.evaluate(() => { frontlab.engine.stop(); frontlab.engine.dispose(); });
  await expect(page.locator('#preview iframe')).toHaveCount(0);
  expect(await page.evaluate(() => frontlab.engine.status)).toBe('disposed');
  expect(await page.evaluate(() => {
    try { frontlab.engine.update({ html:'', css:'', javascript:'' }, true); return false; }
    catch { return true; }
  })).toBe(true);
});

test('escaped closing-script text stays inside a user JS string', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<output id="safe"></output>', '',
    'const marker = "</script><img src=x>"; document.querySelector("#safe").textContent = marker;'
  ));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#safe')).toHaveText('</script><img src=x>');
  await expect(preview.locator('img')).toHaveCount(0);
});

test('CSP initializes before scripts when source contains deceptive head markup', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<!-- <head> --><script>document.body.dataset.marker = document.querySelectorAll(\'meta[http-equiv="Content-Security-Policy"]\').length;</script><p id="proof">Ready</p>',
    '',
    ''
  ));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#proof')).toHaveText('Ready');
  await expect(preview.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(preview.locator('body')).toHaveAttribute('data-marker', '1');
});

test('does not lose the appended script when user HTML contains fake body closing tags', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<html><head><title>Basic</title></head><body><!-- </body> --><p id="before">Works</p></body></html>',
    '',
    'document.body.dataset.executed = "yes";'
  ));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#before')).toHaveText('Works');
  await expect(preview.locator('body')).toHaveAttribute('data-executed', 'yes');
});

test('rapid CSS-only patching retains only the final intended style', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source('<p id="target">Hi</p>','p { color: black }'));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#target')).toBeVisible();
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) frontlab.engine.updateCSS('p { color: rgb(' + i + ', 0, 0) }');
  });
  await expect(preview.locator('#target')).toHaveCSS('color', 'rgb(29, 0, 0)');
  await expect(page.locator('#preview iframe')).toHaveCount(1);
});
