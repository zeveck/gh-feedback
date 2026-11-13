import { test, expect } from '@playwright/test';

const FIXTURE = '/test/fixtures/test-page.html';
const SHOT_HINT = '<!-- Your screenshot is copied: click here and paste it (Ctrl/Cmd+V) -->';

// --- helpers -------------------------------------------------------------

/** Replace window.open: record URLs, and return a fake window (or null = blocked). */
async function stubOpen(page, { blocked = false } = {}) {
  await page.evaluate((blocked) => {
    window._opened = [];
    window.open = (url) => { window._opened.push(url); return blocked ? null : {}; };
  }, blocked);
}

/**
 * Replace navigator.clipboard.write: record the PNG it was given (as its byte
 * length and type), and resolve or reject.
 */
async function stubClipboard(page, { fail = false } = {}) {
  await page.evaluate((fail) => {
    window._clip = [];
    const write = async (items) => {
      const blob = await items[0].getType('image/png');
      window._clip.push({ types: [...items[0].types], type: blob.type, size: blob.size });
      if (fail) throw new DOMException('denied', 'NotAllowedError');
    };
    Object.defineProperty(navigator.clipboard, 'write', { value: write, configurable: true });
  }, fail);
}

/** Give the element a getScreenshot hook that returns a small image as a data URL. */
async function setScreenshot(page, id, { type = 'image/png' } = {}) {
  await page.evaluate(([id, type]) => {
    const el = document.querySelector(`gh-feedback#${id}`);
    window._shotCalls = [];
    el.getScreenshot = () => {
      const popup = el.shadowRoot.querySelector('.popup');
      window._shotCalls.push({ popupDisplay: getComputedStyle(popup).display });
      const c = document.createElement('canvas');
      c.width = 8; c.height = 6;
      const g = c.getContext('2d');
      g.fillStyle = '#c00'; g.fillRect(0, 0, 8, 6);
      return c.toDataURL(type);
    };
  }, [id, type]);
}

async function openForm(page, id) {
  await page.evaluate((id) => document.querySelector(`gh-feedback#${id}`).open(), id);
  await page.waitForFunction((id) =>
    document.querySelector(`gh-feedback#${id}`).shadowRoot.querySelector('.popup')?.classList.contains('open'), id);
}

async function fill(page, id, selector, value) {
  await page.evaluate(([id, sel, val]) => {
    const el = document.querySelector(`gh-feedback#${id}`).shadowRoot.querySelector(sel);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, selector, value]);
}

async function click(page, id, selector) {
  await page.evaluate(([id, sel]) =>
    document.querySelector(`gh-feedback#${id}`).shadowRoot.querySelector(sel).click(), [id, selector]);
}

async function shadow(page, id, fn, arg) {
  return page.evaluate(([id, fnSrc, arg]) => {
    const root = document.querySelector(`gh-feedback#${id}`).shadowRoot;
    return new Function('root', 'arg', fnSrc)(root, arg);
  }, [id, fn, arg]);
}

async function submitAndGetUrl(page, id) {
  await click(page, id, '.submit-btn');
  await page.waitForFunction(() => window._opened?.length === 1);
  return new URL(await page.evaluate(() => window._opened[0]));
}

async function waitForNote(page, id) {
  await page.waitForFunction((id) =>
    !!document.querySelector(`gh-feedback#${id}`).shadowRoot.querySelector('.link-note'), id);
  return shadow(page, id, `return root.querySelector('.link-note').textContent`);
}

// --- tests ---------------------------------------------------------------

test.describe('gh-feedback link mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => customElements.get('gh-feedback'));
  });

  test('form says it continues on GitHub', async ({ page }) => {
    await openForm(page, 'link');
    const text = await shadow(page, 'link', `return root.querySelector('.submit-btn').textContent + '|' + root.querySelector('.link-hint').textContent`);
    expect(text).toContain('Continue on GitHub');
    expect(text).toContain('GitHub account');
    // Proxy-mode forms are unchanged
    await page.evaluate(() => document.querySelector('gh-feedback#link').close());
    await openForm(page, 'trigger-none');
    const proxy = await shadow(page, 'trigger-none', `return root.querySelector('.submit-btn').textContent + '|' + !!root.querySelector('.link-hint')`);
    expect(proxy).toBe('Submit Feedback|false');
  });

  test('builds a pre-filled new-issue URL with type, severity, description and context', async ({ page }) => {
    await stubOpen(page);
    await page.evaluate(() => {
      document.querySelector('gh-feedback#link').getContext = () => ({ level: 3, 'odd|key': 'a|b*c' });
    });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Player falls through floor');
    await fill(page, 'link', '#ghf-desc', 'Jumped at the ledge & fell.');
    await click(page, 'link', '.severity-pill[data-severity="high"]');
    const url = await submitAndGetUrl(page, 'link');

    expect(url.origin + url.pathname).toBe('https://github.com/test/repo/issues/new');
    expect(url.searchParams.get('title')).toBe('Player falls through floor');
    expect(url.searchParams.has('labels')).toBe(false);
    expect(url.searchParams.has('template')).toBe(false);
    const body = url.searchParams.get('body');
    expect(body).toContain('**Type:** Bug');
    expect(body).toContain('**Severity:** High');
    expect(body).toContain('Jumped at the ledge & fell.');
    expect(body).toContain('<summary>Context</summary>');
    expect(body).toContain('| level | 3 |');
    expect(body).toContain('| odd\\|key | a\\|b\\*c |');
    expect(body).toContain('Filed via [gh-feedback]');
    expect(body).not.toContain(SHOT_HINT); // no screenshot hook
  });

  test('mode="link" wins over endpoint', async ({ page }) => {
    await stubOpen(page);
    let posted = false;
    await page.route('**/feedback', (route) => { posted = true; route.abort(); });
    await openForm(page, 'link-explicit');
    await fill(page, 'link-explicit', '#ghf-title', 'Explicit');
    const url = await submitAndGetUrl(page, 'link-explicit');
    expect(url.searchParams.get('title')).toBe('Explicit');
    expect(posted).toBe(false);
  });

  test('YAML issue form: template= and the description field', async ({ page }) => {
    await stubOpen(page);
    await openForm(page, 'link-form');
    await fill(page, 'link-form', '#ghf-title', 'Form');
    await fill(page, 'link-form', '#ghf-desc', 'Via the form');
    const url = await submitAndGetUrl(page, 'link-form');
    expect(url.searchParams.get('template')).toBe('bug.yml');
    expect(url.searchParams.get('description')).toContain('Via the form');
    expect(url.searchParams.has('body')).toBe(false);
  });

  test('Markdown template: template= and body=', async ({ page }) => {
    await stubOpen(page);
    await openForm(page, 'link-md');
    await fill(page, 'link-md', '#ghf-title', 'Md');
    const url = await submitAndGetUrl(page, 'link-md');
    expect(url.searchParams.get('template')).toBe('bug.md');
    expect(url.searchParams.get('body')).toContain('**Type:** Bug');
  });

  test('template-field names the form field', async ({ page }) => {
    await stubOpen(page);
    await openForm(page, 'link-field');
    await fill(page, 'link-field', '#ghf-title', 'Field');
    const url = await submitAndGetUrl(page, 'link-field');
    expect(url.searchParams.get('what-happened')).toContain('**Type:** Bug');
    expect(url.searchParams.has('description')).toBe(false);
  });

  test('a huge context is trimmed, longest values first, to stay under the limit', async ({ page }) => {
    await stubOpen(page);
    await page.evaluate(() => {
      document.querySelector('gh-feedback#link').getContext = () => ({
        version: '1.2.3',
        errors: 'E'.repeat(9000),
        state: 'S'.repeat(4000),
      });
    });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Big');
    await fill(page, 'link', '#ghf-desc', 'Keep this description.');
    const url = await submitAndGetUrl(page, 'link');
    const raw = await page.evaluate(() => window._opened[0]);
    expect(raw.length).toBeLessThanOrEqual(6000);
    const body = url.searchParams.get('body');
    expect(body).toContain('| version | 1.2.3 |');
    expect(body).toContain('Keep this description.');
    expect(body).toContain('| errors | EEE');
    expect(body).toContain('…');
  });

  test('a description too long to fit is trimmed last, and says so', async ({ page }) => {
    await stubOpen(page);
    await page.evaluate(() => {
      document.querySelector('gh-feedback#link').getContext = () => ({ a: 'x'.repeat(3000) });
    });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Long');
    await fill(page, 'link', '#ghf-desc', '€'.repeat(2000)); // 9 encoded chars each
    const url = await submitAndGetUrl(page, 'link');
    const raw = await page.evaluate(() => window._opened[0]);
    expect(raw.length).toBeLessThanOrEqual(6000);
    const body = url.searchParams.get('body');
    expect(body).not.toContain('<summary>Context</summary>');
    expect(body).toContain('(trimmed)');
    expect(body).toContain('Filed via [gh-feedback]');
  });

  test('getScreenshot is called when the form opens, before the popup shows', async ({ page }) => {
    await setScreenshot(page, 'link');
    await openForm(page, 'link');
    const calls = await page.evaluate(() => window._shotCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].popupDisplay).toBe('none');
    // Not called again on submit
    await stubOpen(page);
    await stubClipboard(page);
    await fill(page, 'link', '#ghf-title', 'Timing');
    await submitAndGetUrl(page, 'link');
    expect(await page.evaluate(() => window._shotCalls.length)).toBe(1);
  });

  test('thumbnail shows, and Remove leaves the screenshot out', async ({ page }) => {
    await setScreenshot(page, 'link');
    await openForm(page, 'link');
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#link').shadowRoot.querySelector('.shot').hidden);
    const src = await shadow(page, 'link', `return root.querySelector('.shot img').src`);
    expect(src).toMatch(/^blob:/);

    await click(page, 'link', '.shot-remove');
    expect(await shadow(page, 'link', `return root.querySelector('.shot').hidden`)).toBe(true);

    await stubOpen(page);
    await stubClipboard(page);
    await fill(page, 'link', '#ghf-title', 'No shot');
    const url = await submitAndGetUrl(page, 'link');
    expect(url.searchParams.get('body')).not.toContain(SHOT_HINT);
    expect(await page.evaluate(() => window._clip.length)).toBe(0);
    const note = await waitForNote(page, 'link');
    expect(note).not.toContain('screenshot');
  });

  test('copies the screenshot as PNG, then opens GitHub, and says to paste', async ({ page }) => {
    await setScreenshot(page, 'link');
    await stubOpen(page);
    await stubClipboard(page);
    await page.evaluate(() => {
      window._events = [];
      document.addEventListener('gh-feedback:opened', (e) => window._events.push(e.detail));
    });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'With shot');
    const url = await submitAndGetUrl(page, 'link');

    const clip = await page.evaluate(() => window._clip);
    expect(clip).toEqual([{ types: ['image/png'], type: 'image/png', size: expect.any(Number) }]);
    expect(url.searchParams.get('body')).toContain(SHOT_HINT);
    const note = await waitForNote(page, 'link');
    expect(note).toContain('GitHub opened in a new tab');
    expect(note).toContain('paste it into the issue (Ctrl/Cmd+V)');
    const events = await page.evaluate(() => window._events);
    expect(events).toHaveLength(1);
    expect(events[0].opened).toBe(true);
    expect(events[0].screenshotCopied).toBe(true);
    expect(events[0].url).toBe(url.href);
  });

  test('a JPEG screenshot is converted to PNG for the clipboard', async ({ page }) => {
    await setScreenshot(page, 'link', { type: 'image/jpeg' });
    await stubOpen(page);
    await stubClipboard(page);
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Jpeg');
    await submitAndGetUrl(page, 'link');
    const clip = await page.evaluate(() => window._clip);
    expect(clip[0].type).toBe('image/png');
    expect(clip[0].size).toBeGreaterThan(0);
  });

  test('real clipboard holds the PNG (Chromium)', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Only Chromium lets tests grant clipboard permissions');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setScreenshot(page, 'link');
    await stubOpen(page);
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Real clipboard');
    await submitAndGetUrl(page, 'link');
    await waitForNote(page, 'link');
    const types = await page.evaluate(async () => (await navigator.clipboard.read())[0].types);
    expect(types).toContain('image/png');
  });

  test('if the copy fails, offers a download instead', async ({ page }) => {
    await setScreenshot(page, 'link');
    await stubOpen(page);
    await stubClipboard(page, { fail: true });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Copy fails');
    await submitAndGetUrl(page, 'link');
    const note = await waitForNote(page, 'link');
    expect(note).toContain('Download the screenshot');
    expect(note).not.toContain('Ctrl/Cmd+V');
    const dl = await shadow(page, 'link', `const a = root.querySelector('.link-note a[download]'); return a && [a.download, a.href.slice(0, 5)]`);
    expect(dl).toEqual(['screenshot.png', 'blob:']);
  });

  test('if the new tab is blocked, shows a link to GitHub', async ({ page }) => {
    await stubOpen(page, { blocked: true });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Blocked');
    const url = await submitAndGetUrl(page, 'link');
    const note = await waitForNote(page, 'link');
    expect(note).toContain('blocked the new tab');
    const href = await shadow(page, 'link', `return root.querySelector('.link-note a').href`);
    expect(href).toBe(url.href);
  });

  test('Done closes and resets; submit event can cancel', async ({ page }) => {
    await stubOpen(page);
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Done');
    await submitAndGetUrl(page, 'link');
    await waitForNote(page, 'link');
    await click(page, 'link', '.done-btn');
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#link').shadowRoot.querySelector('.popup').classList.contains('open'));
    expect(await shadow(page, 'link', `return !!root.querySelector('.link-note')`)).toBe(false);

    // Cancel via gh-feedback:submit: nothing opens
    await page.evaluate(() => {
      window._opened = [];
      document.querySelector('gh-feedback#link').addEventListener('gh-feedback:submit', (e) => {
        window._submitDetail = e.detail;
        e.preventDefault();
      });
    });
    await openForm(page, 'link');
    await fill(page, 'link', '#ghf-title', 'Cancelled');
    await click(page, 'link', '.submit-btn');
    await page.waitForFunction(() => window._submitDetail);
    const detail = await page.evaluate(() => window._submitDetail);
    expect(detail.mode).toBe('link');
    expect(detail.url).toContain('https://github.com/test/repo/issues/new?');
    expect(await page.evaluate(() => window._opened.length)).toBe(0);
  });

  test('proxy and direct modes never call getScreenshot', async ({ page }) => {
    for (const id of ['trigger-none', 'direct']) {
      await page.evaluate((id) => {
        window._shotCalled = false;
        document.querySelector(`gh-feedback#${id}`).getScreenshot = () => { window._shotCalled = true; return null; };
        document.querySelector(`gh-feedback#${id}`).open();
      }, id);
      await page.waitForTimeout(50);
      expect(await page.evaluate(() => window._shotCalled)).toBe(false);
      await page.evaluate((id) => document.querySelector(`gh-feedback#${id}`).close(), id);
    }
  });
});
