import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  verifySolanaAnchorTransaction,
  type SolanaRpcConfig
} from "../src/solana-rpc.ts";

const BASE_RPC_CONFIG: SolanaRpcConfig = {
  devnetRpcUrl: "https://devnet.example-rpc.local",
  testnetRpcUrl: "https://testnet.example-rpc.local",
  mainnetRpcUrl: "https://mainnet.example-rpc.local",
  timeoutMs: 5000
};

const WALLET_A = "7vx6SiKx9tyDu4m7x5jYfL9GQwJzK2m2wGrLhP4Tq3Fd";
const WALLET_B = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const TX_SIGNATURE_A =
  "5QeEwJ6bo6rM3xq8wQx5wPz6xZ8Y3wVf7m2k9xwD4yA2n4qR8w7p5h2K9xF3m6a";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("verifySolanaAnchorTransaction succeeds when tx is confirmed and wallet is signer", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestBody = init?.body;
    let body: unknown = undefined;

    if (typeof requestBody === "string") {
      body = JSON.parse(requestBody);
    }

    calls.push({
      url: String(input),
      body
    });

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          meta: {
            err: null
          },
          transaction: {
            signatures: [TX_SIGNATURE_A],
            message: {
              accountKeys: [
                { pubkey: WALLET_A, signer: true },
                { pubkey: WALLET_B, signer: false }
              ]
            }
          }
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  await verifySolanaAnchorTransaction({
    cluster: "solana:devnet",
    walletAddress: WALLET_A,
    anchorTxSignature: TX_SIGNATURE_A,
    rpc: BASE_RPC_CONFIG
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, BASE_RPC_CONFIG.devnetRpcUrl);

  const rpcBody = calls[0]?.body as { method?: string; params?: unknown[] };
  assert.equal(rpcBody.method, "getTransaction");
  assert.equal(rpcBody.params?.[0], TX_SIGNATURE_A);
});

test("verifySolanaAnchorTransaction fails when tx is not found", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: null
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    )) as typeof fetch;

  await assert.rejects(
    () =>
      verifySolanaAnchorTransaction({
        cluster: "solana:devnet",
        walletAddress: WALLET_A,
        anchorTxSignature: TX_SIGNATURE_A,
        rpc: BASE_RPC_CONFIG
      }),
    /anchor transaction not found/i
  );
});

test("verifySolanaAnchorTransaction fails when tx execution has on-chain error", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          meta: {
            err: { InstructionError: [0, "Custom"] }
          },
          transaction: {
            signatures: [TX_SIGNATURE_A],
            message: {
              accountKeys: [{ pubkey: WALLET_A, signer: true }]
            }
          }
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    )) as typeof fetch;

  await assert.rejects(
    () =>
      verifySolanaAnchorTransaction({
        cluster: "solana:testnet",
        walletAddress: WALLET_A,
        anchorTxSignature: TX_SIGNATURE_A,
        rpc: BASE_RPC_CONFIG
      }),
    /not successful on chain/i
  );
});

test("verifySolanaAnchorTransaction fails when signer does not match walletAddress", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          meta: {
            err: null
          },
          transaction: {
            signatures: [TX_SIGNATURE_A],
            message: {
              accountKeys: [{ pubkey: WALLET_B, signer: true }]
            }
          }
        }
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    )) as typeof fetch;

  await assert.rejects(
    () =>
      verifySolanaAnchorTransaction({
        cluster: "solana:mainnet-beta",
        walletAddress: WALLET_A,
        anchorTxSignature: TX_SIGNATURE_A,
        rpc: BASE_RPC_CONFIG
      }),
    /signer does not match walletAddress/i
  );
});
