# API And SDK Reference

## Core APIs

- `GET /api/darkpool/markets`
- `GET /api/darkpool/book?marketId=...&levels=20`
- `GET /api/darkpool/book?pair=sETH/sZEKO&levels=20`
- `GET /api/darkpool/book/hash?marketId=...`
- `GET /api/darkpool/trades`
- `GET /api/darkpool/candles`
- `POST /api/darkpool/activity` (wallet-signed `account-read` authorization)
- `GET /api/darkpool/status`
- `GET /api/darkpool/fairness/audit?limit=200`
- `GET /api/darkpool/frontends/fees?frontendId=...`

The status response exposes `server.userConfirmation`. The hosted Sepolia
runtime uses `model: "zeko-sequencer"`; `ethereumFinalityRequired` is false
for ordinary deposits, notes, orders, and trades. Ethereum settlement/finality
belongs to bridge and rollup settlement assurance, not the user execution path.

## Account / Balance APIs

- `POST /api/darkpool/accounts/sync-onchain`
- `GET /api/darkpool/accounts/balance?wallet=...`
- `GET /api/darkpool/accounts/onchain-diagnostics?wallet=...`
- `GET /api/darkpool/accounts/pretrade?wallet=...&marketId=...&side=...`

## Order APIs

- `POST /api/darkpool/orders/place`
- `POST /api/darkpool/orders/:id/cancel`
- `POST /api/darkpool/orders/:id/replace`
- `GET /api/darkpool/orders/:id?token=...`

## Settlement APIs

- `GET /api/darkpool/settlement/batches`
- `POST /api/darkpool/settlement/mark-committed` (internal service only)
- `POST /api/darkpool/settlement/cache-payout-proofs` (internal service only)
- `POST /api/darkpool/settlement/cache-private-state-proof`
- `GET /api/darkpool/settlement/payout-requirements?batchId=...` (internal service only)
- `POST /api/darkpool/settlement/commit-next-local` (test mode/internal service only)
- `GET /api/darkpool/settlement/proof-job/next`

## Vault / Note APIs

- `POST /api/darkpool/vault/deposit`
- `POST /api/darkpool/vault/deposit/find-latest`
- `POST /api/darkpool/vault/deposit/build-transaction`
- `POST /api/darkpool/vault/deposit/submit-signed`
- `POST /api/darkpool/vault/deposit-intent`
- `POST /api/darkpool/vault/deposit-recover`
- `POST /api/darkpool/vault/deposit-auto`
- `POST /api/darkpool/vault/withdraw`
- `GET /api/darkpool/vault/pool`
- `GET /api/darkpool/notes/status?note=...`
- `POST /api/darkpool/notes/portfolio` (wallet-signed `account-read` authorization)

Deposits are minted only against a canonical transaction hash whose sender, recipient, token, and
raw amount are verified. `deposit-recover` no longer mints from account-balance deltas because two
independent balance observations cannot prove that the same transfer caused both changes.

On Sepolia, the browser asks Auro to sign the deposit command with `onlySign: true`; the server
then submits the signed command to the Sepolia `sendZkapp` mutation. This avoids making Auro wait
for the full sequencer broadcast path and keeps the submission retry/recovery boundary in the app.

## Operator APIs

- `POST /api/darkpool/operator/zkapp-state`
- `POST /api/darkpool/operator/private-state-witness`
- `POST /api/darkpool/operator/private-state-merkle`
- `POST /api/darkpool/operator/private-state-proof`

## Maker APIs

- `POST /api/darkpool/maker/quote`
- `POST /api/darkpool/maker/cancel-all`

## SDK

SDK path:
- `/sdk/shadowbook-sdk.js`

Useful methods:
- `getMarkets()`
- `getBook()`
- `getTrades()`
- `getCandles()`
- `getStatus()`
- `getActivity(wallet, limit, authorization)`
- `syncOnchainBalance(payload)`
- `placeOrder(payload)`
- `cancelOrder(orderId, cancelToken, authorization)`
- `replaceOrder(orderId, payload)`
- `deposit(payload)`
- `depositAuto(payload)`
- `withdraw(payload)`
- `getNotesPortfolio(wallet, authorization)`
- `getSettlementBatches(limit)`
- `getOperatorZkappState(adminKey)`
- `getPrivateStateWitness(adminKey)`
- `getPrivateStateMerkle(adminKey)`
- `provePrivateState(adminKey)`

## Fee Routing

Demo fee model:
- taker fee: `TAKER_FEE_BPS`
- frontend revenue share: `FRONTEND_FEE_SHARE_BPS`
- protocol accrues the remainder
- if `frontendId` is absent, the full fee accrues to protocol balances
