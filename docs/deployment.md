# Deployment

## Render

For demo-scale usage, this repo can run as a single Render web service.

### Build command

```bash
pnpm install --frozen-lockfile && pnpm build:zkapp
```

### Start command

```bash
pnpm render:start
```

### Required env

At minimum, configure:

```env
DARKPOOL_HOST=0.0.0.0
AUTO_RUN_BACKGROUND_WORKERS=true
REQUIRE_CACHED_PRIVATE_STATE_PROOF=true
ALLOW_INLINE_PRIVATE_STATE_PROVING=false
PROOF_WORKER_API_KEY=<strong-random-secret>
```

Plus your existing chain / app secrets:

- `ZEKO_GRAPHQL`
- `DEPLOYER_PRIVATE_KEY`
- `ZKAPP_PRIVATE_KEY`
- `ZKAPP_PUBLIC_KEY`
- `PAYOUT_OPERATOR_PRIVATE_KEY`
- `PAYOUT_FEE_PAYER_PRIVATE_KEY` if separate
- `ORDER_RECEIPT_SECRET`
- `MAKER_API_KEY`
- `OPERATOR_PANEL_ADMIN_KEY`
- any DA relay envs you actually use

### Recommended setup

- one Render web service
- durable disk mounted for `data/`
- do not rely on ephemeral filesystem if you want local JSON state persistence

### What runs inside the single service

- HTTP API + UI
- matcher
- embedded proof-precompute loop
- embedded settlement loop

This is the simplest deployment shape for the demo.

## Scaling Proving Later

If proof generation needs more CPU/RAM later:

1. Keep the main Render service as the market + settlement authority
2. Run one or more separate proof machines
3. Point them at the same `DARKPOOL_API`
4. Configure the same `PROOF_WORKER_API_KEY`
5. Run:

```bash
pnpm settlement:worker:proofs:remote
```

The remote proof agent:
- fetches the next pending proof job snapshot
- builds the proof locally
- uploads the proof artifact back

Settlement commit remains single-writer on the main service.

## Why This Shape

For this market, the important constraint is:
- proving must not sit on the hot trading path

So the architecture is:
- off-chain matching
- precomputed proofs
- on-chain batch settlement / root anchoring

That is lean enough for demo-scale deployment while leaving a clean path to horizontal proof scaling later.

## Faucet Options

For the public UI, the funding tab links users to the official Zeko faucet:

- [https://faucet.zeko.io/](https://faucet.zeko.io/)

That keeps faucet policy and GitHub authentication out of the app server.

If you are wiring up internal agents or operator workflows instead, you can also use the official Zeko faucet CLI directly:

- [zeko-labs/faucet-cli](https://github.com/zeko-labs/faucet-cli)

That path is better suited to scripts and bots than the public UI, especially when you want explicit control over faucet claiming behavior outside the browser.
