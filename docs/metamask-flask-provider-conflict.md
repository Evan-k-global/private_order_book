# MetaMask Main / Flask Connection Conflict

## User Workaround

Both extensions can remain installed, but for ShadowBook's current Mina Snap
connection, only Flask should be enabled in the browser profile:

1. In Chrome, open Extensions > Manage Extensions.
2. Turn off **MetaMask**, leaving **MetaMask Flask DEVELOPMENT BUILD** enabled.
3. Reload ShadowBook, then choose **Connect Wallet > MetaMask Flask**.

A separate Flask-only browser profile is another option. Disconnecting MetaMask
inside a dapp revokes neither its site injection nor its message listeners.
No wallet reset, seed export, uninstall, or funds transfer is required.

## Diagnosis (September 8, 2026)

Two separate problems were found:

- ShadowBook probed every provider for installed Snaps and selected the first
  positive result before verifying that it was Flask. It also retained the
  ambiguous `window.ethereum` fallback and did not wait for delayed announcements.
- The installed Main 13.47.0.0 and Flask 13.47.0.150 bundles announce distinct
  EIP-6963 IDs (`io.metamask` and `io.metamask.flask`), but both use the same
  `metamask-inpage` / `metamask-contentscript` postMessage targets and the
  `metamask-provider` channel. The message listener checks the window, origin,
  and target name, not a Main-versus-Flask extension ID. Selecting an EIP-6963
  object does not isolate this underlying transport. This explains why requests
  can reach main MetaMask or both extensions.

This transport diagnosis comes from read-only inspection of the extension code,
not from a captured user signing session. No wallet storage or key material was
inspected. Upstream sources show the same design:

- [Provider injection and channel setup](https://github.com/MetaMask/metamask-extension/blob/main/app/scripts/inpage.js)
- [Content-script channel routing](https://github.com/MetaMask/metamask-extension/blob/main/app/scripts/streams/provider-stream.ts)
- [Flask's EIP-6963 identifier](https://github.com/MetaMask/connect-monorepo/releases/tag/v39.0.0)

## ShadowBook Behavior

- Discover providers via EIP-6963 and wait for announcements.
- Only select the exact `io.metamask.flask` identity, never global injection or
  the first wallet with an installed Snap.
- If another MetaMask build is announced, stop before RPC or approval requests
  and show the workaround. Do not claim both enabled extensions are isolated.
- Verify the selected provider reports a Flask runtime before checking Snaps.
- Keep accounts, messages, network changes, and transactions on that selected
  provider. Guard subsequent requests against a late main-provider announcement.
- Time out read-only identity/Snap checks without falling back to another wallet.
- Prevent overlapping connection attempts and restore the prior wallet state
  if a switch fails.

Regression tests: `node --test scripts/test-flask-provider.mjs`.
They exercise the actual browser functions with mocked providers, not live
extension approvals. A live Flask-only connection still needs user verification.
