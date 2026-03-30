import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import worker from '../worker/worker.js';

// --- helpers ---

function makeEnv(overrides = {}) {
  return { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo', ALLOWED_ORIGINS: '*', ...overrides };
}

function makeRequest(method, path, body, headers = {}) {
  const url = `https://proxy.example.com${path}`;
  const init = { method, headers: { 'Content-Type': 'application/json', Origin: 'https://mysite.com', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

function validBody(overrides = {}) {
  return { title: 'Test bug', type: 'bug', ...overrides };
}

let originalFetch;

function mockGitHub(status, body) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// --- tests ---

describe('gh-feedback worker', () => {
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // Success path
  it('returns 201 with issueNumber and issueUrl on valid POST', async () => {
    mockGitHub(201, { number: 42, html_url: 'https://github.com/owner/repo/issues/42' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.issueNumber, 42);
    assert.strictEqual(data.issueUrl, 'https://github.com/owner/repo/issues/42');
  });

  // Validation
  it('returns 400 when title is missing', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', { type: 'bug' }), makeEnv());
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /title/i);
  });

  it('returns 400 when title exceeds 120 chars', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', { title: 'x'.repeat(121) }), makeEnv());
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /120/);
  });

  it('returns 400 when description exceeds 2000 chars', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', { title: 'ok', description: 'x'.repeat(2001) }), makeEnv());
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /2000/);
  });

  it('defaults type to bug when not provided', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ number: 1, html_url: 'https://github.com/o/r/issues/1' }), { status: 201 });
    };
    await worker.fetch(makeRequest('POST', '/feedback', { title: 'No type' }), makeEnv());
    assert.ok(sentBody.labels.includes('bug'));
    assert.match(sentBody.body, /Bug/);
  });

  // Env checks
  it('returns 500 when GITHUB_TOKEN is missing', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv({ GITHUB_TOKEN: '' }));
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.match(data.error, /misconfigured/i);
  });

  it('returns 500 when GITHUB_REPO is missing', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv({ GITHUB_REPO: '' }));
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.match(data.error, /misconfigured/i);
  });

  // CORS
  it('returns 403 when origin is not in ALLOWED_ORIGINS', async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: 'https://allowed.com' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), env);
    assert.strictEqual(res.status, 403);
  });

  it('allows request when origin matches ALLOWED_ORIGINS', async () => {
    mockGitHub(201, { number: 1, html_url: 'https://github.com/o/r/issues/1' });
    const env = makeEnv({ ALLOWED_ORIGINS: 'https://other.com, https://mysite.com' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), env);
    assert.strictEqual(res.status, 201);
  });

  it('allows any origin when ALLOWED_ORIGINS is *', async () => {
    mockGitHub(201, { number: 1, html_url: 'https://github.com/o/r/issues/1' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 201);
  });

  // Routing
  it('returns 405 for GET requests', async () => {
    const res = await worker.fetch(makeRequest('GET', '/feedback'), makeEnv());
    assert.strictEqual(res.status, 405);
  });

  it('returns 404 for POST to unknown path', async () => {
    const res = await worker.fetch(makeRequest('POST', '/other', validBody()), makeEnv());
    assert.strictEqual(res.status, 404);
  });

  it('handles POST to / same as POST to /feedback', async () => {
    mockGitHub(201, { number: 7, html_url: 'https://github.com/o/r/issues/7' });
    const res = await worker.fetch(makeRequest('POST', '/', validBody()), makeEnv());
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.issueNumber, 7);
  });

  it('returns 204 with CORS headers for OPTIONS', async () => {
    const req = makeRequest('OPTIONS', '/feedback');
    const res = await worker.fetch(req, makeEnv());
    assert.strictEqual(res.status, 204);
    assert.ok(res.headers.get('Access-Control-Allow-Origin'));
    assert.ok(res.headers.get('Access-Control-Allow-Methods'));
  });

  // GitHub error mapping
  it('maps GitHub 401 to 401 with error message', async () => {
    mockGitHub(401, { message: 'Bad credentials' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.match(data.error, /token/i);
  });

  it('maps GitHub 403 to 403 with error message', async () => {
    mockGitHub(403, { message: 'Forbidden' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /rate limit|permission/i);
  });

  it('maps GitHub 404 to 404 with error message', async () => {
    mockGitHub(404, { message: 'Not Found' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /repository/i);
  });

  it('maps GitHub 422 to 422 with error message', async () => {
    mockGitHub(422, { message: 'Validation Failed' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.match(data.error, /rejected/i);
  });

  it('returns 502 on network error', async () => {
    globalThis.fetch = async () => { throw new Error('Network fail'); };
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 502);
    const data = await res.json();
    assert.match(data.error, /reach github/i);
  });

  // Label merging
  it('merges client labels with type-derived labels', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ number: 1, html_url: 'https://github.com/o/r/issues/1' }), { status: 201 });
    };
    await worker.fetch(makeRequest('POST', '/feedback', validBody({ type: 'feature', labels: ['enhancement', 'ui', 'priority'] })), makeEnv());
    // 'enhancement' is type-derived for feature; should not be duplicated
    assert.deepStrictEqual(sentBody.labels, ['enhancement', 'ui', 'priority']);
  });

  // CORS on all responses
  it('includes CORS headers on all responses', async () => {
    // Check error response has CORS headers
    const res = await worker.fetch(makeRequest('GET', '/feedback'), makeEnv());
    assert.ok(res.headers.get('Access-Control-Allow-Origin'));

    // Check success response has CORS headers
    mockGitHub(201, { number: 1, html_url: 'https://github.com/o/r/issues/1' });
    const res2 = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.ok(res2.headers.get('Access-Control-Allow-Origin'));
  });

  // Repo URL normalization
  it('normalizes full GitHub URL in GITHUB_REPO to owner/repo', async () => {
    let fetchedUrl;
    globalThis.fetch = async (url, opts) => {
      fetchedUrl = url;
      return new Response(JSON.stringify({ number: 10, html_url: 'https://github.com/test/repo/issues/10' }), { status: 201 });
    };
    await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv({ GITHUB_REPO: 'https://github.com/test/repo' }));
    assert.strictEqual(fetchedUrl, 'https://api.github.com/repos/test/repo/issues');
  });

  it('normalizes www GitHub URL with trailing slash in GITHUB_REPO', async () => {
    let fetchedUrl;
    globalThis.fetch = async (url, opts) => {
      fetchedUrl = url;
      return new Response(JSON.stringify({ number: 11, html_url: 'https://github.com/test/repo/issues/11' }), { status: 201 });
    };
    await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv({ GITHUB_REPO: 'https://www.github.com/test/repo/' }));
    assert.strictEqual(fetchedUrl, 'https://api.github.com/repos/test/repo/issues');
  });

  // Invalid JSON body
  it('returns 400 with Invalid JSON for non-JSON body', async () => {
    const url = 'https://proxy.example.com/feedback';
    const req = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://mysite.com' },
      body: 'not json',
    });
    const res = await worker.fetch(req, makeEnv());
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Invalid JSON/i);
  });

  // Invalid type
  it('returns 400 for invalid feedback type', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', { title: 'x', type: 'invalid' }), makeEnv());
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /invalid type/i);
  });

  // Unmapped GitHub status (e.g. 429 rate limit)
  it('returns 502 with GitHub API error for unmapped status codes', async () => {
    mockGitHub(429, { message: 'Rate limit exceeded' });
    const res = await worker.fetch(makeRequest('POST', '/feedback', validBody()), makeEnv());
    assert.strictEqual(res.status, 502);
    const data = await res.json();
    assert.match(data.error, /GitHub API error/i);
  });

  // Severity in issue body
  it('includes severity in GitHub issue body when provided', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ number: 20, html_url: 'https://github.com/o/r/issues/20' }), { status: 201 });
    };
    await worker.fetch(makeRequest('POST', '/feedback', { title: 'x', type: 'bug', severity: 'high' }), makeEnv());
    assert.match(sentBody.body, /\*\*Severity:\*\* high/);
  });

  // Context in issue body
  it('includes context details block in GitHub issue body when provided', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ number: 21, html_url: 'https://github.com/o/r/issues/21' }), { status: 201 });
    };
    await worker.fetch(makeRequest('POST', '/feedback', { title: 'x', type: 'bug', context: { page: 'test', version: '1.0' } }), makeEnv());
    assert.match(sentBody.body, /<details>/);
    assert.match(sentBody.body, /page/);
    assert.match(sentBody.body, /version/);
  });

  // Whitespace-only title
  it('returns 400 when title is whitespace-only', async () => {
    const res = await worker.fetch(makeRequest('POST', '/feedback', { title: '   ', type: 'bug' }), makeEnv());
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /title/i);
  });

  // Labels capped at 10
  it('caps labels at 10 in GitHub API request', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ number: 50, html_url: 'https://github.com/o/r/issues/50' }), { status: 201 });
    };
    const manyLabels = Array.from({ length: 15 }, (_, i) => `label-${i}`);
    await worker.fetch(makeRequest('POST', '/feedback', validBody({ labels: manyLabels })), makeEnv());
    // type-derived 'bug' + 15 custom = 16 total before cap; should be sliced to 10
    assert.ok(sentBody.labels.length <= 10, `Expected at most 10 labels, got ${sentBody.labels.length}`);
  });

  // Worker accepts ui/docs/performance types
  it('accepts ui, docs, and performance as valid types', async () => {
    for (const type of ['ui', 'docs', 'performance']) {
      mockGitHub(201, { number: 30, html_url: 'https://github.com/o/r/issues/30' });
      const res = await worker.fetch(makeRequest('POST', '/feedback', { title: 'x', type }), makeEnv());
      assert.notStrictEqual(res.status, 400, `type "${type}" should not return 400`);
    }
  });
});
