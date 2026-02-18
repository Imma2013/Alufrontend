const fs = require('fs');
const path = require('path');
const { Lexicons } = require('@atproto/lexicon');

const LEXICON_DIR = path.resolve(__dirname, '../../lexicons');
const LEXICON_FILES = [
  'pics.alu.video.post.json',
  'pics.alu.short.post.json',
];

let booted = false;
let docs = [];
let registry = null;

function readLexiconFile(filename) {
  const fullPath = path.join(LEXICON_DIR, filename);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const doc = JSON.parse(raw);

  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid lexicon JSON object in ${filename}`);
  }
  if (doc.lexicon !== 1) {
    throw new Error(`Invalid lexicon version in ${filename}; expected lexicon=1`);
  }
  if (typeof doc.id !== 'string' || !doc.id.startsWith('pics.alu.')) {
    throw new Error(`Invalid lexicon id in ${filename}; expected id to start with pics.alu.`);
  }

  return doc;
}

function bootLexicons() {
  if (booted) {
    return { docs, registry };
  }

  const loadedDocs = LEXICON_FILES.map(readLexiconFile);
  const lex = new Lexicons();
  for (const doc of loadedDocs) {
    lex.add(doc);
  }

  docs = loadedDocs;
  registry = lex;
  booted = true;
  return { docs, registry };
}

function listLexiconIds() {
  const { docs: loaded } = bootLexicons();
  return loaded.map((doc) => doc.id);
}

function getLexiconDoc(id) {
  const { docs: loaded } = bootLexicons();
  return loaded.find((doc) => doc.id === id) || null;
}

function assertValidRecord(collection, record) {
  const { registry: lex } = bootLexicons();
  const payload = { ...(record || {}), $type: collection };
  return lex.assertValidRecord(collection, payload);
}

module.exports = {
  bootLexicons,
  listLexiconIds,
  getLexiconDoc,
  assertValidRecord,
};

