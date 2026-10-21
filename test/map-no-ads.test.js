import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('kartsiden (index.html) laster ikke AdSense', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('adsbygoogle'));
  assert.ok(!html.includes('pagead2.googlesyndication.com'));
});
