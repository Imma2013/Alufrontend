const { AtpAgent } = require('@atproto/api');
const { bootLexicons, assertValidRecord, getLexiconDoc, listLexiconIds } = require('./atprotoLexicons');

let cachedAgent = null;
let cachedSessionDid = null;

function isAtprotoConfigured() {
  return !!(
    process.env.ATPROTO_IDENTIFIER &&
    process.env.ATPROTO_APP_PASSWORD
  );
}

function atprotoServiceUrl() {
  return process.env.ATPROTO_PDS_URL || 'https://bsky.social';
}

async function getAtprotoAgent() {
  bootLexicons();

  if (!isAtprotoConfigured()) {
    throw new Error('ATPROTO_IDENTIFIER and ATPROTO_APP_PASSWORD are required.');
  }

  if (cachedAgent && cachedSessionDid) {
    return cachedAgent;
  }

  const agent = new AtpAgent({ service: atprotoServiceUrl() });
  const loginRes = await agent.login({
    identifier: process.env.ATPROTO_IDENTIFIER,
    password: process.env.ATPROTO_APP_PASSWORD,
  });

  cachedAgent = agent;
  cachedSessionDid = loginRes?.data?.did || agent.session?.did || null;
  return cachedAgent;
}

function getRepoDid() {
  return process.env.ATPROTO_REPO_DID || cachedSessionDid || null;
}

async function createUserAgent(identifier, password) {
  if (!identifier || !password) {
    throw new Error('identifier and password are required');
  }
  const agent = new AtpAgent({ service: atprotoServiceUrl() });
  const loginRes = await agent.login({ identifier, password });
  return { agent, did: loginRes?.data?.did || agent.session?.did || '' };
}

async function getActorProfile(agent, actor) {
  try {
    const res = await agent.app.bsky.actor.getProfile({ actor });
    return res?.data || {};
  } catch {
    return {};
  }
}

async function putRecord({ collection, record, rkey }) {
  const validated = assertValidRecord(collection, record);
  const agent = await getAtprotoAgent();
  const repo = getRepoDid();

  if (!repo) {
    throw new Error('ATPROTO_REPO_DID is not set and no DID was obtained from session login.');
  }

  return agent.com.atproto.repo.putRecord({
    repo,
    collection,
    rkey,
    record: validated,
  });
}

async function publishLexiconSchemas() {
  const agent = await getAtprotoAgent();
  const repo = getRepoDid();
  if (!repo) {
    throw new Error('ATPROTO_REPO_DID is not set and no DID was obtained from session login.');
  }

  const ids = listLexiconIds();
  const published = [];
  for (const lexiconId of ids) {
    const schema = getLexiconDoc(lexiconId);
    if (!schema) continue;
    const res = await agent.com.atproto.repo.putRecord({
      repo,
      collection: 'com.atproto.lexicon.schema',
      rkey: lexiconId,
      record: {
        $type: 'com.atproto.lexicon.schema',
        id: lexiconId,
        lexicon: schema.lexicon,
        defs: schema.defs,
      },
    });
    published.push({
      id: lexiconId,
      uri: res?.data?.uri || '',
      cid: res?.data?.cid || '',
    });
  }
  return published;
}

module.exports = {
  isAtprotoConfigured,
  atprotoServiceUrl,
  getAtprotoAgent,
  getRepoDid,
  createUserAgent,
  getActorProfile,
  putRecord,
  publishLexiconSchemas,
};
