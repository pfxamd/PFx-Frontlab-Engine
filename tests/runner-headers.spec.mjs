import { test, expect } from '@playwright/test';

test('cross-origin fixture sends CSP as an HTTP response header',async({request})=>{
  const response=await request.get('http://127.0.0.1:4174/runner.html');
  expect(response.ok()).toBe(true);
  const headers=response.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'self' http://127.0.0.1:4173");
  expect(headers['content-security-policy']).toContain("connect-src 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  const html=await response.text();
  expect(html).toContain('content="http://127.0.0.1:4173"');
});
