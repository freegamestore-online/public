#!/usr/bin/env node
// Production browser e2e for the creator console.
//
// This test drives the real production UI in Chromium. It intentionally blocks
// the first agent chat request after create, so the test proves the initial
// prompt injection is attempted without spending model quota or waiting on LLM
// nondeterminism. The API canary covers the lower-level create/deploy/cleanup
// plumbing in more detail.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const DOMAIN = process.env.FGS_DOMAIN || 'freegamestore.online';
const CONSOLE_ORIGIN = process.env.FGS_CONSOLE_ORIGIN || `https://console.${DOMAIN}`;
const AUTH_ORIGIN = process.env.FGS_AUTH_ORIGIN || `https://auth.${DOMAIN}`;
const ADMIN_ORIGIN = process.env.FGS_ADMIN_ORIGIN || `https://admin.${DOMAIN}`;
const AGENT_ORIGIN = process.env.FGS_AGENT_ORIGIN || `https://agent.${DOMAIN}`;
const RAW_GITHUB_TOKEN =
  process.env.FGS_E2E_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const RAW_TOKEN = process.env.FGS_E2E_TOKEN || '';
const HEADLESS = process.env.FGS_E2E_HEADED !== '1';
const SLOW_MO = Number(process.env.FGS_E2E_SLOW_MO_MS || (HEADLESS ? 0 : 350));
const POLL_MS = Number(process.env.FGS_E2E_POLL_MS || 15_000);
const HOST_TIMEOUT_MS = Number(process.env.FGS_E2E_HOST_TIMEOUT_MS || 10 * 60_000);
const ARTIFACT_DIR = process.env.FGS_E2E_ARTIFACT_DIR || 'test-results/prod-browser-e2e';

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

function canaryId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-create-${stamp}-${rand}-test`;
}

async function fetchText(url, init = {}, timeoutMs = 60_000) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'fgs-prod-browser-e2e',
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
  console.log(`browser e2e creator: ${data.login}`);
  return data.token;
}

function cookieHeaders(token, extra = {}) {
  return {
    Cookie: `fgs_token=${token}`,
    Origin: CONSOLE_ORIGIN,
    ...extra,
  };
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
        console.log(`browser e2e host live: ${url} -> ${res.status}`);
        return { url, status: res.status };
      }
    } catch (e) {
      last = e.message;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  fail(`host did not become live within ${HOST_TIMEOUT_MS}ms: ${url} last=${last}`);
}

async function cleanupGame(id, token) {
  const consoleDelete = await fetchText(
    `${CONSOLE_ORIGIN}/api/games/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: cookieHeaders(token),
    },
    60_000,
  );
  let consoleData = null;
  try {
    consoleData = JSON.parse(consoleDelete.text || '{}');
  } catch {
    consoleData = { error: consoleDelete.text.slice(0, 500) };
  }
  if (consoleDelete.res.ok && consoleData?.ok === true) {
    console.log(`browser e2e cleanup ok: ${id}`);
    return;
  }

  console.warn(
    `browser e2e cleanup warning: console DELETE ${consoleDelete.res.status}: ${consoleDelete.text.slice(0, 500)}`,
  );
  const adminDelete = await fetchText(
    `${ADMIN_ORIGIN}/api/games/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { 'X-FGS-Token': token },
    },
    60_000,
  );
  console.warn(
    `browser e2e cleanup fallback: admin DELETE ${adminDelete.res.status}: ${adminDelete.text.slice(0, 300)}`,
  );
}

async function saveScreenshot(page, name) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const file = path.join(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  console.log(`screenshot: ${file}`);
}

async function saveDebug(page, name, detail) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const body = await page
    .locator('body')
    .innerText({ timeout: 3000 })
    .catch(() => '');
  await writeFile(
    path.join(ARTIFACT_DIR, `${name}.txt`),
    [`url=${page.url()}`, detail || '', '', body].join('\n'),
  );
  await saveScreenshot(page, name);
}

async function main() {
  const token = tokenFromSecret(RAW_TOKEN) || (await tokenFromGitHubToken(RAW_GITHUB_TOKEN));
  if (!token) {
    fail('FGS_E2E_GITHUB_TOKEN or FGS_E2E_TOKEN is required for prod browser e2e');
  }

  const id = process.env.FGS_E2E_GAME_ID || canaryId();
  if (!/^e2e-create-[a-z0-9-]+-test$/.test(id)) {
    fail(`unsafe canary id "${id}"; FGS_E2E_GAME_ID must match e2e-create-*-test`);
  }
  const name = `Browser Canary ${id}`;
  console.log(`browser e2e id: ${id}`);

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.addCookies([
    {
      name: 'fgs_token',
      value: token,
      domain: '.freegamestore.online',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  let initialPromptAttempted = false;
  await context.route(`${AGENT_ORIGIN}/session/**/chat`, async (route) => {
    initialPromptAttempted = true;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'blocked by prod browser e2e to avoid model spend' }),
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.setDefaultTimeout(45_000);

  let created = false;
  try {
    await page.addInitScript(() => {
      localStorage.setItem('fgs_provider', 'github');
      localStorage.setItem('fgs_model', 'openai/gpt-4.1-mini');
    });

    await page.goto(`${CONSOLE_ORIGIN}/create`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await saveScreenshot(page, '01-studio-open');

    if (
      !(await page
        .getByLabel('Game Name')
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByRole('button', { name: /^New Game$/ }).click();
    }
    await page.getByLabel('Game Name').waitFor({ state: 'visible' });
    await page.getByLabel('Game Name').fill(name);
    await page.getByLabel('Game address').fill(id);
    await page.getByLabel('One-line Description').fill('Production browser e2e canary game.');
    await page
      .getByLabel('First AI Prompt')
      .fill('Build a tiny playable browser game with controls, score, restart, and deploy it.');
    await page.getByLabel('Raw Canvas').check();
    await saveScreenshot(page, '02-create-form-filled');

    const createResponsePromise = page.waitForResponse(
      (resp) => resp.url() === `${CONSOLE_ORIGIN}/api/create` && resp.request().method() === 'POST',
      { timeout: 130_000 },
    );
    const submit = page.locator('form').getByRole('button', { name: /^Create Game$/ });
    await submit.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('form button')].find(
        (el) => el.textContent?.trim() === 'Create Game',
      );
      return !!button && !button.disabled;
    });
    await submit.click();

    const createResponse = await createResponsePromise;
    const createText = await createResponse.text();
    const createData = parseJson(createText, 'browser console /api/create');
    if (!createResponse.ok() || createData.success !== true) {
      fail(
        `browser create failed (${createResponse.status()}): ${
          createData.error || createText.slice(0, 500)
        }`,
      );
    }
    created = true;
    console.log('browser e2e create response ok');

    await page.waitForURL(`**/create/${id}`, { timeout: 45_000 });
    await saveScreenshot(page, '03-studio-created-game');

    for (let i = 0; i < 60 && !initialPromptAttempted; i++) {
      await page.waitForTimeout(1000);
    }
    assert(initialPromptAttempted, 'initial AI prompt was not attempted after UI create');
    console.log('browser e2e initial prompt injection attempted');

    const live = await waitForHost(id);
    await page.goto(live.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await saveScreenshot(page, '04-live-game');
    assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
  } catch (e) {
    await saveDebug(page, 'failure', e?.message || String(e));
    throw e;
  } finally {
    if (created || process.env.FGS_E2E_ALWAYS_CLEANUP === '1') {
      await cleanupGame(id, token);
    }
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`prod browser e2e failed: ${e?.message || e}`);
  process.exit(1);
});
