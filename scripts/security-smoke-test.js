import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const baseUrl = String(process.env.DARKPOOL_SMOKE_API || 'http://127.0.0.1:8893').replace(/\/$/, '');
const internalSecret = String(process.env.INTERNAL_SERVICE_SECRET || 'smoke-internal-secret');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

async function request(pathname, { method = 'GET', body, headers = {}, expectedStatus = 200 } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${pathname}: ${JSON.stringify(data)}`);
  return data;
}

async function signerClient() {
  const o1jsEntry = require.resolve('o1js');
  const signerPath = path.join(path.dirname(o1jsEntry), 'mina-signer', 'mina-signer.js');
  const mod = await import(pathToFileURL(signerPath).href);
  return new mod.default({ network: 'testnet' });
}

async function walletAuthorization(signer, privateKey, wallet, scope, action, resourceId = null) {
  const nonce = `${scope}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const expiresAtUnixMs = Date.now() + 60_000;
  const payload = stableStringify({ scope, action, wallet, resourceId, nonce, expiresAtUnixMs });
  const signed = signer.signMessage(payload, privateKey);
  return { publicKey: signed.publicKey, payload, nonce, expiresAtUnixMs, signature: signed.signature };
}

async function main() {
  const [{ PrivateKey }, signer] = await Promise.all([import('o1js'), signerClient()]);
  const makerKey = PrivateKey.random().toBase58();
  const takerKey = PrivateKey.random().toBase58();
  const makerWallet = PrivateKey.fromBase58(makerKey).toPublicKey().toBase58();
  const takerWallet = PrivateKey.fromBase58(takerKey).toPublicKey().toBase58();

  await request('/api/darkpool/status');
  await request('/api/darkpool/internal/settlement/batches', { expectedStatus: 400 });
  await request('/api/darkpool/internal/settlement/batches', {
    headers: { 'x-internal-service-key': internalSecret }
  });
  await request('/api/darkpool/settlement/mark-committed', {
    method: 'POST', body: { batchId: 1, txHash: 'local_bypass' }, expectedStatus: 400
  });
  await request('/api/darkpool/activity', { method: 'POST', body: { wallet: makerWallet }, expectedStatus: 400 });
  await request('/api/darkpool/notes/portfolio', { method: 'POST', body: { wallet: makerWallet }, expectedStatus: 400 });

  for (const [wallet, asset, amount] of [
    [makerWallet, 'SETH', 1], [makerWallet, 'SZEKO', 100],
    [takerWallet, 'SETH', 1], [takerWallet, 'SZEKO', 100]
  ]) {
    await request('/api/darkpool/test/mint-note', { method: 'POST', body: { wallet, asset, amount } });
  }
  const markets = await request('/api/darkpool/markets');
  const market = markets.markets[0];
  assert.ok(market?.marketId, 'market is configured');

  const makerPortfolio = await request('/api/darkpool/notes/portfolio', {
    method: 'POST',
    body: { wallet: makerWallet, authorization: await walletAuthorization(signer, makerKey, makerWallet, 'account-read', 'portfolio') }
  });
  assert.equal(makerPortfolio.outstandingNoteCount, 2);

  await request('/api/darkpool/maker/quote', {
    method: 'POST',
    body: {
      wallet: makerWallet, marketId: market.marketId, bidPrice: 9, askPrice: 11, bidSize: 0.5, askSize: 0.5,
      timeInForce: 'GTC', visibility: 'public', replace: true, frontendId: 'smoke.maker'
    },
    expectedStatus: 400
  });

  const baseNote = makerPortfolio.outstandingNotes.find((note) => note.asset === 'SETH');
  assert.ok(baseNote, 'maker base note exists');
  await request('/api/darkpool/orders/place', {
    method: 'POST',
    body: {
      wallet: makerWallet, marketId: market.marketId, side: 'SELL', orderType: 'LIMIT', timeInForce: 'GTC',
      limitPrice: 11, quantity: 0.5, fundingNoteHashes: [baseNote.noteHash], visibility: 'public', frontendId: 'smoke.maker'
    }
  });

  const takerPortfolio = await request('/api/darkpool/notes/portfolio', {
    method: 'POST',
    body: { wallet: takerWallet, authorization: await walletAuthorization(signer, takerKey, takerWallet, 'account-read', 'portfolio') }
  });
  const quoteNote = takerPortfolio.outstandingNotes.find((note) => note.asset === 'SZEKO');
  assert.ok(quoteNote, 'taker quote note exists');
  const order = await request('/api/darkpool/orders/place', {
    method: 'POST',
    body: {
      wallet: takerWallet, marketId: market.marketId, side: 'BUY', orderType: 'LIMIT', timeInForce: 'IOC',
      limitPrice: 11, quantity: 0.2, fundingNoteHashes: [quoteNote.noteHash], visibility: 'private', frontendId: 'smoke.taker'
    }
  });
  assert.equal(order.matchCount, 1);
  const publicTrades = await request('/api/darkpool/trades');
  assert.equal(publicTrades.count, 1);
  assert.equal(JSON.stringify(publicTrades.trades).includes(makerWallet), false, 'public tape leaks maker wallet');
  assert.equal(JSON.stringify(publicTrades.trades).includes(takerWallet), false, 'public tape leaks taker wallet');

  const activity = await request('/api/darkpool/activity', {
    method: 'POST',
    body: { wallet: takerWallet, authorization: await walletAuthorization(signer, takerKey, takerWallet, 'account-read', 'activity') }
  });
  assert.ok(Array.isArray(activity.events));
  console.log('security smoke passed: public reads, signed account reads, maker auth rejection, private IOC trade, and internal settlement controls');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
