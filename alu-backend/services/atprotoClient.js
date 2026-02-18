const { AtpAgent } = require('@atproto/api');
const { bootLexicons, assertValidRecord } = require('./atprotoLexicons');

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

module.exports = {
  isAtprotoConfigured,
  atprotoServiceUrl,
  getAtprotoAgent,
  putRecord,
};

