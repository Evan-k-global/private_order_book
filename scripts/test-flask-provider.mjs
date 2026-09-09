import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/darkpool.html', import.meta.url), 'utf8');
const between = (start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing browser source markers: ${start}`);
  return html.slice(from, to);
};
const snapId = 'npm:@mondejka/mina-snap';

function harness() {
  const window = new EventTarget();
  const context = vm.createContext({ window, Event, setTimeout, clearTimeout });
  const constants = ['META_MASK_MINA_SNAP_ID', 'META_MASK_PROVIDER_PROBE_TIMEOUT_MS',
    'META_MASK_PROVIDER_DISCOVERY_MS', 'META_MASK_FLASK_RDNS']
    .map((name) => html.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
  vm.runInContext(`${constants}
    const eip6963Providers = new Set();
    const eip6963ProviderInfo = new Map();
    let activeMetaMaskSnapProvider = null;
    let activeWalletProvider = 'metamask';
    let metaMaskProviderDiagnostic = '';
    ${between("window.addEventListener('eip6963:announceProvider'", 'function formatDisplayAsset')}
    ${between('function getMinaWalletProvider()', 'async function getInjectedEthereumProviders()')}
    ${between('async function getInjectedEthereumProviders()', 'async function walletRequest(')}
    globalThis.api = { selectMetaMaskSnapProvider, installMetaMaskMinaSnap, getMinaWalletProvider };
  `, context);
  function announce(provider, rdns) {
    const event = new Event('eip6963:announceProvider');
    event.detail = { provider, info: { rdns, name: rdns } };
    window.dispatchEvent(event);
  }
  return { window, announce, ...context.api };
}

function wallet({ version = 'MetaMask/v13.47.0-flask', installed = false, request } = {}) {
  const calls = [];
  return {
    calls,
    async request(args) {
      calls.push(args);
      if (request) return request(args);
      if (args.method === 'web3_clientVersion') return version;
      if (args.method === 'wallet_getSnaps') return installed ? { [snapId]: { id: snapId } } : {};
      if (args.method === 'wallet_requestSnaps') return { [snapId]: { id: snapId } };
      if (args.method === 'wallet_invokeSnap') return ['B62-test'];
      throw new Error(`Unexpected request: ${args.method}`);
    }
  };
}

test('both extensions: blocks before any RPC, even if main already has the Snap', async () => {
  const h = harness();
  const main = wallet({ installed: true });
  const flask = wallet();
  h.window.ethereum = main;
  h.announce(main, 'io.metamask');
  h.announce(flask, 'io.metamask.flask');
  await assert.rejects(h.installMetaMaskMinaSnap(), /extension conflict/);
  assert.equal(main.calls.length, 0);
  assert.equal(flask.calls.length, 0);
});

test('waits for delayed Flask discovery; never probes window.ethereum or unrelated wallets', async () => {
  const h = harness();
  const main = wallet();
  const unrelated = wallet();
  const flask = wallet();
  h.window.ethereum = main;
  h.announce(unrelated, 'example.wallet');
  h.window.addEventListener('eip6963:requestProvider', () => {
    setTimeout(() => h.announce(flask, 'io.metamask.flask'), 20);
  });
  await h.installMetaMaskMinaSnap();
  assert.deepEqual(flask.calls.map((c) => c.method), ['web3_clientVersion', 'wallet_getSnaps', 'wallet_requestSnaps']);
  assert.equal(main.calls.length, 0);
  assert.equal(unrelated.calls.length, 0);
});

test('delayed main announcement is caught even if Flask announced first', async () => {
  const h = harness();
  const main = wallet();
  const flask = wallet();
  h.announce(flask, 'io.metamask.flask');
  setTimeout(() => h.announce(main, 'io.metamask'), 20);
  await assert.rejects(h.installMetaMaskMinaSnap(), /extension conflict/);
  assert.equal(flask.calls.length, 0);
  assert.equal(main.calls.length, 0);
});

test('all Snap methods stay pinned to Flask; installed Snap is not reinstalled', async () => {
  const h = harness();
  const flask = wallet({ installed: true });
  h.announce(flask, 'io.metamask.flask');
  await h.installMetaMaskMinaSnap();
  const adapter = h.getMinaWalletProvider();
  await adapter.requestAccounts();
  await adapter.signMessage({ message: 'test' });
  await adapter.sendTransaction({ transaction: '{}' });
  assert.ok(!flask.calls.some((c) => c.method === 'wallet_requestSnaps'));
  assert.deepEqual(flask.calls.filter((c) => c.method === 'wallet_invokeSnap').map((c) => c.params.request.method),
    ['mina_requestAccounts', 'mina_signMessage', 'mina_sendTransaction']);
});

test('main-only and legacy global-only never trigger Snap or account requests', async () => {
  for (const announced of [true, false]) {
    const h = harness();
    const main = wallet({ installed: true });
    h.window.ethereum = main;
    if (announced) h.announce(main, 'io.metamask');
    await assert.rejects(h.installMetaMaskMinaSnap(), /extension conflict|has not announced/);
    assert.equal(main.calls.length, 0);
  }
});

test('Flask metadata with main runtime response fails before requesting Snap approval', async () => {
  const h = harness();
  const flask = wallet({ version: 'MetaMask/v13.47.0' });
  h.announce(flask, 'io.metamask.flask');
  await assert.rejects(h.installMetaMaskMinaSnap(), /answered as a different wallet/);
  assert.deepEqual(flask.calls.map((c) => c.method), ['web3_clientVersion']);
});

test('hung Flask identity request times out without a fallback to main', async () => {
  const h = harness();
  const flask = wallet({ request: () => new Promise(() => {}) });
  h.announce(flask, 'io.metamask.flask');
  await assert.rejects(h.installMetaMaskMinaSnap(), /identity check timed out/);
  assert.equal(flask.calls.length, 1);
});

test('late main injection blocks later signing on an already selected Flask adapter', async () => {
  const h = harness();
  const flask = wallet({ installed: true });
  const main = wallet();
  h.announce(flask, 'io.metamask.flask');
  await h.installMetaMaskMinaSnap();
  h.announce(main, 'io.metamask');
  await assert.rejects(async () => h.getMinaWalletProvider().signMessage({ message: 'test' }), /extension conflict/);
  assert.equal(main.calls.length, 0);
  assert.equal(flask.calls.length, 2);
});

test('rejected Snap installation does not create an active adapter', async () => {
  const h = harness();
  const flask = wallet({ request: ({ method }) => {
    if (method === 'web3_clientVersion') return 'MetaMask/flask';
    if (method === 'wallet_getSnaps') return {};
    throw new Error('User rejected');
  } });
  h.announce(flask, 'io.metamask.flask');
  await assert.rejects(h.installMetaMaskMinaSnap(), /User rejected/);
  assert.equal(h.getMinaWalletProvider(), null);
});

test('failed wallet switch restores the previous provider and suppresses duplicate connections', async () => {
  const nodes = new Map();
  let attempts = 0;
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const oldProvider = { request() {} };
  const context = vm.createContext({
    oldProvider,
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, setAttribute() {} });
      return nodes.get(id);
    } },
    updateWalletButtonState() {}, setWalletFields() {}, setText() {},
    async connectWallet() {
      attempts++;
      vm.runInContext("activeMetaMaskSnapProvider = null; walletConnected = false; activeWallet = '';", context);
      await waiting;
      throw new Error('extension conflict');
    }
  });
  vm.runInContext(`
    let walletConnectionInFlight = false;
    let activeWallet = 'B62-old';
    let activeWalletProvider = 'metamask';
    let activeMetaMaskSnapProvider = oldProvider;
    let walletConnected = true;
    let walletAutoConnectPaused = false;
    let metaMaskProviderDiagnostic = '';
    ${between('async function connectSelectedWallet(', "document.getElementById('connectAuroWalletBtn').onclick")}
  `, context);
  const first = context.connectSelectedWallet('metamask');
  await context.connectSelectedWallet('metamask', 'network');
  assert.equal(attempts, 1);
  release();
  await first;
  assert.equal(vm.runInContext('activeMetaMaskSnapProvider', context), oldProvider);
  assert.equal(vm.runInContext('walletConnected', context), true);
  assert.equal(vm.runInContext('activeWallet', context), 'B62-old');
  assert.equal(vm.runInContext('walletConnectionInFlight', context), false);
  assert.equal(nodes.get('connectMetaMaskWalletBtn').disabled, false);
  assert.match(nodes.get('networkWalletAddressStatus').textContent, /extension conflict/);
});

test('public chart and book refresh before passive wallet discovery', () => {
  const startup = between('const marketsResp = await sdk.getMarkets();', "setInterval(() => {");
  const publicTrades = startup.indexOf('await refreshTrades();');
  const publicBook = startup.indexOf('await refreshBook();');
  const walletDiscovery = startup.indexOf('void syncDetectedWallet({ force: true })');
  assert.ok(publicTrades >= 0 && publicTrades < walletDiscovery);
  assert.ok(publicBook >= 0 && publicBook < walletDiscovery);
  assert.equal(startup.includes('await syncDetectedWallet({ force: true })'), false);
});

test('all inline browser scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});
