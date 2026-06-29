/**
 * Integration tests — run analyze() end-to-end against recorded transport
 * fixtures with NO network and NO key. Deterministic. Run: npm run test:integration
 *
 * Each tests/fixtures/<name>.json is a sanitized record/replay capture (see
 * fixtures/transport.ts + scripts/record-fixture.ts). The replayer is STRICT — a
 * call that was not recorded throws "fixture miss" — so these exercise the real
 * resolve → fetch → parse → aggregate → verdict path offline, end to end.
 *
 * Offline is ENFORCED: global fetch is replaced with a throwing stub, so any real
 * network call (e.g. an unrecorded request slipping past the replayer) is a hard
 * failure rather than a silently-live result. This holds even with Wi-Fi ON.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { setResponder } from "../scripts/lib/http.js";
import { analyze } from "../scripts/lib/analyze.js";
import { makeReplayer, type Fixture } from "./fixtures/transport.js";

// Forbid all real network access for the duration of this suite.
globalThis.fetch = (() => {
  throw new Error("offline-test violation: real network access is forbidden here");
}) as unknown as typeof fetch;

const dir = new URL("./fixtures/", import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();

let failures = 0;
let passes = 0;

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    passes++;
    console.log(`  ✓ ${label}`);
  } catch (e: any) {
    failures++;
    console.error(`  ✗ ${label}\n      ${e?.message ?? e}`);
  }
}

async function run() {
  console.log("\nintegration tests — analyze() over offline transport fixtures");
  console.log("=".repeat(68));

  if (!files.length) {
    console.error("  no fixtures found in tests/fixtures/ — record some first.");
    process.exit(1);
  }

  for (const file of files) {
    const fx: Fixture = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    const expectLabel = fx.expect.error ? "error" : fx.expect.verdict;
    await check(`${file} → ${expectLabel}`, async () => {
      const { responder, misses } = makeReplayer(fx.calls);
      setResponder(responder);
      try {
        if (fx.expect.error) {
          let msg = "";
          await assert.rejects(
            () => analyze(fx.target),
            (e: any) => {
              msg = e?.message ?? String(e);
              return true;
            },
          );
          // The rejection must be the REAL expected error, not a swallowed gap.
          assert.equal(misses.length, 0, `fixture miss masked the error: ${misses.join("; ")}`);
          // errorMatch is REQUIRED so an error fixture can never pass on "any exception".
          assert.ok(
            typeof fx.expect.errorMatch === "string" && fx.expect.errorMatch.length > 0,
            "error fixture must declare a non-empty expect.errorMatch (else any exception would pass)",
          );
          assert.ok(msg.includes(fx.expect.errorMatch!), `error "${msg}" lacks "${fx.expect.errorMatch}"`);
          return;
        }
        const report = await analyze(fx.target);
        // A gap (unrecorded call) gets caught by a source as a fake outage and can
        // silently preserve a GO — fail loudly instead so fixtures stay honest.
        assert.equal(misses.length, 0, `fixture had unrecorded calls (gap): ${misses.join("; ")}`);
        assert.equal(report.verdict, fx.expect.verdict, `verdict: got ${report.verdict}, want ${fx.expect.verdict}`);
        // scope invariant: a mint-only target is a TOKEN-level result, never an LP verdict.
        assert.equal(report.scope, report.resolvedAs === "pool" ? "pool" : "token-only", "scope must match resolution");
        for (const code of fx.expect.codes ?? [])
          assert.ok(report.findings.some((f) => f.code === code), `expected finding "${code}"`);
        for (const code of fx.expect.absent ?? [])
          assert.ok(!report.findings.some((f) => f.code === code), `unexpected finding "${code}"`);
      } finally {
        setResponder(null);
      }
    });
  }

  console.log("=".repeat(68));
  if (failures) {
    console.error(`\nINTEGRATION TESTS FAILED: ${failures} failing, ${passes} passing.\n`);
    process.exit(1);
  }
  console.log(`\nALL ${passes} INTEGRATION TESTS PASSED (offline).\n`);
}

run().catch((e) => {
  console.error(`integration runner error: ${e?.message ?? e}`);
  process.exit(2);
});
