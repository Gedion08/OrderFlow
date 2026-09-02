/**
 * @orderflow/sdk — public exports.
 *
 * The non-custodial vault model replaced the custodian + per-order-signer
 * approach. Only `VaultSdk` (and its PDA helpers) is consumed by the keeper
 * and web flow; the legacy `OrderFlowSdk` + `OrderSignerStore` have been
 * removed. Callers needing DLMM primitives should import `@meteora-ag/dlmm`
 * directly.
 */
export * from './vault-sdk';