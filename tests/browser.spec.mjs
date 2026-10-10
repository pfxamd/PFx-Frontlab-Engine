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
    '<!-- <head> --><script>document.documentElement.dataset.marker = document.querySelectorAll(\'meta[http-equiv="Content-Security-Policy"]\').length;</script><p id="proof">Ready</p>',
    '',
    ''
  ));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#proof')).toHaveText('Ready');
  await expect(preview.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(preview.locator('html')).toHaveAttribute('data-marker', '1');
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

test('host remains intact when preview attempts top-level navigation', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<p id="nav">Navigation test</p>',
    '',
    'try { top.location.assign("/examples/browser-test.html?escape=1"); } catch (e) { console.info("navigation denied"); }'
  ));
  const preview = page.frameLocator('#preview iframe');
  await expect(preview.locator('#nav')).toHaveText('Navigation test');
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
  expect(new URL(page.url()).searchParams.has('escape')).toBe(false);
});

test('diagnostic storms are capped without breaking preview', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<p id="storm">Still active</p>',
    '',
    'for (let i = 0; i < 260; i++) console.log("flood", i);'
  ));
  await expect(page.frameLocator('#preview iframe').locator('#storm')).toHaveText('Still active');
  await expect.poll(() => page.evaluate(() => frontlab.events.filter(e =>
    e.type === 'diagnostic' && e.diagnostic.kind === 'console').length)).toBe(200);
  await expect.poll(() => page.evaluate(() => frontlab.engine.status)).toBe('running');
});

test('measures a sequence of real iframe runs', async ({ page, browserName }) => {
  const stats = await page.evaluate(async () => {
    const engine = frontlab.engine;
    const durations = [];
    for (let i = 0; i < 8; i++) {
      const previous = engine.runId;
      const start = performance.now();
      const ready = new Promise((resolve) => {
        const unsubscribe = engine.subscribe(event => {
          if (event.type === 'state' && event.state === 'running' && event.runId > previous) {
            unsubscribe();
            resolve();
          }
        });
      });
      engine.update({ html: '<main><p>Run ' + i + '</p></main>', css: 'main{padding:12px}', javascript: '' }, true);
      await ready;
      durations.push(performance.now() - start);
    }
    return {
      runs: durations.length,
      p50Ms: [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)],
      worstMs: Math.max(...durations),
      remainingFrames: document.querySelectorAll('#preview iframe').length
    };
  });
  console.log('Frontlab preview benchmark', browserName, JSON.stringify(stats));
  expect(stats.runs).toBe(8);
  expect(stats.remainingFrames).toBe(1);
  // A very loose watchdog, not an advertised performance guarantee.
  expect(stats.worstMs).toBeLessThan(5000);
});


test('opaque sandbox denies local storage and access to host DOM', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<output id="storage"></output>',
    '',
    [
      'const result = document.getElementById("storage");',
      'try { result.dataset.local = String(localStorage.getItem("frontlab")); } catch { result.dataset.local = "blocked"; }',
      'try { result.dataset.parent = String(parent.document.querySelector("#host-secret")); } catch { result.dataset.parent = "blocked"; }',
      'try { result.dataset.cookie = String(document.cookie || "empty"); } catch { result.dataset.cookie = "blocked"; }'
    ].join("\n")
  ));
  const node = page.frameLocator('#preview iframe').locator('#storage');
  await expect(node).toHaveAttribute('data-local', 'blocked');
  await expect(node).toHaveAttribute('data-parent', 'blocked');
  await expect(node).toHaveAttribute('data-cookie', /^(empty|blocked)$/);
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
});

test('sandbox blocks popups, even from user-activated preview controls', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<button id="popup">Try popup</button><output id="out"></output>',
    '',
    'document.getElementById("popup").onclick = () => {const out=document.getElementById("out"); try { const result=window.open("about:blank", "_blank"); out.textContent=result ? "opened" : "blocked"; } catch { out.textContent="blocked"; }};'
  ));
  await page.frameLocator('#preview iframe').locator('#popup').click();
  await expect(page.frameLocator('#preview iframe').locator('#out')).toHaveText('blocked');
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
});

test('top-level navigation is blocked even after user interaction', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<button id="escape">Escape</button><output id="out"></output>',
    '',
    'document.querySelector("#escape").onclick = () => { try { top.location.href = "/examples/browser-test.html?escaped=1"; } catch { document.querySelector("#out").textContent="denied"; } };'
  ));
  await page.frameLocator('#preview iframe').locator('#escape').click();
  await expect(page.frameLocator('#preview iframe').locator('#escape')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('escaped')).toBe(false);
});

test('sandbox blocks form submission and keeps host intact', async ({ page }) => {
  const outgoing = [];
  page.on('request', req => { if (req.url().includes('/probe-form-submit')) outgoing.push(req.url()); });
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<form action="/probe-form-submit" method="GET"><button id="submit">Submit</button></form>',
    '',
    ''
  ));
  await page.frameLocator('#preview iframe').locator('#submit').click();
  await page.waitForTimeout(200);
  expect(outgoing).toEqual([]);
  await expect(page.frameLocator('#preview iframe').locator('#submit')).toBeVisible();
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
});

test('CSP prevents worker creation from a blob URL', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<output id="worker">blocked</output>',
    '',
    'try { const url = URL.createObjectURL(new Blob(["postMessage(1)"], {type:"text/javascript"})); const worker = new Worker(url); worker.onmessage = () => document.querySelector("#worker").textContent="allowed"; worker.onerror = () => {worker.terminate();}; } catch (e) { console.info("worker blocked"); }'
  ));
  const worker = page.frameLocator('#preview iframe').locator('#worker');
  await expect(worker).toHaveText('blocked');
  await page.waitForTimeout(200);
  await expect(worker).toHaveText('blocked');
});

test('bounded CPU load eventually allows restart; this is not a runaway-loop guarantee', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<p id="cpu">Busy</p>',
    '',
    'const until=performance.now()+140; while(performance.now()<until){}; document.querySelector("#cpu").textContent="Recovered";'
  ));
  await expect(page.frameLocator('#preview iframe').locator('#cpu')).toHaveText('Recovered', {timeout:10000});
  await page.evaluate((files) => frontlab.engine.update(files, true), source('<p id="cpu">Next run</p>'));
  await expect(page.frameLocator('#preview iframe').locator('#cpu')).toHaveText('Next run');
  await expect(page.locator('#preview iframe')).toHaveCount(1);
});

test('large but bounded DOM work does not prevent stopping the preview', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<p id="nodes">0</p>',
    '',
    'const fragment=document.createDocumentFragment(); for(let i=0;i<2500;i++){ const node=document.createElement("span");node.textContent=String(i);fragment.appendChild(node); } document.body.appendChild(fragment); document.querySelector("#nodes").textContent=String(document.querySelectorAll("span").length);'
  ));
  await expect(page.frameLocator('#preview iframe').locator('#nodes')).toHaveText('2500');
  await page.evaluate(() => frontlab.engine.stop());
  await expect(page.locator('#preview iframe')).toHaveCount(0);
  await expect(page.locator('#host-secret')).toHaveText('HOST_PRIVATE_MARKER');
});

test('many console calls forward at most the documented diagnostic budget', async ({ page }) => {
  await page.evaluate((files) => frontlab.engine.update(files, true), source(
    '<p id="flood">Done</p>',
    '',
    'for(let i=0;i<3000;i++) console.log("diagnostic",i);'
  ));
  await expect(page.frameLocator('#preview iframe').locator('#flood')).toHaveText('Done');
  await expect.poll(() => page.evaluate(() => frontlab.events.filter(e => e.type === 'diagnostic').length)).toBe(200);
  await expect(page.locator('#preview iframe')).toHaveCount(1);
});
