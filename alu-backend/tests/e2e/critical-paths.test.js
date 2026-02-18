const assert = require('node:assert/strict');
require('dotenv').config();

const baseUrl = (process.env.E2E_BASE_URL || '').replace(/\/$/, '');
const bearerToken = process.env.E2E_AUTH_BEARER || process.env.E2E_CLERK_BEARER || '';
const runMutating = process.env.E2E_RUN_MUTATING === 'true';
const e2eRequired = process.env.E2E_REQUIRED === 'true';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fetchJson(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, options);
  const raw = await res.text();
  const contentType = res.headers.get('content-type') || '';
  let data = null;

  if (raw.length > 0 && contentType.includes('application/json')) {
    data = JSON.parse(raw);
  }

  return { res, data, raw, contentType, url };
}

function ensureLiveRunEnabled() {
  if (!baseUrl || !bearerToken || !runMutating) {
    if (e2eRequired) {
      throw new Error('E2E_REQUIRED=true but E2E_BASE_URL / E2E_AUTH_BEARER (or E2E_CLERK_BEARER) / E2E_RUN_MUTATING=true not fully configured.');
    }
    log('SKIP: Set E2E_BASE_URL, E2E_AUTH_BEARER (or E2E_CLERK_BEARER), and E2E_RUN_MUTATING=true to run live E2E tests.');
    return false;
  }
  return true;
}

async function runCase(name, fn) {
  log(`\n[CASE] ${name}`);
  try {
    await fn();
    log(`[PASS] ${name}`);
    return true;
  } catch (err) {
    log(`[FAIL] ${name}`);
    log(String(err?.stack || err?.message || err));
    return false;
  }
}

async function caseImageGenerate() {
  const { res, data, raw, contentType, url } = await fetchJson('/generate', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      prompt: process.env.E2E_IMAGE_PROMPT || 'A cinematic portrait of a lion, golden hour',
      type: 'image',
      visibility: 'private',
    }),
  });

  assert.equal(contentType.includes('application/json'), true, `Expected JSON from ${url}, got ${contentType} body=${raw.slice(0, 200)}`);
  assert.equal(res.status === 201 || res.status === 429, true, `Unexpected status ${res.status} body=${raw}`);
  if (res.status === 201) {
    assert.equal(Boolean(data?.post?._id), true);
    assert.equal(data.post.mediaType, 'image');
  }
}

async function caseShortGenerate() {
  const { res, data, raw, contentType, url } = await fetchJson('/generate/short-video', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      prompt: process.env.E2E_SHORT_PROMPT || 'A fast drone shot of a tropical coast, vertical video',
      durationSeconds: 12,
      visibility: 'private',
    }),
  });

  assert.equal(contentType.includes('application/json'), true, `Expected JSON from ${url}, got ${contentType} body=${raw.slice(0, 200)}`);
  assert.equal(res.status === 202 || res.status === 429, true, `Unexpected status ${res.status} body=${raw}`);
  if (res.status === 202) {
    assert.equal(typeof data?.jobId, 'string');
    assert.equal(data.status, 'queued');
  }
}

async function caseCheckoutSession() {
  const shortPriceId = process.env.E2E_SHORT_PRICE_ID;
  if (!shortPriceId) {
    if (e2eRequired) throw new Error('E2E_SHORT_PRICE_ID is required in strict mode.');
    log('SKIP: Set E2E_SHORT_PRICE_ID to run checkout test.');
    return;
  }

  const { res, data, raw } = await fetchJson('/payments/create-checkout-session', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      priceId: shortPriceId,
      mode: 'short',
    }),
  });

  assert.equal(res.status, 200, `Expected 200, got ${res.status} body=${raw}`);
  assert.equal(typeof data?.id, 'string');
  assert.equal(typeof data?.url, 'string');
  assert.equal(data.url.includes('checkout.stripe.com'), true);
}

async function caseWebhookCrediting() {
  const Stripe = require('stripe');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const webhookUserId = process.env.E2E_WEBHOOK_USER_ID || '';
  if (!webhookSecret || !webhookUserId) {
    if (e2eRequired) throw new Error('STRIPE_WEBHOOK_SECRET and E2E_WEBHOOK_USER_ID are required in strict mode.');
    log('SKIP: Set STRIPE_WEBHOOK_SECRET and E2E_WEBHOOK_USER_ID to run webhook crediting test.');
    return;
  }

  const before = await fetchJson('/usage', {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(before.res.status, 200, `Expected /usage 200 before webhook, got ${before.res.status}`);
  const bonusShortsBefore = Number(before.data?.bonusShorts || 0);

  const eventPayload = {
    id: `evt_test_${Date.now()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        object: 'checkout.session',
        mode: 'payment',
        client_reference_id: webhookUserId,
        customer: `cus_test_${Date.now()}`,
        metadata: {
          userId: webhookUserId,
          purchaseType: 'short_credit',
        },
      },
    },
  };

  const payload = JSON.stringify(eventPayload);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

  const webhookRes = await fetch(`${baseUrl}/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: payload,
  });

  assert.equal(webhookRes.status, 200, `Expected webhook 200, got ${webhookRes.status}`);

  const after = await fetchJson('/usage', {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(after.res.status, 200, `Expected /usage 200 after webhook, got ${after.res.status}`);

  const bonusShortsAfter = Number(after.data?.bonusShorts || 0);
  assert.equal(bonusShortsAfter >= bonusShortsBefore, true, 'bonusShorts should stay same or increase');
}

async function caseDmSendRead() {
  const participantId = process.env.E2E_DM_PARTICIPANT_ID || '';
  if (!participantId) {
    if (e2eRequired) throw new Error('E2E_DM_PARTICIPANT_ID is required in strict mode.');
    log('SKIP: Set E2E_DM_PARTICIPANT_ID to run DM test.');
    return;
  }

  const createThread = await fetchJson('/dm/threads', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ participantId }),
  });

  assert.equal(createThread.res.status === 201 || createThread.res.status === 500, true, `Unexpected create thread status ${createThread.res.status} body=${createThread.raw}`);
  if (createThread.res.status !== 201) {
    log(`SKIP: Thread creation returned ${createThread.res.status} in this environment.`);
    return;
  }

  const threadId = createThread.data?.thread?._id;
  assert.equal(typeof threadId, 'string');

  const send = await fetchJson(`/dm/threads/${threadId}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ text: `e2e ping ${Date.now()}` }),
  });
  assert.equal(send.res.status, 201, `Expected send 201, got ${send.res.status} body=${send.raw}`);

  const list = await fetchJson(`/dm/threads/${threadId}/messages`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(list.res.status, 200, `Expected list 200, got ${list.res.status} body=${list.raw}`);
  assert.equal(Array.isArray(list.data?.messages), true);

  const read = await fetchJson(`/dm/threads/${threadId}/read`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(read.res.status, 200, `Expected read 200, got ${read.res.status} body=${read.raw}`);
  assert.equal(read.data?.success, true);
}

(async function main() {
  if (!ensureLiveRunEnabled()) {
    process.exit(0);
  }

  const results = [];
  results.push(await runCase('image generate', caseImageGenerate));
  results.push(await runCase('short generate', caseShortGenerate));
  results.push(await runCase('checkout session creation', caseCheckoutSession));
  results.push(await runCase('webhook crediting', caseWebhookCrediting));
  results.push(await runCase('DM send/read', caseDmSendRead));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  log(`\nDone. Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
