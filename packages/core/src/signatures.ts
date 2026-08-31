/**
 * Wallet signature verification utilities.
 *
 * Used to prove that the caller of an API endpoint actually controls the
 * `owner` wallet they claim to represent. The client signs a deterministic
 * message and sends the signature alongside the request.
 */

import { PublicKey } from '@solana/web3.js';
import crypto from 'crypto';

const SIGNING_PREFIX = 'OrderFlow Strategy Authorization';

export function signingMessage(owner: string, strategyId: string, action: 'create' | 'cancel'): string {
  return `${SIGNING_PREFIX}\nAction: ${action}\nOwner: ${owner}\nStrategyId: ${strategyId}\nTimestamp: ${Date.now()}`;
}

export function verifySignature(owner: string, signatureBase58: string, message: string): boolean {
  try {
    const publicKey = new PublicKey(owner);
    const signature = Buffer.from(signatureBase58, 'base64');
    const publicKeyBytes = Buffer.from(publicKey.toBytes());
    return crypto.verify('ed25519', Buffer.from(message), publicKeyBytes, signature);
  } catch {
    return false;
  }
}
