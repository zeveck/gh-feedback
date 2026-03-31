# gh-feedback

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

A Web Component that adds a floating feedback button to any website and files GitHub Issues. Zero dependencies, works with any framework or no framework.

See the [interactive configurator](https://gh-feedback.synapticnoise.com/) to try all options and generate your configuration.

## Setup

### 1. Add the component to your page

Copy `gh-feedback.js` into your project and add to your HTML:

```html
<script type="module" src="gh-feedback.js"></script>
<gh-feedback
  repo="https://github.com/you/repo"
  endpoint="https://your-worker.workers.dev/feedback"
></gh-feedback>
```

A hosted copy is also available as a convenience:

```html
<script type="module" src="https://gh-feedback.synapticnoise.com/gh-feedback.js"></script>
```

### 2. Deploy a proxy backend

The component needs a backend to securely file GitHub Issues (so your token stays server-side). See [Proxy Setup](#proxy-mode-setup-recommended) below, or use any backend that accepts the JSON payload.

## Configuration

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `repo` | `string` | — | GitHub repository — either `owner/repo` or a full URL like `https://github.com/owner/repo` (both are normalized). Required. |
| `endpoint` | `string` | — | URL of the proxy endpoint (recommended). Component POSTs JSON here. |
| `token` | `string` | — | GitHub PAT for direct mode. **Warning:** exposed in page source. Use proxy mode in production. |
| `trigger` | `string` | `button` | Trigger style: `button` (inline), `fab` (floating action button), `link` (text link), or `none` (hidden — use `open()`/`toggle()` from your own UI). |
| `icon` | `string` | `memo` | Icon: `chat`, `bug`, `megaphone`, `lightbulb`, `pencil`, `flag`, `memo`, or `none`. |
| `size` | `string` | `md` | Size: `sm`, `md`, `lg`, or a number for pixel size (e.g. `40`). |
| `color` | `string` | `#238636` | Primary color (hex). Sets the FAB, button, and accent color. |
| `position` | `string` | `bottom-right` | FAB corner position: `bottom-right`, `bottom-left`, `top-right`, `top-left`. Only applies when `trigger="fab"`. |
| `theme` | `string` | `light` | Popup color theme: `light` or `dark`. |
| `labels` | `string` | — | Comma-separated labels added to every issue (e.g., `"feedback,user-reported"`). Merged with the type-derived label. |
| `button-text` | `string` | — | Text shown on the trigger. For FAB, makes it pill-shaped. |
| `no-severity` | boolean | — | When present, hides the severity selector. Severity (Low / Medium / High / Critical) is shown by default for bug reports. |
| `border-color` | `string` | — | Border color on the trigger element. |
| `border-width` | `string` | — | Border width in pixels on the trigger element. |
| `border-radius` | `string` | — | Border radius in pixels on the trigger element (overrides default). |
| `popup-color` | `string` | — | Accent color for popup buttons and type pills (independent of trigger `color`). |
| `types` | `string` | `bug,feature,question` | Comma-separated list of category types to show. Available: `bug`, `feature`, `question`, `ui`, `docs`, `performance`. |
| `no-type-icons` | boolean | — | When present, hides icons from the type category pills in the popup. |

## Proxy Mode Setup (Recommended)

The proxy keeps your GitHub token on the server. Users never see it.

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

### 2. Create the worker

Copy the `worker/` directory from this repo into your project, or start fresh:

```bash
mkdir gh-feedback-worker && cd gh-feedback-worker
cp -r /path/to/gh-feedback/worker/* .
npm init -y
```

### 3. Set your GitHub token

Create a **fine-grained** Personal Access Token:

1. Go to [https://github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token**
3. Name it something descriptive, e.g., `gh-feedback-proxy`
4. Under **Repository access**, select **Only select repositories** and choose the repo where issues will be filed
5. Under **Permissions > Repository permissions**, set **Issues** to **Read and Write**
6. Click **Generate token** and copy it

Then store it as a Wrangler secret:

```bash
npx wrangler secret put GITHUB_TOKEN
# Paste the token when prompted
```

### 4. Configure the worker

Open `worker/wrangler.toml` and set these two values:

- **`GITHUB_REPO`** — change to your GitHub repository. Either format works: `"acme/webapp"` or `"https://github.com/acme/webapp"`
- **`ALLOWED_ORIGINS`** — change `"*"` to your website's URL (e.g., `"https://your-site.com"`). During development, include localhost too: `"https://your-site.com,http://localhost:3000"`. The default `*` allows any site to use your worker — restrict this before going live

### 5. Deploy

```bash
cd worker
npx wrangler deploy
```

Wrangler prints the worker URL, e.g., `https://gh-feedback-proxy.your-account.workers.dev`.

### 6. Use it

Add the component to your HTML with the worker URL as the endpoint:

```html
<!-- Both paths work — the worker accepts POST to / and /feedback -->
<gh-feedback repo="https://github.com/you/repo" endpoint="https://gh-feedback-proxy.your-account.workers.dev/feedback"></gh-feedback>
```

### 7. Verify

```bash
curl -X POST https://gh-feedback-proxy.your-account.workers.dev/feedback \
  -H "Content-Type: application/json" \
  -d '{"title": "Test issue from curl", "type": "bug"}'
```

You should get back `{"issueNumber": ..., "issueUrl": "..."}` and see the issue in your GitHub repo.

> **Multi-repo note:** The worker always files issues to the repo configured in `GITHUB_REPO`, regardless of the `repo` attribute on the component. To file to multiple repos, deploy one worker per repo.

## Direct Mode

If you don't want to set up a proxy, you can pass a GitHub token directly:

```html
<gh-feedback repo="https://github.com/you/repo" token="ghp_yourTokenHere"></gh-feedback>
```

> **Warning:** The token is visible in your page source and browser DevTools. Anyone who views your page can extract it and use it to create issues (or worse, if the token has broader permissions). **Only use direct mode for internal tools, localhost development, or pages behind authentication.** For public sites, use proxy mode.

## Alternative Backends

The component POSTs JSON to any URL. The `worker/` template is for Cloudflare Workers, but any backend works. The contract:

```
POST { title, type, severity?, description, labels?, repo?, context? }
→ 201 { issueNumber, issueUrl }
→ 4xx/5xx { error: "message" }
```

Your backend receives this JSON, creates a GitHub Issue using a server-side token, and returns the result. The key requirement is that the endpoint holds the GitHub token server-side — it never reaches the browser.

Any of these work:

- **Vercel Functions** — `api/feedback.js` with `GITHUB_TOKEN` env var
- **Netlify Functions** — `netlify/functions/feedback.js`
- **AWS Lambda** — behind API Gateway
- **Deno Deploy** — single `main.ts` file
- **Express / Flask / Rails** — any traditional server
- **Any serverless platform** — anything that can receive a POST and call the GitHub API

The Cloudflare Worker in `worker/` is a good reference implementation (~80 lines). Adapt it to your platform.

## Theming

The component exposes CSS custom properties that you can override from the host page:

| Property | Light Default | Dark Default | Description |
|----------|---------------|--------------|-------------|
| `--gh-feedback-primary` | `#238636` | `#238636` | Primary/accent color (submit button, FAB) |
| `--gh-feedback-primary-hover` | `#2ea043` | `#2ea043` | Hover state for primary color |
| `--gh-feedback-bg` | `#ffffff` | `#1c2128` | Popup background |
| `--gh-feedback-text` | `#1f2328` | `#e6edf3` | Text color |
| `--gh-feedback-border` | `#d1d9e0` | `#444c56` | Border color |
| `--gh-feedback-input-bg` | `#f6f8fa` | `#22272e` | Input/textarea background |
| `--gh-feedback-error` | `#d1242f` | `#d1242f` | Error message color |
| `--gh-feedback-success` | `#238636` | `#238636` | Success message color |
| `--gh-feedback-fab-bg` | (primary) | (primary) | FAB background (overrides primary for FAB only) |
| `--gh-feedback-fab-text` | `#ffffff` | `#ffffff` | FAB icon/text color |

Override example:

```html
<style>
  gh-feedback {
    --gh-feedback-primary: #6f42c1;
    --gh-feedback-primary-hover: #8250df;
    --gh-feedback-bg: #0d1117;
    --gh-feedback-text: #c9d1d9;
    --gh-feedback-border: #30363d;
    --gh-feedback-input-bg: #161b22;
  }
</style>
<gh-feedback repo="https://github.com/you/repo" endpoint="..." theme="dark"></gh-feedback>
```

## Events

| Event | Detail | Cancelable | Description |
|-------|--------|------------|-------------|
| `gh-feedback:submit` | `{ title, type, description, labels, repo }` | Yes | Fires before submission. Call `preventDefault()` to cancel the request. |
| `gh-feedback:filed` | `{ issueNumber, issueUrl }` | No | Fires after the issue is successfully created. |
| `gh-feedback:error` | `{ error }` | No | Fires when submission fails. `error` contains the message shown to the user. |

Listener example:

```js
document.querySelector('gh-feedback').addEventListener('gh-feedback:filed', (e) => {
  console.log(`Issue #${e.detail.issueNumber} created: ${e.detail.issueUrl}`);
});
```

Intercept and cancel submission:

```js
document.querySelector('gh-feedback').addEventListener('gh-feedback:submit', (e) => {
  if (!confirm('File this issue?')) {
    e.preventDefault(); // Submission is cancelled
  }
});
```

## Programmatic Control

Use `trigger="none"` to hide the built-in button and control the popup from your own UI:

```html
<button onclick="document.querySelector('gh-feedback').open()">Report Issue</button>
<gh-feedback trigger="none" repo="owner/repo" endpoint="https://your-worker.workers.dev/feedback"></gh-feedback>
```

Methods:
- `element.open()` — open the feedback popup
- `element.close()` — close the popup
- `element.toggle()` — toggle open/closed

## Context Capture

Attach runtime context to every issue by setting the `getContext` property:

```js
const fb = document.querySelector('gh-feedback');
fb.getContext = () => ({
  page: location.href,
  version: APP_VERSION,
  user: currentUser.email
});
```

The returned object is included as a collapsible details section in the GitHub issue body, and sent as `context` in the proxy payload.

## TypeScript

Type definitions are included in `gh-feedback.d.ts`. Event listeners are fully typed:

```ts
import type { GhFeedback, SubmitDetail, FiledDetail, ErrorDetail } from './gh-feedback';

const fb = document.querySelector('gh-feedback')!;

fb.addEventListener('gh-feedback:filed', (e) => {
  console.log(e.detail.issueNumber); // number
});

fb.addEventListener('gh-feedback:error', (e) => {
  console.error(e.detail.error); // string
});
```

Exported types: `FeedbackType`, `Severity`, `TriggerStyle`, `Position`, `Theme`, `IconName`, `Size`, `SubmitDetail`, `FiledDetail`, `ErrorDetail`, `GhFeedbackEventMap`.

## Examples

### Minimal

```html
<script type="module" src="./gh-feedback.js"></script>
<gh-feedback repo="https://github.com/you/repo" endpoint="https://your-worker.workers.dev/feedback"></gh-feedback>
```

### Dark theme with custom position

```html
<gh-feedback
  repo="https://github.com/you/repo"
  endpoint="https://your-worker.workers.dev/feedback"
  theme="dark"
  position="bottom-left"
></gh-feedback>
```

### With default labels and custom button text

```html
<gh-feedback
  repo="https://github.com/you/repo"
  endpoint="https://your-worker.workers.dev/feedback"
  labels="feedback,user-reported"
  button-text="Send Feedback"
></gh-feedback>
```

### Framework integration

**React:**

```jsx
import { useEffect, useRef } from 'react';
import './gh-feedback.js';

function App() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const handler = (e) => console.log('Filed:', e.detail);
    el.addEventListener('gh-feedback:filed', handler);
    return () => el.removeEventListener('gh-feedback:filed', handler);
  }, []);

  return (
    <gh-feedback
      ref={ref}
      repo="https://github.com/you/repo"
      endpoint="https://your-worker.workers.dev/feedback"
    />
  );
}
```

**Vue:**

```vue
<script setup>
import { onMounted, ref } from 'vue';
import './gh-feedback.js';

const feedbackEl = ref(null);

onMounted(() => {
  feedbackEl.value.addEventListener('gh-feedback:filed', (e) => {
    console.log('Filed:', e.detail);
  });
});
</script>

<template>
  <gh-feedback
    ref="feedbackEl"
    repo="https://github.com/you/repo"
    endpoint="https://your-worker.workers.dev/feedback"
  />
</template>
```

## Content Security Policy

If your site uses a strict Content Security Policy, add the proxy endpoint URL to `connect-src`:

```
Content-Security-Policy: connect-src 'self' https://your-worker.workers.dev;
```

Shadow DOM `<style>` elements are CSP-exempt in modern browsers, so no `style-src` changes are needed for the component's styles.

## Security

The component supports two modes for creating GitHub Issues:

- **Proxy mode** (recommended): Your GitHub token stays on the Cloudflare Worker server. The browser only communicates with your worker, which validates the request and forwards it to GitHub. The token is never sent to the client.
- **Direct mode**: The GitHub token is set as an HTML attribute, which means it is visible in the page source and accessible via JavaScript. Anyone who can view your page can extract the token. Only use direct mode for internal tools or pages behind authentication.

Always use proxy mode for public-facing sites.

## Browser Support

Custom Elements v1 is supported in all modern browsers:

- Chrome 67+
- Firefox 63+
- Safari 10.1+
- Edge 79+

## Development

Run the unit tests (worker):

```bash
npm install
npm test
```

Run the Playwright E2E tests:

```bash
npx playwright install --with-deps chromium
npx playwright test
```

Run all tests:

```bash
npm run test:all
```

## License

[MIT](./LICENSE)
