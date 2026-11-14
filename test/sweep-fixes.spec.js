import { test, expect } from '@playwright/test';

// Regression tests for the bugs found in the November 2026 sweep.

const FIXTURE = '/test/fixtures/test-page.html';
const SHOT_HINT = 'Your screenshot is copied';

/** Add a <gh-feedback> to the fixture page (the element is already defined). */
async function addEl(page, html) {
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), html);
}

const root = (page, id, fn, arg) => page.evaluate(([id, fnSrc, arg]) =>
  new Function('el', 'root', 'arg', fnSrc)(document.getElementById(id), document.getElementById(id).shadowRoot, arg),
[id, fn, arg]);

async function openAndWait(page, id) {
  await root(page, id, 'el.open()');
  await page.waitForFunction((id) =>
    document.getElementById(id).shadowRoot.activeElement?.id === 'ghf-title', id);
}

async function setTitle(page, id, value) {
  await root(page, id, `const t = root.querySelector('#ghf-title'); t.value = arg; t.dispatchEvent(new Event('input'));`, value);
}

/** Record window.open URLs and gh-feedback:opened details. */
async function stubOpen(page) {
  await page.evaluate(() => {
    window._opened = [];
    window._openedEvents = [];
    window.open = (url) => { window._opened.push(url); return {}; };
    document.addEventListener('gh-feedback:opened', (e) => window._openedEvents.push(e.detail));
  });
}

/** Clipboard write that waits for the PNG, then succeeds or fails. */
async function stubClipboard(page, { fail = false } = {}) {
  await page.evaluate((fail) => {
    const write = async (items) => {
      await items[0].getType('image/png');
      if (fail) throw new DOMException('denied', 'NotAllowedError');
    };
    Object.defineProperty(navigator.clipboard, 'write', { value: write, configurable: true });
  }, fail);
}

/** A getScreenshot hook returning a small PNG data URL, optionally after a delay. */
async function setShot(page, id, delay = 0) {
  await root(page, id, `el.getScreenshot = () => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 4;
    const url = c.toDataURL('image/png');
    return arg ? new Promise(r => setTimeout(() => r(url), arg)) : url;
  };`, delay);
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => customElements.get('gh-feedback'));
});

test('#2 link mode: no "screenshot copied" hint when the copy failed', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s2" repo="a/b" trigger="none"></gh-feedback>');
  await setShot(page, 's2');
  await stubOpen(page);
  await stubClipboard(page, { fail: true });
  await openAndWait(page, 's2');
  await setTitle(page, 's2', 'x');
  await root(page, 's2', `root.querySelector('.submit-btn').click()`);
  await page.waitForFunction(() => window._openedEvents.length === 1);
  const url = await page.evaluate(() => window._opened[0]);
  expect(new URL(url).searchParams.get('body')).not.toContain(SHOT_HINT);
  const ev = await page.evaluate(() => window._openedEvents[0]);
  expect(ev.screenshotCopied).toBe(false);
  expect(ev.url).toBe(url);
});

test('#2 link mode: no hint when getScreenshot returns null', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s2b" repo="a/b" trigger="none"></gh-feedback>');
  await root(page, 's2b', 'el.getScreenshot = () => null');
  await stubOpen(page);
  await stubClipboard(page);
  await openAndWait(page, 's2b');
  await setTitle(page, 's2b', 'x');
  await root(page, 's2b', `root.querySelector('.submit-btn').click()`);
  await page.waitForFunction(() => window._opened.length === 1);
  const url = await page.evaluate(() => window._opened[0]);
  expect(new URL(url).searchParams.get('body')).not.toContain(SHOT_HINT);
});

test('#3 proxy mode: a late result from a closed popup does not touch the reopened one', async ({ page }) => {
  await page.route('**/slow-feedback', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ issueNumber: 7, issueUrl: 'https://github.com/a/b/issues/7' }) }).catch(() => {});
  });
  await addEl(page, '<gh-feedback id="s3" repo="a/b" endpoint="/slow-feedback" trigger="none"></gh-feedback>');
  await page.evaluate(() => { window._filed = 0; document.addEventListener('gh-feedback:filed', () => window._filed++); });
  await openAndWait(page, 's3');
  await setTitle(page, 's3', 'first');
  await root(page, 's3', `root.querySelector('.submit-btn').click()`);
  await root(page, 's3', 'el.close()');
  await openAndWait(page, 's3');
  await setTitle(page, 's3', 'second');
  await page.waitForTimeout(1000);
  expect(await root(page, 's3', `return root.querySelector('.success-msg').style.display`)).toBe('none');
  expect(await root(page, 's3', `return root.querySelector('#ghf-title').value`)).toBe('second');
  expect(await root(page, 's3', 'return el.isOpen')).toBe(true);
  expect(await page.evaluate(() => window._filed)).toBe(0);
});

test('#3 link mode: closing during the screenshot wait opens nothing', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s3l" repo="a/b" trigger="none"></gh-feedback>');
  await setShot(page, 's3l', 400);
  await stubOpen(page);
  await stubClipboard(page);
  await openAndWait(page, 's3l');
  await setTitle(page, 's3l', 'x');
  await root(page, 's3l', `root.querySelector('.submit-btn').click(); el.close();`);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window._opened.length)).toBe(0);
  expect(await page.evaluate(() => window._openedEvents.length)).toBe(0);
});

test('#4 border and colour attributes cannot inject HTML', async ({ page }) => {
  const evil = `"><img src=x onerror="window.__xss=1">`;
  await page.evaluate((evil) => {
    const make = (id, attrs) => {
      const el = document.createElement('gh-feedback');
      el.id = id;
      for (const [k, v] of Object.entries({ repo: 'a/b', trigger: 'fab', ...attrs })) el.setAttribute(k, v);
      document.body.append(el);
    };
    make('x1', { 'border-color': 'red' + evil });
    make('x2', { size: '40', 'button-text': 'Hi', 'border-width': '2px' + evil });
    make('x3', { size: '40', 'button-text': 'Hi', 'border-radius': '3' + evil });
    make('x6', { 'border-color': 'var(--a, ' + evil + ')' });
    make('x4', { 'border-width': '2', 'border-color': '#333' });
    make('x5', { color: 'red;background:url(x)', 'popup-color': 'blue' });
  }, evil);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  for (const id of ['x1', 'x2', 'x3', 'x6']) {
    expect(await root(page, id, `return root.querySelectorAll('img[onerror]').length`)).toBe(0);
  }
  // Valid values still apply
  expect(await root(page, 'x4', `return root.querySelector('.fab').style.border`)).toBe('2px solid rgb(51, 51, 51)');
  expect(await root(page, 'x5', `return [el.style.getPropertyValue('--gh-feedback-primary'), el.style.getPropertyValue('--gh-feedback-popup-color')]`))
    .toEqual(['', 'blue']);
});

test('#6 keys and pointer input in the form do not reach the page; isOpen and open/close events', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s6" repo="a/b" trigger="none"></gh-feedback>');
  await page.evaluate(() => {
    window._bubble = [];
    window._capture = 0;
    window._events = [];
    for (const t of ['keydown', 'keyup', 'keypress', 'pointerdown', 'click', 'wheel']) {
      window.addEventListener(t, (e) => window._bubble.push(t));
    }
    window.addEventListener('keydown', () => window._capture++, true);
    document.addEventListener('gh-feedback:open', () => window._events.push('open'));
    document.addEventListener('gh-feedback:close', () => window._events.push('close'));
  });
  await openAndWait(page, 's6');
  await page.keyboard.type('a b');
  const box = await root(page, 's6', `const r = root.querySelector('#ghf-title').getBoundingClientRect(); return [r.x + 5, r.y + 5];`);
  await page.mouse.click(box[0], box[1]);
  await page.mouse.wheel(0, 10);
  expect(await root(page, 's6', `return root.querySelector('#ghf-title').value`)).toBe('a b');
  expect(await page.evaluate(() => window._bubble)).toEqual([]);
  expect(await page.evaluate(() => window._capture)).toBeGreaterThan(0);
  expect(await root(page, 's6', 'return el.isOpen')).toBe(true);
  await page.keyboard.press('Escape');
  expect(await root(page, 's6', 'return el.isOpen')).toBe(false);
  expect(await page.evaluate(() => window._events)).toEqual(['open', 'close']);
  // Closed: keys reach the page again
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window._bubble.length)).toBeGreaterThan(0);
});

test('#7 the focus trap skips hidden elements (link-mode note)', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s7" repo="a/b" trigger="none"></gh-feedback>');
  await stubOpen(page);
  await openAndWait(page, 's7');
  await setTitle(page, 's7', 'x');
  await root(page, 's7', `root.querySelector('.submit-btn').click()`);
  await page.waitForFunction(() => document.getElementById('s7').shadowRoot.activeElement?.classList.contains('done-btn'));
  for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    const visible = await root(page, 's7', `const a = root.activeElement; return !!a && root.querySelector('.popup').contains(a) && a.getClientRects().length > 0;`);
    expect(visible, key).toBe(true);
  }
});

test('#8 focus returns to what had it (trigger="none"), and to the trigger after a re-render', async ({ page }) => {
  await addEl(page, '<canvas id="game" tabindex="0"></canvas><gh-feedback id="s8" repo="a/b" trigger="none"></gh-feedback>');
  await page.focus('#game');
  await openAndWait(page, 's8');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.id === 'game');

  await addEl(page, '<gh-feedback id="s8b" repo="a/b" trigger="button"></gh-feedback>');
  await root(page, 's8b', `root.querySelector('.trigger-btn').focus(); root.querySelector('.trigger-btn').click()`);
  await page.waitForFunction(() => document.getElementById('s8b').shadowRoot.activeElement?.id === 'ghf-title');
  await root(page, 's8b', `el.setAttribute('theme', 'dark')`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() =>
    document.getElementById('s8b').shadowRoot.activeElement?.classList.contains('trigger-btn'));
});

test('#11 context values are escaped for the table, and @mentions are neutralised', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s11" repo="a/b" trigger="none"></gh-feedback>');
  const body = await root(page, 's11', `return el._buildIssueBody({ type: 'bug', description: 'hi @octocat',
    context: { name: 'x\\n\\n</details>\\n\\n# Pwned @octocat', path: 'a\\\\|b' } })`);
  expect(body).not.toContain('</details>\n\n# Pwned');
  expect(body).toContain('&lt;/details&gt;');
  expect(body).toContain('a\\\\\\|b');
  expect(body).not.toMatch(/@octocat/);
  expect(body).toContain('hi @​octocat');
  // Emails and stack frames are left alone
  expect(await root(page, 's11', `return el._buildIssueBody({ type: 'bug', description: 'me@example.com fn@file.js' })`))
    .toContain('me@example.com fn@file.js');
});

test('#12 open() while open just focuses; after a link-mode submit it shows a fresh form', async ({ page }) => {
  await addEl(page, '<gh-feedback id="s12" repo="a/b" trigger="none"></gh-feedback>');
  await stubOpen(page);
  await page.evaluate(() => { window._opens = 0; document.addEventListener('gh-feedback:open', () => window._opens++); });
  await openAndWait(page, 's12');
  await setTitle(page, 's12', 'kept');
  await root(page, 's12', 'el.open()');
  expect(await root(page, 's12', `return root.querySelector('#ghf-title').value`)).toBe('kept');
  expect(await page.evaluate(() => window._opens)).toBe(1);
  await root(page, 's12', `root.querySelector('.submit-btn').click()`);
  await page.waitForFunction(() => !!document.getElementById('s12').shadowRoot.querySelector('.link-note'));
  await root(page, 's12', 'el.open()');
  expect(await root(page, 's12', `return [!!root.querySelector('.link-note'), root.querySelector('.form-view').style.display,
    root.querySelector('#ghf-title').value, root.querySelector('#ghf-title').disabled]`)).toEqual([false, 'block', '', false]);
});

test('#13 opening releases pointer lock and exits canvas fullscreen', async ({ page }) => {
  await addEl(page, '<canvas id="game13"></canvas><gh-feedback id="s13" repo="a/b" trigger="none"></gh-feedback>');
  await page.evaluate(() => {
    window._calls = [];
    document.exitPointerLock = () => window._calls.push('exitPointerLock');
    Object.defineProperty(document, 'fullscreenElement', { get: () => document.getElementById('game13'), configurable: true });
    document.exitFullscreen = () => { window._calls.push('exitFullscreen'); return Promise.resolve(); };
  });
  await root(page, 's13', 'el.open()');
  expect(await page.evaluate(() => window._calls)).toEqual(['exitPointerLock', 'exitFullscreen']);
});
