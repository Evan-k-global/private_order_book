# Zeko Sepolia Builder Notes

This is the practical guide for building and deploying on the live Zeko Ethereum Sepolia endpoint. It focuses on the failure modes that are easy to misread when moving from Mina-style Zeko testnet examples.

## Network Identity

Use:

```env
ZEKO_GRAPHQL=https://sepolia.zeko.io/graphql
```

There are three different identifiers in circulation:

| Context | Value | Meaning |
| --- | --- | --- |
| GraphQL `networkID` | `zeko:testnet` | Label returned by the live endpoint |
| o1js/Auro transaction signing domain | `testnet` | Domain used to sign wallet and zkApp transactions on this Sepolia deployment |
| UI label | `Zeko Ethereum Sepolia` | Human-readable display name |

Do not copy `zeko:testnet` into `Mina.Network({ networkId })`. For Sepolia wallet-signed transactions, use `networkId: "testnet"`. Using the wrong signing domain produces `Invalid_signature` even when the private key correctly derives to the fee payer address.

## Assets And Account Creation

- `sETH` is the native gas asset. Build a native payment transaction, then have Auro sign and submit it using the Sepolia signing domain.
- `sZEKO` is a fungible token. Use the token contract transfer/mint flow and a token account.
- Do not route sETH through a fungible-token contract.
- Do not treat a token contract public key as the token ID. Configure both values.

The live Sepolia endpoint currently reports this genesis constant:

```json
{"accountCreationFee":"2500"}
```

With 9-decimal sETH units, that is `0.0000025 sETH` per newly created account. This is a live network value, not a universal protocol minimum; query `genesisConstants` instead of relying on an o1js default or a Mina testnet assumption.

Example check:

```bash
curl -sS https://sepolia.zeko.io/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ genesisConstants { accountCreationFee } }"}'
```

The mint script in this repo creates three accounts during contract deployment and one token account during minting. With the current script and app fee (`200000` base units per transaction), the expected minimum for that flow is approximately `410000` base units, or `0.00041 sETH`, plus margin. The required amount changes if the transaction shape, fee, or live account-creation fee changes. Do not use the generic Auro suggestion of `0.1 MINA` for this Sepolia flow.

## sZEKO Deployment

The checked-in deployment script is:

```bash
scripts/mint-szeko-sepolia.mjs
```

Keep private keys in local ignored files or the deployment environment. Do not commit the deployment env file.

Run it with the deployer and token keys loaded, without printing private values:

```bash
set -a
source data/zeko-sepolia-order-zkapp.env
source data/zeko-sepolia-szeko.env
set +a

ZEKO_GRAPHQL=https://sepolia.zeko.io/graphql \
TOKEN_SYMBOL=sZEKO \
TOKEN_DECIMALS=9 \
TOKEN_SUPPLY_WHOLE=100000 \
TOKEN_RECIPIENT=YOUR_ZEKO_PUBLIC_KEY \
TOKEN_RESUME_EXISTING=1 \
pnpm exec node scripts/mint-szeko-sepolia.mjs
```

The script must verify all of the following before app configuration is changed:

1. The admin contract account exists.
2. The token contract account exists.
3. The recipient token account exists.
4. The recipient balance equals the intended supply.
5. The derived token ID is recorded alongside the contract public key.

A local env artifact, a printed public key, or a pending transaction response is not proof of deployment. Re-read the contract account and recipient token account from `https://sepolia.zeko.io/graphql`.

## Current sZEKO Deployment

The verified Sepolia deployment used by this demo is:

```env
TOKEN_SYMBOL=sZEKO
TOKEN_DECIMALS=9
TOKEN_SUPPLY_WHOLE=100000
TOKEN_CONTRACT_PUBLIC_KEY=B62qpCuSDoTuL8dUcNfuoLoas8A77gRHJTp4WVe5NF2phXbQUNwNZ3W
TOKEN_ID=xpAptwG79jEStACsCv9C6yXUBmKbvurUo8GsTPYapn9QWB5zE5
```

The app market is `sETH/sZEKO`. The sETH token ID is the native token ID used by the endpoint, while its token-contract address is empty in configuration.

## App Configuration

Until the Sepolia endpoint exposes a usable dynamic fee quote, use an explicit static fee mode:

```env
SEQUENCER_FEE_MODE=static
TX_FEE=200000
```

This charges `0.0002 sETH` as the configured transaction fee. The app retains the pooled-command estimator behind:

```env
SEQUENCER_FEE_MODE=dynamic
```

Switch to dynamic mode only after the selected Sepolia endpoint exposes the pooled-command fields and the returned values have been verified. A failed dynamic query must not silently determine the fee policy in production.

Configure the asset model rather than branching on asset names:

```json
{
  "sETH": "",
  "sZEKO": "B62qpCuSDoTuL8dUcNfuoLoas8A77gRHJTp4WVe5NF2phXbQUNwNZ3W"
}
```

Use the empty contract address to select native payment handling. A non-empty contract address selects the fungible-token path. The same rule applies to deposits, withdrawals, settlement payouts, and token-account existence checks.

## Builder Checklist

- Query `networkID` and `genesisConstants` from the exact GraphQL endpoint being used.
- Use `testnet` as the Sepolia o1js/Auro signing domain.
- Fund the actual fee payer public key, not only the wallet used for testing.
- Derive and record contract public keys and token IDs from the same key material.
- Treat sETH as native and sZEKO as an FT.
- For sETH deposits, use the server-built wallet-sign/submit flow rather than Auro's generic `sendPayment` shortcut.
- Verify contract and token accounts live after every deployment or mint.
- Keep deployment state network-scoped; never reuse Mina state files on Sepolia.
- Never treat a local ignored env file as evidence that a deployment exists.
- Do not expose private keys or absolute local filesystem paths in docs, logs, or PRs.

## Common Errors

### `Invalid_signature`

Usually means the command was signed with the wrong network domain or the private key does not match the fee payer public key. Check the derived public key and use `testnet` for Sepolia signing.

### `account does not exist`

Expected for a new contract or token account before its creating transaction is accepted. It is not evidence that deployment failed; wait for the transaction and re-query the account.

### Token balance is zero

Check the token ID and token account separately. A native sETH account lookup is not a valid sZEKO balance lookup.

### Wallet shows funds but deployment fails

The wallet may be funded while the configured deployer fee payer is not. Query the exact public key derived from `DEPLOYER_PRIVATE_KEY`.
