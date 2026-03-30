// gh-feedback proxy worker
// Setup:
//   1. Edit wrangler.toml: set GITHUB_REPO to your "owner/repo"
//   2. Set ALLOWED_ORIGINS to your site's origin (not "*" in production!)
//   3. npx wrangler secret put GITHUB_TOKEN
//   4. npx wrangler deploy

const TYPE_LABELS = { bug: 'bug', feature: 'enhancement', question: 'question', ui: 'ui', docs: 'documentation', performance: 'performance' };
const TYPE_DISPLAY = { bug: 'Bug', feature: 'Feature Request', question: 'Question', ui: 'UI', docs: 'Documentation', performance: 'Performance' };

function corsHeaders(origin, env) {
  const ao = env.ALLOWED_ORIGINS || '*';
  const allowedOrigin = ao === '*' ? '*' : (originAllowed(origin, env) ? origin : 'null');
  return { 'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

function originAllowed(origin, env) {
  const ao = env.ALLOWED_ORIGINS || '*';
  return ao === '*' || ao.split(',').map(s => s.trim()).includes(origin);
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
    if (url.pathname !== '/' && url.pathname !== '/feedback') return json({ error: 'Not found' }, 404, cors);
    if (!originAllowed(origin, env)) return json({ error: 'Origin not allowed' }, 403, cors);
    if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json({ error: 'Server misconfigured' }, 500, cors);

    // Normalize GITHUB_REPO — accept full URL or owner/repo
    const repo = env.GITHUB_REPO.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/$/, '');

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

    if (!body.title || typeof body.title !== 'string' || !body.title.trim().length) return json({ error: 'Title is required' }, 400, cors);
    if (body.title.length > 120) return json({ error: 'Title must be 120 characters or fewer' }, 400, cors);
    const type = body.type || 'bug';
    if (!TYPE_LABELS[type]) return json({ error: 'Invalid type — must be bug, feature, question, ui, docs, or performance' }, 400, cors);
    if (body.description && typeof body.description === 'string' && body.description.length > 2000)
      return json({ error: 'Description must be 2000 characters or fewer' }, 400, cors);

    const desc = body.description || 'No description provided.';
    let issueBody = `**Type:** ${TYPE_DISPLAY[type] || type}\n\n`;
    if (body.severity) issueBody += `**Severity:** ${body.severity}\n\n`;
    issueBody += `${desc}\n\n`;
    if (body.context && typeof body.context === 'object') {
      issueBody += `<details>\n<summary>Context</summary>\n\n| Key | Value |\n|-----|-------|\n`;
      const escPipe = (s) => String(s).replace(/\|/g, '\\|');
      issueBody += Object.entries(body.context).map(([k, v]) => `| ${escPipe(k)} | ${escPipe(v)} |`).join('\n');
      issueBody += `\n\n</details>\n\n`;
    }
    issueBody += `---\n*Filed via [gh-feedback](https://github.com/zeveck/gh-feedback)*`;

    let labels = [TYPE_LABELS[type]];
    if (Array.isArray(body.labels)) {
      for (const l of body.labels) if (typeof l === 'string' && !labels.includes(l)) labels.push(l);
    }
    labels = labels.slice(0, 10);

    let ghRes;
    try {
      ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json', 'User-Agent': 'gh-feedback-proxy/1.0' },
        body: JSON.stringify({ title: body.title, body: issueBody, labels }),
      });
    } catch { return json({ error: 'Failed to reach GitHub API' }, 502, cors); }

    if (ghRes.status === 201) {
      const data = await ghRes.json();
      return json({ issueNumber: data.number, issueUrl: data.html_url }, 201, cors);
    }

    const errors = { 401: 'GitHub token invalid or expired', 403: 'GitHub rate limit exceeded or insufficient permissions',
      404: 'Repository not found — check GITHUB_REPO', 422: 'GitHub rejected the issue — check labels and repo settings' };
    return json({ error: errors[ghRes.status] || 'GitHub API error' }, errors[ghRes.status] ? ghRes.status : 502, cors);
  },
};
