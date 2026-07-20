#!/usr/bin/env node
// Production e2e canary for the user-facing platform.
//
// This intentionally goes through console.freegamestore.online/api/create, not
// the lower-level admin /api/provision endpoint, so it verifies the same auth,
// ownership checks, admin forwarding, repo generation, registry write, host
// route, and first deploy path a creator uses.
//
// It also probes the cheap deterministic production surfaces around that flow:
// auth gates, console APIs, agent health/session/key endpoints, leaderboard,
// sample hosted games, public registry hiding for fixtures, repo visibility,
// and cleanup.
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
const HOST_CLEANUP_TIMEOUT_MS = Number(process.env.FGS_E2E_HOST_CLEANUP_TIMEOUT_MS || 2 * 60_000);
const EXISTING_GAME_ID = process.env.FGS_E2E_EXISTING_GAME_ID || 'tetris';
const SAMPLE_GAME_IDS = (process.env.FGS_E2E_SAMPLE_GAMES || 'tetris,chess,snake,pong,wordle')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const AGENT_ORIGIN = process.env.FGS_AGENT_ORIGIN || `https://agent.${DOMAIN}`;
const LEADERBOARD_ORIGIN = process.env.FGS_LEADERBOARD_ORIGIN || `https://leaderboard.${DOMAIN}`;
const PUBLISH_ORIGIN = process.env.FGS_PUBLISH_ORIGIN || `https://publish.${DOMAIN}`;

function fail(message) {
  throw new Error(message);
}

function assert(value, message) {
  if (!value) fail(message);
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
      'User-Agent': 'fgs-prod-e2e-canary',
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

async function expectStatus(label, url, init, expected, timeoutMs = 30_000) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const { res, text } = await fetchText(url, init, timeoutMs);
  if (!allowed.includes(res.status)) {
    fail(
      `${label} expected HTTP ${allowed.join('/')} but got ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  console.log(`${label}: ${res.status}`);
  return { res, text };
}

async function expectJson(label, url, init, expected, timeoutMs = 30_000) {
  const { res, text } = await expectStatus(label, url, init, expected, timeoutMs);
  return { res, data: parseJson(text, label) };
}

function cookieHeaders(token, extra = {}) {
  return {
    Cookie: `fgs_token=${token}`,
    Origin: CONSOLE_ORIGIN,
    ...extra,
  };
}

function summarizeSteps(data) {
  if (!Array.isArray(data?.steps)) return '';
  return data.steps
    .map((s) => `${s.status || '?'} ${s.name || '?'}: ${s.detail || ''}`)
    .join(' | ');
}

async function verifyPublicSurfaces(id) {
  const home = await expectStatus('store home', STORE_ORIGIN, {}, 200);
  assert(/FreeGameStore/i.test(home.text), 'store home did not render FreeGameStore text');

  const consoleHome = await expectStatus('console home', CONSOLE_ORIGIN, {}, 200);
  assert(
    /FreeGameStore|Create/i.test(consoleHome.text),
    'console home did not render expected app text',
  );

  await expectStatus('publish alias', PUBLISH_ORIGIN, {}, 200);
  await expectStatus('auth /me unauthenticated', `${AUTH_ORIGIN}/me`, {}, 401);
  await expectStatus('console /api/me unauthenticated', `${CONSOLE_ORIGIN}/api/me`, {}, 401);
  await expectStatus(
    'console /api/check-id unauthenticated',
    `${CONSOLE_ORIGIN}/api/check-id?id=${encodeURIComponent(id)}`,
    { headers: { Origin: CONSOLE_ORIGIN } },
    401,
  );
  await expectStatus(
    'console /api/create unauthenticated',
    `${CONSOLE_ORIGIN}/api/create`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: CONSOLE_ORIGIN },
      body: JSON.stringify({ id, name: `Unauth ${id}`, template: 'canvas' }),
    },
    401,
  );
  await expectStatus(
    'admin delete unauthenticated',
    `${ADMIN_ORIGIN}/api/games/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    401,
  );

  const catalog = await expectJson(
    'console /api/catalog',
    `${CONSOLE_ORIGIN}/api/catalog`,
    {},
    200,
  );
  assert(Array.isArray(catalog.data.games), 'console catalog did not return games array');
  assert(
    catalog.data.games.some((g) => g?.id === EXISTING_GAME_ID),
    `console catalog missing ${EXISTING_GAME_ID}`,
  );

  const registry = await expectJson('store registry', `${STORE_ORIGIN}/registry.json`, {}, 200);
  assert(Array.isArray(registry.data.games), 'store registry did not return games array');
  assert(
    registry.data.games.some((g) => g?.id === EXISTING_GAME_ID),
    `store registry missing ${EXISTING_GAME_ID}`,
  );

  const leaderboard = await expectJson(
    'leaderboard read',
    `${LEADERBOARD_ORIGIN}/api/leaderboard/${encodeURIComponent(EXISTING_GAME_ID)}?limit=5`,
    {},
    200,
  );
  assert(
    Array.isArray(leaderboard.data.scores) || Array.isArray(leaderboard.data.leaderboard),
    'leaderboard did not return a score list',
  );

  const agentHealth = await expectJson('agent health', `${AGENT_ORIGIN}/health`, {}, 200);
  assert(agentHealth.data.ok === true, 'agent health did not return ok=true');
  await expectStatus('agent sessions unauthenticated', `${AGENT_ORIGIN}/sessions`, {}, 401);
  await expectStatus('agent key status unauthenticated', `${AGENT_ORIGIN}/v1/keys/status`, {}, 401);
  await expectStatus(
    'agent session status unauthenticated',
    `${AGENT_ORIGIN}/session/${encodeURIComponent(id)}/status`,
    {},
    401,
  );

  for (const game of SAMPLE_GAME_IDS) {
    await expectStatus(
      `host sample ${game}`,
      `https://${game}.${DOMAIN}/`,
      { method: 'GET' },
      [200, 206],
      30_000,
    );
  }
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

async function verifyAuthenticatedSurfaces(token, id) {
  const me = await expectJson(
    'console /api/me authenticated',
    `${CONSOLE_ORIGIN}/api/me`,
    { headers: cookieHeaders(token) },
    200,
  );
  assert(me.data.user, 'console /api/me did not return user');
  assert(
    me.data.creator && Array.isArray(me.data.creator.games),
    'console /api/me did not return creator games',
  );

  await expectCheckId(token, EXISTING_GAME_ID, false, 'existing game id');
  await expectCheckId(token, 'Bad Uppercase Id', false, 'invalid game id');
  await expectCheckId(token, id, true, 'new canary id before create');

  const sessions = await expectJson(
    'agent sessions authenticated',
    `${AGENT_ORIGIN}/sessions`,
    { headers: cookieHeaders(token) },
    200,
  );
  assert(Array.isArray(sessions.data.sessions), 'agent /sessions did not return sessions array');
  assert(typeof sessions.data.totals === 'object', 'agent /sessions did not return totals');

  const keys = await expectJson(
    'agent key status authenticated',
    `${AGENT_ORIGIN}/v1/keys/status`,
    { headers: cookieHeaders(token) },
    200,
  );
  assert(
    Array.isArray(keys.data.providers),
    'agent /v1/keys/status did not return providers array',
  );
}

async function expectCheckId(token, id, available, label) {
  const { data } = await expectJson(
    `console /api/check-id ${label}`,
    `${CONSOLE_ORIGIN}/api/check-id?id=${encodeURIComponent(id)}`,
    { headers: cookieHeaders(token) },
    200,
  );
  assert(
    data.available === available,
    `check-id ${label} expected available=${available}, got ${JSON.stringify(data)}`,
  );
  return data;
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

async function waitForHostGone(id) {
  const url = `https://${id}.${DOMAIN}/`;
  const deadline = Date.now() + HOST_CLEANUP_TIMEOUT_MS;
  let last = 'not checked';
  while (Date.now() < deadline) {
    try {
      const { res, text } = await fetchText(url, { method: 'GET' }, 30_000);
      last = `${res.status} ${text.slice(0, 80).replace(/\s+/g, ' ')}`;
      if (res.status !== 200 && res.status !== 206) {
        console.log(`host cleanup verified: ${url} -> ${res.status}`);
        return;
      }
    } catch (e) {
      console.log(`host cleanup verified: ${url} -> ${e.message}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  fail(`host still served after cleanup within ${HOST_CLEANUP_TIMEOUT_MS}ms: ${url} last=${last}`);
}

async function verifyHiddenFromStore(id) {
  const { data: registry } = await expectJson(
    'store registry fixture exclusion',
    `${STORE_ORIGIN}/registry.json`,
    {},
    200,
    30_000,
  );
  const visible = Array.isArray(registry.games) && registry.games.some((g) => g?.id === id);
  if (visible) {
    fail(`${id} is visible in the public store registry; -test fixture exclusion is not working`);
  }
  console.log('public store fixture exclusion verified');
}

async function verifyCreatorGame(token, id, expected) {
  const { data } = await expectJson(
    `console /api/me creator game ${expected ? 'present' : 'absent'}`,
    `${CONSOLE_ORIGIN}/api/me`,
    { headers: cookieHeaders(token) },
    200,
  );
  const games = data?.creator?.games;
  assert(Array.isArray(games), 'console /api/me creator games is not an array');
  const found = games.some((g) => g?.id === id);
  assert(found === expected, `creator game ${id} expected present=${expected}, got ${found}`);
}

async function verifyGitHubRepo(id, expected) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'fgs-prod-e2e-canary',
  };
  if (RAW_GITHUB_TOKEN.trim()) headers.Authorization = `Bearer ${RAW_GITHUB_TOKEN.trim()}`;
  const { data } = await expectJson(
    `github repo ${expected.archived ? 'archived' : 'active'}`,
    `https://api.github.com/repos/freegamestore-online/${encodeURIComponent(id)}`,
    { headers },
    200,
  );
  assert(data.name === id, `GitHub repo returned wrong name: ${data.name}`);
  assert(data.private === false, `canary game repo ${id} is private; games must stay public`);
  assert(
    data.archived === expected.archived,
    `canary game repo ${id} archived=${data.archived}, expected ${expected.archived}`,
  );
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
  await verifyPublicSurfaces(id);
  await verifyAuthenticatedSurfaces(token, id);

  let attemptedCreate = false;
  let created = false;
  try {
    attemptedCreate = true;
    await createGame(id, token);
    created = true;
    await expectCheckId(token, id, false, 'new canary id after create');
    await verifyCreatorGame(token, id, true);
    await verifyGitHubRepo(id, { archived: false });
    await waitForHost(id);
    await verifyHiddenFromStore(id);
  } finally {
    if (attemptedCreate || process.env.FGS_E2E_ALWAYS_CLEANUP === '1') {
      await cleanup(id, token);
      if (created) {
        await verifyCreatorGame(token, id, false);
        await verifyGitHubRepo(id, { archived: true });
        await waitForHostGone(id);
      }
    }
  }
}

main().catch((e) => {
  console.error(`prod platform e2e failed: ${e?.message || e}`);
  process.exit(1);
});
