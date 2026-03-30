import { test, expect } from '@playwright/test';

const FIXTURE = '/test/fixtures/test-page.html';

/**
 * Helper: get a shadow-root element from a <gh-feedback> instance.
 * Playwright does not pierce shadow DOM with normal selectors,
 * so we use page.locator('gh-feedback#id').locator('>> .selector')
 * or evaluate into shadow roots.
 */

// Helper to get an element handle inside shadow root
function shadowEl(page, hostSelector, innerSelector) {
  return page.evaluateHandle(
    ([host, inner]) => document.querySelector(host)?.shadowRoot?.querySelector(inner),
    [hostSelector, innerSelector]
  );
}

// Helper to click inside shadow root (uses JS .click() to avoid z-index/overlap issues with fixed FABs)
async function shadowClick(page, hostSelector, innerSelector) {
  await page.evaluate(
    ([host, inner]) => document.querySelector(host)?.shadowRoot?.querySelector(inner)?.click(),
    [hostSelector, innerSelector]
  );
}

// Helper to fill input inside shadow root (uses JS to avoid overlay issues)
async function shadowFill(page, hostSelector, innerSelector, value) {
  await page.evaluate(
    ([host, inner, val]) => {
      const el = document.querySelector(host)?.shadowRoot?.querySelector(inner);
      if (!el) return;
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [hostSelector, innerSelector, value]
  );
}

// Helper to check visibility inside shadow root
async function shadowVisible(page, hostSelector, innerSelector) {
  return page.evaluate(
    ([host, inner]) => {
      const el = document.querySelector(host)?.shadowRoot?.querySelector(inner);
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    },
    [hostSelector, innerSelector]
  );
}

// Helper to get text content inside shadow root
async function shadowText(page, hostSelector, innerSelector) {
  return page.evaluate(
    ([host, inner]) => document.querySelector(host)?.shadowRoot?.querySelector(inner)?.textContent,
    [hostSelector, innerSelector]
  );
}

// Default mock route for proxy endpoint
async function mockProxySuccess(page) {
  await page.route('**/feedback', route => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ issueNumber: 42, issueUrl: 'https://github.com/test/repo/issues/42' }),
  }));
}

// Open popup on a given instance and fill the title
async function openAndFillTitle(page, hostId, title = 'Test bug') {
  await shadowClick(page, `gh-feedback#${hostId}`, '.fab');
  // Wait for popup to be visible
  await page.waitForFunction(
    ([host]) => {
      const popup = document.querySelector(host)?.shadowRoot?.querySelector('.popup');
      return popup && popup.classList.contains('open');
    },
    [`gh-feedback#${hostId}`],
    { timeout: 2000 }
  );
  await shadowFill(page, `gh-feedback#${hostId}`, '#ghf-title', title);
}


test.describe('gh-feedback E2E', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE);
    // Wait for custom elements to be defined
    await page.waitForFunction(() => customElements.get('gh-feedback') !== undefined);
  });

  // 1. FAB renders in bottom-right by default
  test('FAB renders in bottom-right by default', async ({ page }) => {
    const box = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#default');
      const fab = el.shadowRoot.querySelector('.fab');
      return fab.getBoundingClientRect().toJSON();
    });
    const viewport = page.viewportSize();
    // FAB should be near bottom-right
    expect(box.right).toBeGreaterThan(viewport.width - 80);
    expect(box.bottom).toBeGreaterThan(viewport.height - 80);
    // Verify the SVG icon is present
    const hasSvg = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#default');
      return !!el.shadowRoot.querySelector('.fab svg');
    });
    expect(hasSvg).toBe(true);
  });

  // 2. FAB renders in all 4 positions
  test('FAB renders in all 4 positions', async ({ page }) => {
    const viewport = page.viewportSize();
    const positions = [
      { id: 'top-left', check: (b) => b.left < 80 && b.top < 80 },
      { id: 'top-right', check: (b) => b.right > viewport.width - 80 && b.top < 80 },
      { id: 'bottom-left', check: (b) => b.left < 80 && b.bottom > viewport.height - 80 },
      { id: 'default', check: (b) => b.right > viewport.width - 80 && b.bottom > viewport.height - 80 },
    ];
    for (const { id, check } of positions) {
      const box = await page.evaluate(
        (sel) => document.querySelector(sel)?.shadowRoot?.querySelector('.fab')?.getBoundingClientRect().toJSON(),
        `gh-feedback#${id}`
      );
      expect(check(box), `Position check failed for #${id}: ${JSON.stringify(box)}`).toBe(true);
    }
  });

  // 3. FAB with button-text is pill-shaped
  test('FAB with button-text is pill-shaped', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#pill');
      const fab = el.shadowRoot.querySelector('.fab');
      return {
        hasPillClass: fab.classList.contains('pill'),
        text: fab.querySelector('.fab-text')?.textContent,
        width: fab.getBoundingClientRect().width,
      };
    });
    expect(result.hasPillClass).toBe(true);
    expect(result.text).toBe('Help');
    expect(result.width).toBeGreaterThan(48); // pill is wider than circle (md default = 48px)
  });

  // 4. Click FAB opens popup
  test('Click FAB opens popup', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() => {
      const el = document.querySelector('gh-feedback#default');
      return el.shadowRoot.querySelector('.popup')?.classList.contains('open');
    });
    const hasElements = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return {
        title: !!sr.querySelector('#ghf-title'),
        desc: !!sr.querySelector('#ghf-desc'),
        pills: sr.querySelectorAll('.type-pill').length,
        submit: !!sr.querySelector('.submit-btn'),
      };
    });
    expect(hasElements.title).toBe(true);
    expect(hasElements.desc).toBe(true);
    expect(hasElements.pills).toBe(3);
    expect(hasElements.submit).toBe(true);
  });

  // 5. X button closes popup
  test('X button closes popup', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    await shadowClick(page, 'gh-feedback#default', '.close-btn');
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
  });

  // 6. Escape closes popup
  test('Escape closes popup', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Verify FAB is focused
    const fabFocused = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#default');
      return el.shadowRoot.activeElement === el.shadowRoot.querySelector('.fab');
    });
    expect(fabFocused).toBe(true);
  });

  // 7. Backdrop click closes popup
  test('Backdrop click closes popup', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    await shadowClick(page, 'gh-feedback#default', '.backdrop');
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
  });

  // 8. Focus returns to FAB after close
  test('Focus returns to FAB after close', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    await shadowClick(page, 'gh-feedback#default', '.close-btn');
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    const fabFocused = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#default');
      return el.shadowRoot.activeElement === el.shadowRoot.querySelector('.fab');
    });
    expect(fabFocused).toBe(true);
  });

  // 9. Focus trap — Tab wraps last-to-first
  test('Focus trap — Tab wraps last-to-first', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Focus the submit button (last focusable in form view)
    await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      sr.querySelector('.submit-btn').focus();
    });
    // Tab should wrap to first focusable element (close button)
    await page.keyboard.press('Tab');
    const activeTag = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      const active = sr.activeElement;
      return active?.className || active?.tagName;
    });
    // First focusable in popup is the close button
    expect(activeTag).toContain('close-btn');
  });

  // 10. Focus trap — Shift+Tab wraps first-to-last
  test('Focus trap — Shift+Tab wraps first-to-last', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Focus the close button (first focusable in popup)
    await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      sr.querySelector('.close-btn').focus();
    });
    // Shift+Tab should wrap to last focusable (submit button)
    await page.keyboard.press('Shift+Tab');
    const activeTag = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.activeElement?.className || '';
    });
    expect(activeTag).toContain('submit-btn');
  });

  // 11. Keyboard-only full flow
  test('Keyboard-only full flow (no mouse)', async ({ page }) => {
    await mockProxySuccess(page);

    // Tab to the default FAB — it's the first gh-feedback element's fab
    // We need to focus it via keyboard. The FABs are in shadow roots,
    // so we focus the host first, then the browser delegates into shadow.
    // Actually, Tab from body should eventually reach a FAB.
    // Let's focus the first gh-feedback's FAB directly, then use only keyboard.
    await page.evaluate(() => {
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.fab').focus();
    });

    // Enter to open
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    // Title input should be focused after a short delay
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.activeElement?.id === 'ghf-title';
    }, { timeout: 2000 });

    // Type title
    await page.keyboard.type('Keyboard test bug');

    // Tab to description
    await page.keyboard.press('Tab');
    await page.keyboard.type('Description from keyboard');

    // Tab to submit button (past char-count div which is not focusable, past error-msg)
    // From textarea: Tab -> submit-btn (no other focusable elements between)
    await page.keyboard.press('Tab');

    // Verify we're on the submit button
    const onSubmit = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.activeElement?.classList.contains('submit-btn');
    });
    expect(onSubmit).toBe(true);

    // Enter to submit
    await page.keyboard.press('Enter');

    // Wait for success
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    const successText = await shadowText(page, 'gh-feedback#default', '.success-text');
    expect(successText).toContain('#42');
  });

  // 12. Empty title shows validation error
  test('Empty title shows validation error', async ({ page }) => {
    let requestMade = false;
    await page.route('**/feedback', () => { requestMade = true; });

    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Click submit without filling title
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    const errorText = await shadowText(page, 'gh-feedback#default', '.error-msg');
    expect(errorText).toContain('Title is required');

    const errorVisible = await shadowVisible(page, 'gh-feedback#default', '.error-msg');
    expect(errorVisible).toBe(true);

    expect(requestMade).toBe(false);
  });

  // 13. No endpoint/token shows config error
  test('No endpoint/token shows config error', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#no-config', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#no-config').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    await shadowFill(page, 'gh-feedback#no-config', '#ghf-title', 'Test title');
    await shadowClick(page, 'gh-feedback#no-config', '.submit-btn');

    const errorText = await shadowText(page, 'gh-feedback#no-config', '.error-msg');
    expect(errorText).toContain('No endpoint or token configured');
  });

  // 14. Proxy mode submit — success (loading -> success -> auto-close)
  test('Proxy mode submit — success', async ({ page }) => {
    await mockProxySuccess(page);
    await openAndFillTitle(page, 'default', 'Test bug');

    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Wait for success state
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    const successText = await shadowText(page, 'gh-feedback#default', '.success-text');
    expect(successText).toContain('Issue filed!');
    expect(successText).toContain('#42');

    // Verify auto-close after ~2s
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return !sr.querySelector('.popup')?.classList.contains('open');
    }, { timeout: 5000 });
  });

  // 15. Loading state visible (200ms delay mock)
  test('Loading state visible', async ({ page }) => {
    await page.route('**/feedback', async route => {
      await new Promise(r => setTimeout(r, 200));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ issueNumber: 42, issueUrl: 'https://github.com/test/repo/issues/42' }),
      });
    });

    await openAndFillTitle(page, 'default', 'Test loading');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Check loading state immediately
    const loadingState = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      const btn = sr.querySelector('.submit-btn');
      const titleInput = sr.querySelector('#ghf-title');
      return {
        btnText: btn.textContent,
        btnDisabled: btn.disabled,
        hasSpinner: !!sr.querySelector('.spinner'),
        titleDisabled: titleInput.disabled,
      };
    });
    expect(loadingState.btnText).toContain('Filing issue...');
    expect(loadingState.btnDisabled).toBe(true);
    expect(loadingState.hasSpinner).toBe(true);
    expect(loadingState.titleDisabled).toBe(true);
  });

  // 16. Direct mode submit (intercept github.com, check auth header)
  test('Direct mode submit', async ({ page }) => {
    let capturedRequest = null;
    await page.route('https://api.github.com/**', async route => {
      capturedRequest = {
        url: route.request().url(),
        headers: route.request().headers(),
        body: JSON.parse(route.request().postData()),
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ number: 99, html_url: 'https://github.com/test/repo/issues/99' }),
      });
    });

    await openAndFillTitle(page, 'direct', 'Direct mode test');
    await shadowClick(page, 'gh-feedback#direct', '.submit-btn');

    // Wait for success
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#direct').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest.headers['authorization']).toBe('Bearer ghp_test123');
    expect(capturedRequest.body.title).toBe('Direct mode test');
    expect(capturedRequest.body.labels).toContain('bug');

    const successText = await shadowText(page, 'gh-feedback#direct', '.success-text');
    expect(successText).toContain('#99');
  });

  // 17. Server error (500 response)
  test('Server error — 500 response', async ({ page }) => {
    await page.route('**/feedback', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Internal Server Error' }),
    }));

    await openAndFillTitle(page, 'default', 'Error test');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Wait for error to appear
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      const err = sr.querySelector('.error-msg');
      return err?.classList.contains('visible');
    }, { timeout: 5000 });

    const errorText = await shadowText(page, 'gh-feedback#default', '.error-msg');
    expect(errorText).toContain('Server error');

    // Fields should be re-enabled
    const fieldsEnabled = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return !sr.querySelector('#ghf-title').disabled;
    });
    expect(fieldsEnabled).toBe(true);
  });

  // 18. HTML response from misconfigured proxy
  test('HTML response from misconfigured proxy', async ({ page }) => {
    await page.route('**/feedback', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>404 Not Found</body></html>',
    }));

    await openAndFillTitle(page, 'default', 'HTML response test');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.querySelector('.error-msg')?.classList.contains('visible');
    }, { timeout: 5000 });

    const errorText = await shadowText(page, 'gh-feedback#default', '.error-msg');
    expect(errorText).toContain('Unexpected response');
  });

  // 19. Error clears on field edit
  test('Error clears on field edit', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Trigger validation error
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');
    const errorBefore = await shadowVisible(page, 'gh-feedback#default', '.error-msg');
    expect(errorBefore).toBe(true);

    // Type in title field
    await shadowFill(page, 'gh-feedback#default', '#ghf-title', 'Now has title');

    // Error should be cleared — need to trigger input event
    // fill() dispatches input event, so the error should clear
    // Wait a moment for the event handler
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return !sr.querySelector('.error-msg')?.classList.contains('visible');
    }, { timeout: 2000 });
  });

  // 20. Dark theme computed styles
  test('Dark theme computed styles', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#dark', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#dark').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const bgColor = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#dark').shadowRoot;
      const popup = sr.querySelector('.popup');
      return getComputedStyle(popup).backgroundColor;
    });
    // Dark bg should be #1c2128 = rgb(28, 33, 40)
    expect(bgColor).toBe('rgb(28, 33, 40)');
  });

  // 21. Mobile viewport — bottom sheet
  test('Mobile viewport — bottom sheet', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    // Reload to get fresh layout
    await page.goto(FIXTURE);
    await page.waitForFunction(() => customElements.get('gh-feedback') !== undefined);

    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const popupBox = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      const popup = sr.querySelector('.popup');
      return popup.getBoundingClientRect().toJSON();
    });

    // Bottom sheet: should be close to full viewport width
    // Component uses max-width: 100% at <=479px, actual width may be slightly less due to borders
    expect(popupBox.width).toBeGreaterThanOrEqual(340);
    // Should be at the bottom of the viewport (within ~10px)
    expect(popupBox.bottom).toBeGreaterThanOrEqual(650);
    // No horizontal scroll
    const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHScroll).toBe(false);
  });

  // 22. Multiple instances — one popup at a time
  test('Multiple instances — one popup at a time', async ({ page }) => {
    // Open first
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    // Open second (dark)
    await shadowClick(page, 'gh-feedback#dark', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#dark').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    // First should be closed
    const firstOpen = await page.evaluate(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    expect(firstOpen).toBe(false);

    // Second should be open
    const secondOpen = await page.evaluate(() =>
      document.querySelector('gh-feedback#dark').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    expect(secondOpen).toBe(true);
  });

  // 23. gh-feedback:filed event fires
  test('gh-feedback:filed event fires', async ({ page }) => {
    await mockProxySuccess(page);

    // Set up listener before submit
    await page.evaluate(() => {
      window._filedDetail = null;
      document.addEventListener('gh-feedback:filed', (e) => {
        window._filedDetail = e.detail;
      });
    });

    await openAndFillTitle(page, 'default', 'Event test');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Wait for filed event
    await page.waitForFunction(() => window._filedDetail !== null, { timeout: 5000 });

    const detail = await page.evaluate(() => window._filedDetail);
    expect(detail.issueNumber).toBe(42);
    expect(detail.issueUrl).toBe('https://github.com/test/repo/issues/42');
  });

  // 24. gh-feedback:submit cancelable (preventDefault blocks submission)
  test('gh-feedback:submit is cancelable', async ({ page }) => {
    let requestMade = false;
    await page.route('**/feedback', () => { requestMade = true; });

    // Set up preventDefault listener
    await page.evaluate(() => {
      document.querySelector('gh-feedback#default').addEventListener('gh-feedback:submit', (e) => {
        e.preventDefault();
      });
    });

    await openAndFillTitle(page, 'default', 'Canceled submit');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Give it a moment — if the request were going to fire, it would
    await page.waitForTimeout(500);
    expect(requestMade).toBe(false);

    // Form should still be showing (not in loading or success state)
    const formVisible = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.querySelector('.form-view')?.style.display !== 'none';
    });
    expect(formVisible).toBe(true);
  });

  // 25. Success auto-dismiss and form reset
  test('Success auto-dismiss and form reset', async ({ page }) => {
    await mockProxySuccess(page);
    await openAndFillTitle(page, 'default', 'Reset test');

    // Select Feature type before submitting
    await shadowClick(page, 'gh-feedback#default', '.type-pill[data-type="feature"]');

    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Wait for auto-close
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return !sr.querySelector('.popup')?.classList.contains('open');
    }, { timeout: 5000 });

    // Re-open and verify form is reset
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const formState = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return {
        title: sr.querySelector('#ghf-title').value,
        desc: sr.querySelector('#ghf-desc').value,
        bugActive: sr.querySelector('.type-pill[data-type="bug"]').classList.contains('active'),
        featureActive: sr.querySelector('.type-pill[data-type="feature"]').classList.contains('active'),
      };
    });
    expect(formState.title).toBe('');
    expect(formState.desc).toBe('');
    expect(formState.bugActive).toBe(true);
    expect(formState.featureActive).toBe(false);
  });

  // 26. Rate limiting — submit disabled after success
  test('Rate limiting — submit disabled after success', async ({ page }) => {
    await mockProxySuccess(page);
    await openAndFillTitle(page, 'default', 'Rate limit test');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Wait for success
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    // Submit button should be disabled (rate limited)
    const btnDisabled = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      return sr.querySelector('.submit-btn').disabled;
    });
    expect(btnDisabled).toBe(true);
  });

  // 27. Labels attribute sent in proxy mode
  test('Labels attribute sent in proxy mode', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/feedback', async route => {
      capturedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ issueNumber: 55, issueUrl: 'https://github.com/test/repo/issues/55' }),
      });
    });

    await openAndFillTitle(page, 'with-labels', 'Labels test');
    // Select Feature type
    await shadowClick(page, 'gh-feedback#with-labels', '.type-pill[data-type="feature"]');
    await shadowClick(page, 'gh-feedback#with-labels', '.submit-btn');

    // Wait for request
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#with-labels').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.labels).toContain('enhancement');
    expect(capturedBody.labels).toContain('feedback');
    expect(capturedBody.labels).toContain('user-reported');
    // Should be deduplicated (3 items total)
    expect(capturedBody.labels.length).toBe(3);
  });

  // ---- Trigger styles ----

  // 28. trigger="button" renders inline button (icon-only when no button-text)
  test('trigger="button" renders inline button', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#trigger-btn');
      const btn = el.shadowRoot.querySelector('.trigger-btn');
      if (!btn) return null;
      const style = getComputedStyle(btn);
      return {
        exists: true,
        position: style.position,
        tagName: btn.tagName,
        text: btn.textContent.trim(),
        hasSvg: !!btn.querySelector('svg'),
        noFab: !el.shadowRoot.querySelector('.fab'),
        isIconOnly: btn.classList.contains('icon-only'),
      };
    });
    expect(result).not.toBeNull();
    expect(result.exists).toBe(true);
    expect(result.position).toBe('static');
    expect(result.tagName).toBe('BUTTON');
    // No button-text set, so icon-only — no text content besides the SVG
    expect(result.hasSvg).toBe(true);
    expect(result.isIconOnly).toBe(true);
    expect(result.noFab).toBe(true);
  });

  // 29. trigger="button" opens popup on click
  test('trigger="button" opens popup on click', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#trigger-btn', '.trigger-btn');
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#trigger-btn').shadowRoot;
      const popup = sr.querySelector('.popup');
      return popup?.classList.contains('open') && getComputedStyle(popup).opacity === '1';
    }, { timeout: 3000 });
    const isOpen = await page.evaluate(() =>
      document.querySelector('gh-feedback#trigger-btn').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    expect(isOpen).toBe(true);
  });

  // 30. trigger="link" renders text link
  test('trigger="link" renders text link', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#trigger-link');
      const link = el.shadowRoot.querySelector('.trigger-link');
      if (!link) return null;
      const style = getComputedStyle(link);
      return {
        exists: true,
        tagName: link.tagName,
        text: link.textContent.trim(),
        hasSvg: !!link.querySelector('svg'),
        role: link.getAttribute('role'),
        noFab: !el.shadowRoot.querySelector('.fab'),
        color: style.color,
      };
    });
    expect(result).not.toBeNull();
    expect(result.exists).toBe(true);
    expect(result.tagName).toBe('A');
    expect(result.text).toContain('Send feedback');
    expect(result.hasSvg).toBe(true);
    expect(result.role).toBe('button');
    expect(result.noFab).toBe(true);
  });

  // 31. trigger="link" opens popup on click
  test('trigger="link" opens popup on click', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#trigger-link', '.trigger-link');
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#trigger-link').shadowRoot;
      const popup = sr.querySelector('.popup');
      return popup?.classList.contains('open') && getComputedStyle(popup).opacity === '1';
    }, { timeout: 3000 });
    const isOpen = await page.evaluate(() =>
      document.querySelector('gh-feedback#trigger-link').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    expect(isOpen).toBe(true);
  });

  // ---- Severity field ----

  // 32. severity pills shown by default when type is bug
  test('severity pills shown by default when type is bug', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#with-severity', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#with-severity').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const result = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#with-severity').shadowRoot;
      const selector = sr.querySelector('.severity-selector');
      const pills = sr.querySelectorAll('.severity-pill');
      return {
        exists: !!selector,
        visible: !selector?.classList.contains('hidden'),
        pillCount: pills.length,
        pillLabels: Array.from(pills).map(p => p.textContent),
        defaultActive: sr.querySelector('.severity-pill.active')?.dataset.severity,
      };
    });
    expect(result.exists).toBe(true);
    expect(result.visible).toBe(true);
    expect(result.pillCount).toBe(4);
    expect(result.pillLabels).toEqual(['Low', 'Medium', 'High', 'Critical']);
    expect(result.defaultActive).toBe('medium');
  });

  // 33. severity hidden when type is feature
  test('severity hidden when type is feature', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#with-severity', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#with-severity').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    // Click "Feature" type pill
    await shadowClick(page, 'gh-feedback#with-severity', '.type-pill[data-type="feature"]');

    const hidden = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#with-severity').shadowRoot;
      return sr.querySelector('.severity-selector')?.classList.contains('hidden');
    });
    expect(hidden).toBe(true);
  });

  // 34. severity re-appears when switching back to bug
  test('severity re-appears when switching back to bug', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#with-severity', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#with-severity').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    // Switch to feature then back to bug
    await shadowClick(page, 'gh-feedback#with-severity', '.type-pill[data-type="feature"]');
    await shadowClick(page, 'gh-feedback#with-severity', '.type-pill[data-type="bug"]');

    const visible = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#with-severity').shadowRoot;
      return !sr.querySelector('.severity-selector')?.classList.contains('hidden');
    });
    expect(visible).toBe(true);
  });

  // 35. severity included in submit payload (proxy mode)
  test('severity included in submit payload', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/feedback', async route => {
      capturedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ issueNumber: 70, issueUrl: 'https://github.com/test/repo/issues/70' }),
      });
    });

    await openAndFillTitle(page, 'with-severity', 'Severity test bug');

    // Click "High" severity pill
    await shadowClick(page, 'gh-feedback#with-severity', '.severity-pill[data-severity="high"]');
    await shadowClick(page, 'gh-feedback#with-severity', '.submit-btn');

    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#with-severity').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.severity).toBe('high');
    expect(capturedBody.type).toBe('bug');
  });

  // 36. severity omitted when no-severity attribute is present
  test('severity omitted when no-severity present', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/feedback', async route => {
      capturedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ issueNumber: 71, issueUrl: 'https://github.com/test/repo/issues/71' }),
      });
    });

    await openAndFillTitle(page, 'no-severity', 'No severity test');
    await shadowClick(page, 'gh-feedback#no-severity', '.submit-btn');

    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#no-severity').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.severity).toBeUndefined();
  });

  // 37. direct mode: high severity adds priority label
  test('direct mode: high severity adds priority label', async ({ page }) => {
    let capturedBody = null;
    await page.route('https://api.github.com/**', async route => {
      capturedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ number: 80, html_url: 'https://github.com/test/repo/issues/80' }),
      });
    });

    await openAndFillTitle(page, 'direct-severity', 'High severity direct');
    await shadowClick(page, 'gh-feedback#direct-severity', '.severity-pill[data-severity="high"]');
    await shadowClick(page, 'gh-feedback#direct-severity', '.submit-btn');

    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#direct-severity').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.body).toContain('**Severity:** High');
    expect(capturedBody.labels).toContain('priority: high');
  });

  // --- icon attribute ---

  test('icon="bug" renders bug SVG path', async ({ page }) => {
    const pathD = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#icon-bug');
      const path = el.shadowRoot.querySelector('.fab svg path');
      return path?.getAttribute('d');
    });
    expect(pathD).toContain('M20 8h-2.81');
  });

  // --- size attribute ---

  test('size="sm" renders smaller trigger', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#size-sm');
      const fab = el.shadowRoot.querySelector('.fab');
      const box = fab.getBoundingClientRect();
      return { width: box.width, height: box.height, hasClass: fab.classList.contains('size-sm') };
    });
    expect(result.hasClass).toBe(true);
    expect(result.width).toBe(36);
    expect(result.height).toBe(36);
  });

  test('size="lg" renders larger trigger', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#size-lg');
      const fab = el.shadowRoot.querySelector('.fab');
      const box = fab.getBoundingClientRect();
      return { width: box.width, height: box.height, hasClass: fab.classList.contains('size-lg') };
    });
    expect(result.hasClass).toBe(true);
    expect(result.width).toBe(56);
    expect(result.height).toBe(56);
  });

  // --- color attribute ---

  test('color attribute changes primary color', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#custom-color');
      const styles = getComputedStyle(el);
      return {
        primary: styles.getPropertyValue('--gh-feedback-primary').trim(),
        fabBg: styles.getPropertyValue('--gh-feedback-fab-bg').trim(),
      };
    });
    expect(result.primary).toBe('#6f42c1');
    expect(result.fabBg).toBe('#6f42c1');
  });

  // ---- New feature tests (Phase 4) ----

  // 42. Default icon is memo
  test('default icon is memo', async ({ page }) => {
    const pathD = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#default');
      const path = el.shadowRoot.querySelector('.fab svg path');
      return path?.getAttribute('d');
    });
    // memo icon path starts with 'M14 2H6c'
    expect(pathD).toContain('M14 2H6c');
  });

  // 43. icon="bug" changes icon
  test('icon="bug" changes icon', async ({ page }) => {
    const pathD = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#icon-bug');
      const path = el.shadowRoot.querySelector('.fab svg path');
      return path?.getAttribute('d');
    });
    // bug icon path starts with 'M20 8h-2.81'
    expect(pathD).toContain('M20 8h-2.81');
  });

  // 44. icon="none" renders no icon
  test('icon="none" renders no icon in trigger', async ({ page }) => {
    const hasSvg = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#icon-none');
      const fab = el.shadowRoot.querySelector('.fab');
      return !!fab?.querySelector('svg');
    });
    expect(hasSvg).toBe(false);
  });

  // 45. popup-color changes popup accent
  test('popup-color changes popup submit button color', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#popup-color', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#popup-color').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const submitBg = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#popup-color').shadowRoot;
      const btn = sr.querySelector('.submit-btn');
      return getComputedStyle(btn).backgroundColor;
    });
    // #6f42c1 = rgb(111, 66, 193)
    expect(submitBg).toBe('rgb(111, 66, 193)');
  });

  // 46. popup-color independent of trigger color
  test('popup-color independent of trigger color', async ({ page }) => {
    const triggerBg = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#popup-color-indep');
      const fab = el.shadowRoot.querySelector('.fab');
      return getComputedStyle(fab).backgroundColor;
    });
    // color="#ff0000" -> trigger bg = rgb(255, 0, 0)
    expect(triggerBg).toBe('rgb(255, 0, 0)');

    await shadowClick(page, 'gh-feedback#popup-color-indep', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#popup-color-indep').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const submitBg = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#popup-color-indep').shadowRoot;
      return getComputedStyle(sr.querySelector('.submit-btn')).backgroundColor;
    });
    // popup-color="#0000ff" -> submit bg = rgb(0, 0, 255)
    expect(submitBg).toBe('rgb(0, 0, 255)');
  });

  // 47. types attribute customizes type pills
  test('types attribute customizes type pills', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#custom-types', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#custom-types').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const result = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#custom-types').shadowRoot;
      const pills = sr.querySelectorAll('.type-pill');
      return {
        count: pills.length,
        types: Array.from(pills).map(p => p.dataset.type),
      };
    });
    expect(result.count).toBe(4);
    expect(result.types).toEqual(['bug', 'feature', 'question', 'ui']);
  });

  // 48. no-type-icons hides icons from type pills
  test('no-type-icons hides icons from type pills', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#no-type-icons', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#no-type-icons').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const svgCount = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#no-type-icons').shadowRoot;
      const pills = sr.querySelectorAll('.type-pill');
      let count = 0;
      pills.forEach(p => { if (p.querySelector('svg')) count++; });
      return count;
    });
    expect(svgCount).toBe(0);
  });

  // 49. severity shown by default for bug type (using existing fixture)
  test('severity shown by default for bug type', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#with-severity', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#with-severity').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    const visible = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#with-severity').shadowRoot;
      const sel = sr.querySelector('.severity-selector');
      return sel && !sel.classList.contains('hidden');
    });
    expect(visible).toBe(true);
  });

  // 50. severity hidden for feature type
  test('severity hidden for feature type', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#with-severity', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#with-severity').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    await shadowClick(page, 'gh-feedback#with-severity', '.type-pill[data-type="feature"]');

    const hidden = await page.evaluate(() => {
      const sr = document.querySelector('gh-feedback#with-severity').shadowRoot;
      return sr.querySelector('.severity-selector')?.classList.contains('hidden');
    });
    expect(hidden).toBe(true);
  });

  // 51. repo accepts full GitHub URL
  test('repo accepts full GitHub URL', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/feedback', async route => {
      capturedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ issueNumber: 100, issueUrl: 'https://github.com/test/repo/issues/100' }),
      });
    });

    await openAndFillTitle(page, 'repo-url', 'URL repo test');
    await shadowClick(page, 'gh-feedback#repo-url', '.submit-btn');

    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#repo-url').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.repo).toBe('test/repo');
  });

  // 52. trigger="none" renders no trigger, .open() works
  test('trigger="none" renders no trigger', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#trigger-none');
      return {
        hasFab: !!el.shadowRoot.querySelector('.fab'),
        hasBtn: !!el.shadowRoot.querySelector('.trigger-btn'),
        hasLink: !!el.shadowRoot.querySelector('.trigger-link'),
      };
    });
    expect(result.hasFab).toBe(false);
    expect(result.hasBtn).toBe(false);
    expect(result.hasLink).toBe(false);

    // Open via API
    await page.evaluate(() => {
      document.querySelector('gh-feedback#trigger-none').open();
    });
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#trigger-none').shadowRoot.querySelector('.popup')?.classList.contains('open'),
      { timeout: 3000 }
    );

    const isOpen = await page.evaluate(() =>
      document.querySelector('gh-feedback#trigger-none').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    expect(isOpen).toBe(true);
  });

  // 53. border attributes apply to trigger
  test('border attributes apply to trigger', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#border-custom');
      const fab = el.shadowRoot.querySelector('.fab');
      const style = fab.style;
      return {
        hasBorder: style.border.includes('#333') || style.border.includes('rgb(51, 51, 51)'),
        styleAttr: fab.getAttribute('style'),
      };
    });
    // The inline style should contain border with #333 and 2px
    expect(result.styleAttr).toContain('#333');
    expect(result.styleAttr).toContain('2px');
  });

  // 54. size="40" pixel sizing
  test('size="40" pixel sizing', async ({ page }) => {
    const result = await page.evaluate(() => {
      const el = document.querySelector('gh-feedback#size-px');
      const fab = el.shadowRoot.querySelector('.fab');
      const box = fab.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    expect(result.width).toBeCloseTo(40, 0);
    expect(result.height).toBeCloseTo(40, 0);
  });

  // 55. getContext property included in submission
  test('getContext property included in submission', async ({ page }) => {
    let capturedBody = null;
    await page.route('**/feedback', async route => {
      capturedBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ issueNumber: 200, issueUrl: 'https://github.com/test/repo/issues/200' }),
      });
    });

    // Set getContext function
    await page.evaluate(() => {
      document.querySelector('gh-feedback#with-context').getContext = () => ({ page: 'test', version: '1.0' });
    });

    await openAndFillTitle(page, 'with-context', 'Context test');
    await shadowClick(page, 'gh-feedback#with-context', '.submit-btn');

    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#with-context').shadowRoot;
      return sr.querySelector('.success-msg')?.style.display === 'block';
    }, { timeout: 5000 });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.context).toEqual({ page: 'test', version: '1.0' });
  });

  // 56. close() public API closes an open popup
  test('close() public API closes an open popup', async ({ page }) => {
    // Open popup via public API
    await page.evaluate(() => document.querySelector('gh-feedback#trigger-none').open());
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#trigger-none').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Close via public API
    await page.evaluate(() => document.querySelector('gh-feedback#trigger-none').close());
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#trigger-none').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
  });

  // 57. toggle() public API opens then closes popup
  test('toggle() public API opens then closes popup', async ({ page }) => {
    // First toggle — should open
    await page.evaluate(() => document.querySelector('gh-feedback#trigger-none').toggle());
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#trigger-none').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
    // Second toggle — should close
    await page.evaluate(() => document.querySelector('gh-feedback#trigger-none').toggle());
    await page.waitForFunction(() =>
      !document.querySelector('gh-feedback#trigger-none').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );
  });

  // 58. Network error shows CORS hint
  test('network error shows CORS hint message', async ({ page }) => {
    // Abort all requests to the feedback endpoint to simulate network failure
    await page.route('**/feedback', route => route.abort('failed'));

    await openAndFillTitle(page, 'default', 'Network error test');
    await shadowClick(page, 'gh-feedback#default', '.submit-btn');

    // Wait for error message to appear
    await page.waitForFunction(() => {
      const sr = document.querySelector('gh-feedback#default').shadowRoot;
      const errEl = sr.querySelector('.error-msg');
      return errEl && errEl.classList.contains('visible') && errEl.textContent.length > 0;
    }, { timeout: 5000 });

    const errorText = await shadowText(page, 'gh-feedback#default', '.error-msg');
    // Should mention CORS or "reach the server"
    expect(errorText).toMatch(/CORS|reach the server/i);
  });

  // 59. Character count updates on description input
  test('character count updates on description input', async ({ page }) => {
    await shadowClick(page, 'gh-feedback#default', '.fab');
    await page.waitForFunction(() =>
      document.querySelector('gh-feedback#default').shadowRoot.querySelector('.popup')?.classList.contains('open')
    );

    // Check initial count
    const initialCount = await shadowText(page, 'gh-feedback#default', '.char-count');
    expect(initialCount).toBe('0 / 2000');

    // Type some text into the description
    await shadowFill(page, 'gh-feedback#default', '#ghf-desc', 'Hello world');

    const updatedCount = await shadowText(page, 'gh-feedback#default', '.char-count');
    expect(updatedCount).toBe('11 / 2000');
  });

});
