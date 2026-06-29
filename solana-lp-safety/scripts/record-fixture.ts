/**
 * Record a sanitized transport fixture for the offline integration tests.
 *
 *   npx tsx scripts/record-fixture.ts <ADDR> <name> [note]
 *
 * Runs analyze() once against the live network, capturing every API/RPC response
 * (keyed by the sanitized requestKey) into tests/fixtures/<name>.json together
 * with the resulting verdict. ABORTS if any secret would leak into the file.
 *
 * A Helius key (via .env) is recommended so holder data is captured reliably, but
 * it never enters the fixture: RPC calls are keyed on method+params and the guard
 * below rejects any file containing `api-key=` or the key string.
 */
import { writeFileSync } from "node:fs";
import { setResponder } from "./lib/http.js";
import { analyze } from "./lib/analyze.js";
import { makeRecorder } from "../tests/fixtures/transport.js";

try {
  process.loadEnvFile();
} catch {
  /* keyless works, but a key gives reliable holder data */
}

async function main() {
  const [addr, name, note] = process.argv.slice(2);
  if (!addr || !name) {
    console.error("usage: npx tsx scripts/record-fixture.ts <ADDR> <name> [note]");
    process.exit(1);
  }

  const { responder, calls } = makeRecorder();
  setResponder(responder);
  let expect: Record<string, unknown>;
  try {
    const report = await analyze(addr);
    expect = { verdict: report.verdict };
  } catch (e: any) {
    // errorMatch defaults to the full (deterministic) message so a recorded error
    // fixture asserts THIS specific failure, never just "some exception". Trim it to
    // a stable substring by hand if the message embeds a volatile value.
    const message = e?.message ?? String(e);
    expect = { error: true, message, errorMatch: message };
  } finally {
    setResponder(null);
  }

  const fixture = { target: addr, note: note ?? "", calls, expect };
  const json = JSON.stringify(fixture, null, 2);

  // Key-leak guard (defense-in-depth on top of requestKey sanitization). Rejects,
  // regardless of env: credential-shaped query params, any RPC-provider hostname,
  // and the literal values of HELIUS_API_KEY / SOLANA_RPC_URL if set.
  const PATTERNS: [RegExp, string][] = [
    [/[?&](api[-_]?key|key|token|secret|auth|access[-_]?token)=/i, "credential query param"],
    [/api[-_]?key\s*[=:]\s*["']?[\w-]{8,}/i, "api-key literal"],
    [/helius-rpc\.com|helius\.xyz|quiknode|alchemy\.com|rpcpool/i, "RPC-provider hostname"],
  ];
  const envSecrets = [process.env.HELIUS_API_KEY, process.env.SOLANA_RPC_URL].filter(
    (s): s is string => !!s && s.length > 8,
  );
  const hit =
    PATTERNS.find(([re]) => re.test(json))?.[1] ??
    (envSecrets.some((s) => json.includes(s)) ? "env secret value" : null);
  if (hit) {
    console.error(`ABORT: fixture would contain a secret/host (${hit}). Not written.`);
    process.exit(1);
  }

  const out = new URL(`../tests/fixtures/${name}.json`, import.meta.url);
  writeFileSync(out, json + "\n");
  console.log(
    `wrote tests/fixtures/${name}.json — ${Object.keys(calls).length} calls, expect ${JSON.stringify(expect)}`,
  );
}

main().catch((e) => {
  console.error(`record error: ${e?.message ?? e}`);
  process.exit(2);
});
