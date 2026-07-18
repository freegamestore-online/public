#!/usr/bin/env node
// Production canary for the user-facing game creation path.
//
// This intentionally goes through console.freegamestore.online/api/create, not
// the lower-level admin /api/provision endpoint, so it verifies the same auth,
// ownership checks, admin forwarding, repo generation, registry write, host
// route, and first deploy path a creator uses.
//
// Required env:
//   FGS_E2E_GITHUB_TOKEN  A low-privilege canary creator GitHub token. The
//                         auth worker exchanges it for a fresh fgs_token.
//
// Fallback env:
//   FGS_E2E_TOKEN         A raw fgs_token or full "fgs_token=..." cookie value.

const DOMAIN = process.env.FGS_DOMAIN || 'freegamestore.online';
const CONSOLE_ORIGIN = process.env.FGS_CONSOLE_ORIGIN || `https://console.${DOMAIN}`;
const ADMIN_ORIGIN = process.env.FGS_ADMIN_ORIGIN || `https://admin.${DOMAIN}`;
const AUTH_ORIGIN = process.env.FGS_AUTH_ORIGIN || `https://auth.${DOMAIN}`;
const STORE_ORIGIN = process.env.FGS_STORE_ORIGIN || `https://${DOMAIN}`;
const RAW_TOKEN = process.env.FGS_E2E_TOKEN || '';
const RAW_GITHUB_TOKEN =
  process.env.FGS_E2E_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const POLL_MS = Number(process.env.FGS_E2E_POLL_MS || 15_000);
const HOST_TIMEOUT_MS = Number(process.env.FGS_E2E_HOST_TIMEOUT_MS || 10 * 60_000);

function fail(message) {
  throw new Error(message);
}

function tokenFromSecret(raw) {
  const value = raw.trim();
  if (!value) return '';
  const match = value.match(/(?:^|;\s*)fgs_token=([^;]+)/);
  return match ? match[1] : value;
}

async function tokenFromGitHubToken(raw) {
  const githubToken = raw.trim();
  if (!githubToken) return '';
  const { res, text } = await fetchText(
    `${AUTH_ORIGIN}/v1/token/github`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
      },
    },
    30_000,
  );
  const data = parseJson(text, 'auth /v1/token/github');
  if (!res.ok || !data.token) {
    fail(`GitHub token exchange failed (${res.status}): ${data.error || text.slice(0, 300)}`);
  }
  console.log(`exchanged GitHub token for FGS token: ${data.login}`);
  return data.token;
}

function canaryId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-create-${stamp}-${rand}-test`;
}

function assertSafeCanaryId(id) {
  if (!/^e2e-create-[a-z0-9-]+-test$/.test(id)) {
    fail(`unsafe canary id "${id}"; FGS_E2E_GAME_ID must match e2e-create-*-test`);
  }
}

async function fetchText(url, init = {}, timeoutMs = 60_000) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'fgs-prod-create-canary',
      ...(init.headers || {}),
    },
  });
  const text = await res.text().catch(() => '');
  return { res, text };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} returned non-JSON: ${text.slice(0, 500)}`);
  }
}

function summarizeSteps(data) {
  if (!Array.isArray(data?.steps)) return '';
  return data.steps
    .map((s) => `${s.status || '?'} ${s.name || '?'}: ${s.detail || ''}`)
    .join(' | ');
}

async function verifyToken(token) {
  const { res, text } = await fetchText(
    `${AUTH_ORIGIN}/me`,
    {
      headers: { 'X-FGS-Token': token },
    },
    30_000,
  );
  if (!res.ok) {
    fail(`FGS_E2E_TOKEN is not accepted by auth /me (${res.status}): ${text.slice(0, 300)}`);
  }
  const me = parseJson(text, 'auth /me');
  if (!me.login) {
    fail('FGS_E2E_TOKEN must be a GitHub-login token; auth /me returned no login claim');
  }
  console.log(`canary creator: ${me.login}`);
  return me.login;
}

async function createGame(id, token) {
  const payload = {
    id,
    name: `Create Canary ${id}`,
    category: 'platform',
    icon: 'T',
    iconBg: '#ecfdf5',
    description:
      'Automated production creation canary. Hidden from the public store by the -test suffix.',
    template: 'canvas',
  };
  const { res, text } = await fetchText(
    `${CONSOLE_ORIGIN}/api/create`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: CONSOLE_ORIGIN,
        Cookie: `fgs_token=${token}`,
      },
      body: JSON.stringify(payload),
    },
    120_000,
  );
  const data = parseJson(text, 'console /api/create');
  if (!res.ok || data.success !== true) {
    fail(
      `create failed (${res.status}): ${data.error || summarizeSteps(data) || text.slice(0, 500)}`,
    );
  }
  console.log(`created ${id}: ${summarizeSteps(data)}`);
  return data;
}

async function waitForHost(id) {
  const url = `https://${id}.${DOMAIN}/`;
  const deadline = Date.now() + HOST_TIMEOUT_MS;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const { res, text } = await fetchText(url, { method: 'GET' }, 30_000);
      last = `${res.status} ${text.slice(0, 80).replace(/\s+/g, ' ')}`;
      if (res.status === 200 || res.status === 206) {
        console.log(`host live: ${url} -> ${res.status}`);
        return;
      }
    } catch (e) {
      last = e.message;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  fail(`host did not become live within ${HOST_TIMEOUT_MS}ms: ${url} last=${last}`);
}

async function verifyHiddenFromStore(id) {
  const { res, text } = await fetchText(`${STORE_ORIGIN}/registry.json`, {}, 30_000);
  if (!res.ok) {
    console.warn(
      `warning: could not verify public registry (${res.status}): ${text.slice(0, 200)}`,
    );
    return;
  }
  const registry = parseJson(text, 'store registry');
  const visible = Array.isArray(registry.games) && registry.games.some((g) => g?.id === id);
  if (visible) {
    fail(`${id} is visible in the public store registry; -test fixture exclusion is not working`);
  }
  console.log('public store fixture exclusion verified');
}

async function cleanup(id, token) {
  const { res, text } = await fetchText(
    `${ADMIN_ORIGIN}/api/games/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'X-FGS-Token': token },
    },
    60_000,
  );
  if (res.status === 404) {
    console.warn(`cleanup warning: ${id} not found`);
    return;
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* best effort */
  }
  if (!res.ok || data?.error) {
    console.warn(
      `cleanup warning: DELETE returned ${res.status}: ${(data?.error || text).slice(0, 500)}`,
    );
    return;
  }
  console.log(`cleanup ok: ${id} delisted, route removed, repo archived`);
}

async function main() {
  const token = tokenFromSecret(RAW_TOKEN) || (await tokenFromGitHubToken(RAW_GITHUB_TOKEN));
  if (!token) {
    fail(
      'FGS_E2E_GITHUB_TOKEN is required. Store a low-privilege canary creator GitHub token as a GitHub Actions secret.',
    );
  }

  await verifyToken(token);
  const id = process.env.FGS_E2E_GAME_ID || canaryId();
  assertSafeCanaryId(id);
  console.log(`canary id: ${id}`);

  let attemptedCreate = false;
  try {
    attemptedCreate = true;
    await createGame(id, token);
    await waitForHost(id);
    await verifyHiddenFromStore(id);
  } finally {
    if (attemptedCreate || process.env.FGS_E2E_ALWAYS_CLEANUP === '1') {
      await cleanup(id, token);
    }
  }
}

main().catch((e) => {
  console.error(`prod create canary failed: ${e?.message || e}`);
  process.exit(1);
});
