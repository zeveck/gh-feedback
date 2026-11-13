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

### 2. Choose how reports reach GitHub

- **Link mode** (no server): leave out `endpoint` and `token`. Submit opens GitHub's new-issue page, pre-filled, and the reporter files it from their own GitHub account. See [Link Mode](#link-mode-no-server).
- **Proxy mode** (recommended for public sites): a small backend files the issue for the reporter, who needs no GitHub account, and your token stays server-side. See [Proxy Setup](#proxy-mode-setup-recommended) below, or use any backend that accepts the JSON payload.
- **Direct mode**: a token in the page. For internal tools only. See [Direct Mode](#direct-mode).

## Configuration

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `repo` | `string` | — | GitHub repository — either `owner/repo` or a full URL like `https://github.com/owner/repo` (both are normalized). Required. |
| `endpoint` | `string` | — | URL of the proxy endpoint (recommended). Component POSTs JSON here. |
| `mode` | `string` | auto | `link`, `proxy` or `direct`. If unset: `endpoint` → proxy, `token` → direct, neither → link. |
| `template` | `string` | — | Link mode: issue template or form to open, e.g. `bug.yml` (a file in the repo's `.github/ISSUE_TEMPLATE/`). |
| `template-field` | `string` | `description` for forms, else `body` | Link mode: the URL parameter that carries the report. For a YAML issue form, the `id` of its textarea (GitHub ignores `body=` for forms). |
| `token` | `string` | — | GitHub PAT for direct mode. **Warning:** exposed in page source. Use proxy mode in production. |
| `trigger` | `string` | `button` | Trigger style: `button` (inline), `fab` (floating action button), `link` (text link), or `none` (hidden — use `open()`/`toggle()` from your own UI). |
| `icon` | `string` | `memo` | Icon: `chat`, `bug`, `megaphone`, `lightbulb`, `pencil`, `flag`, `memo`, or `none`. |
| `size` | `string` | `md` | Size: `sm`, `md`, `lg`, or a number for pixel size (e.g. `40`). |
| `color` | `string` | `#238636` | Primary color (hex). Sets the FAB, button, and accent color. |
| `position` | `string` | `bottom-right` | FAB corner position: `bottom-right`, `bottom-left`, `top-right`, `top-left`. Only applies when `trigger="fab"`. |
| `theme` | `string` | `light` | Popup color theme: `light` or `dark`. |
| `labels` | `string` | — | Comma-separated labels added to every issue (e.g., `"feedback,user-reported"`). Merged with the type-derived label. Proxy and direct modes only: in link mode, put labels in the issue form. |
| `button-text` | `string` | — | Text shown on the trigger. For FAB, makes it pill-shaped. |
| `no-severity` | boolean | — | When present, hides the severity selector. Severity (Low / Medium / High / Critical) is shown by default for bug reports. |
| `border-color` | `string` | — | Border color on the trigger element. |
| `border-width` | `string` | — | Border width in pixels on the trigger element. |
| `border-radius` | `string` | — | Border radius in pixels on the trigger element (overrides default). |
| `popup-color` | `string` | — | Accent color for popup buttons and type pills. Defaults to the trigger `color`. |
| `types` | `string` | `bug,feature,question` | Comma-separated list of category types to show. Available: `bug`, `feature`, `question`, `ui`, `docs`, `performance`. |
| `no-type-icons` | boolean | — | When present, hides icons from the type category pills in the popup. |

## Proxy Mode Setup (Recommended)

The proxy keeps your GitHub token on the server. Users never see it. The included backend runs on [Cloudflare Workers](https://workers.cloudflare.com/) (free tier) and deploys with [Wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare's CLI tool.

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

### 2. Log in to Cloudflare

[Wrangler](https://developers.cloudflare.com/workers/wrangler/) is the CLI for Cloudflare Workers. You don't need to install it separately — `npx` runs it directly. Log in to connect it to your Cloudflare account:

```bash
npx wrangler login
```

This opens your browser for authentication. Once approved, Wrangler stores your credentials locally.

### 3. Create the worker

Copy the `worker/` directory from this repo into your project, or start fresh:

```bash
mkdir gh-feedback-worker && cd gh-feedback-worker
cp -r /path/to/gh-feedback/worker/* .
npm init -y
```

### 4. Configure the worker

Open `wrangler.toml` and set these two values:

- **`GITHUB_REPO`** — change to your GitHub repository. Either format works: `"acme/webapp"` or `"https://github.com/acme/webapp"`
- **`ALLOWED_ORIGINS`** — change `"*"` to your website's URL (e.g., `"https://your-site.com"`). During development, include localhost too: `"https://your-site.com,http://localhost:3000"`. The default `*` allows any site to use your worker — restrict this before going live

### 5. Create a GitHub token

Create a **fine-grained** Personal Access Token:

1. Go to [https://github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token**
3. Name it something descriptive, e.g., `gh-feedback-proxy`
4. Under **Repository access**, select **Only select repositories** and choose the repo where issues will be filed
5. Under **Permissions > Repository permissions**, set **Issues** to **Read and Write**
6. Click **Generate token** and copy it

Then store it as a secret in your worker (secrets are encrypted and never appear in plain text). Run this from the worker directory created in step 3:

```bash
npx wrangler secret put GITHUB_TOKEN
# Paste the token when prompted
```

### 6. Deploy

```bash
npx wrangler deploy
```

Wrangler prints the worker URL, e.g., `https://gh-feedback-proxy.your-account.workers.dev`.

### 7. Use it

Add the component to your HTML with the worker URL as the endpoint:

```html
<!-- Both paths work — the worker accepts POST to / and /feedback -->
<gh-feedback repo="https://github.com/you/repo" endpoint="https://gh-feedback-proxy.your-account.workers.dev/feedback"></gh-feedback>
```

### 8. Verify

```bash
curl -X POST https://gh-feedback-proxy.your-account.workers.dev/feedback \
  -H "Content-Type: application/json" \
  -d '{"title": "Test issue from curl", "type": "bug"}'
```

You should get back `{"issueNumber": ..., "issueUrl": "..."}` and see the issue in your GitHub repo.

> **Multi-repo note:** The worker always files issues to the repo configured in `GITHUB_REPO`, regardless of the `repo` attribute on the component. To file to multiple repos, deploy one worker per repo.

## Link Mode (no server)

With no `endpoint` and no `token` (or with `mode="link"`), Submit doesn't send anything. Instead it:

1. copies the page's screenshot to the clipboard, if the page gives one (see [Screenshots](#screenshots));
2. opens GitHub's new-issue page in a new tab, pre-filled with the title, type, severity, description and context;
3. tells the reporter to paste the screenshot into the issue (Ctrl/Cmd+V), or offers it as a download if copying isn't possible.

```html
<gh-feedback repo="https://github.com/you/repo" template="bug.yml"></gh-feedback>
```

Things to know:

- **The reporter needs a GitHub account** and files the issue as themselves. For reporters without one, use proxy mode.
- **Labels come from the issue form,** not the `labels` attribute: GitHub ignores labels in a new-issue link unless the reporter can already label issues in the repo, but it always applies an issue form's `labels:`. Copy [`examples/ISSUE_TEMPLATE/bug.yml`](examples/ISSUE_TEMPLATE/bug.yml) to `.github/ISSUE_TEMPLATE/bug.yml` in your repo and set `template="bug.yml"`. Its labels must already exist in the repo.
- **Long reports are trimmed** to keep the link under GitHub's length limit (about 6 KB): the longest context values are shortened first, then context rows dropped, then the description shortened, marked "(trimmed)".
- **No server, no secret, no CSP changes:** nothing is fetched. If the browser blocks the new tab, the popup shows a link instead.
- `gh-feedback:opened` fires with `{ url, opened, screenshotCopied }` (there's no issue number yet, so `gh-feedback:filed` doesn't fire).

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
| `gh-feedback:submit` | `{ title, type, description, labels, repo, mode, severity?, url? }` | Yes | Fires before submission. Call `preventDefault()` to cancel the request. In link mode, `url` is the new-issue link about to open. |
| `gh-feedback:filed` | `{ issueNumber, issueUrl }` | No | Fires after the issue is successfully created (proxy and direct modes). |
| `gh-feedback:opened` | `{ url, opened, screenshotCopied }` | No | Link mode: fires after GitHub's new-issue page was opened (`opened` is false if the browser blocked the tab). |
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

## Screenshots

In link mode, set `getScreenshot` to a function that returns an image of the page: a `Blob`, a `data:image/...` URL, or a Promise of either (or `null` for none).

```js
// e.g. a game drawing to a canvas
fb.getScreenshot = () => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
```

- It's called **when the popup opens**, before the popup is drawn, so it captures what the reporter was looking at.
- The popup shows a thumbnail with a **Remove** button.
- On Submit, the image is copied to the clipboard as PNG (other formats are converted), for the reporter to paste into the issue. GitHub hosts pasted images itself, so no storage is needed.
- A WebGL canvas only keeps its pixels until the next frame, so capture it right after drawing, or create the context with `preserveDrawingBuffer: true`.
- Proxy and direct modes don't call it yet.

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

The component supports three modes for creating GitHub Issues:

- **Proxy mode** (recommended): Your GitHub token stays on the Cloudflare Worker server. The browser only communicates with your worker, which validates the request and forwards it to GitHub. The token is never sent to the client.
- **Direct mode**: The GitHub token is set as an HTML attribute, which means it is visible in the page source and accessible via JavaScript. Anyone who can view your page can extract the token. Only use direct mode for internal tools or pages behind authentication.

- **Link mode**: no token anywhere. The reporter files the issue from their own GitHub account, so it's safe on any site.

For public sites, use proxy mode (reporters need no GitHub account) or link mode (they do). Never use direct mode on a public site.

## Browser Support

Custom Elements v1 is supported in all modern browsers:

- Chrome 67+
- Firefox 63+
- Safari 10.1+
- Edge 79+

Link mode's screenshot copy uses `ClipboardItem` with PNG images (Chrome 76+, Edge 79+, Firefox 127+, Safari 13.1+). Where that's missing, the reporter is offered the screenshot as a download instead.

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
