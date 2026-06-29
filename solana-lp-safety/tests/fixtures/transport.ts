// Record/replay transport for offline, deterministic integration tests.
//
// The RECORDER calls the real network and captures {requestKey: response}; the
// REPLAYER serves those captures with NO network and NO key. Keys come from
// requestKey() (RPC keyed on method+params, REST on method+url) so no api-key is
// ever stored. See ../../P0.2-REPLAY-SEAM-PLAN.md.

import { liveFetch, requestKey, type Responder } from "../../scripts/lib/http.js";

export interface Fixture {
  target: string;
  note?: string;
  calls: Record<string, any>;
  expect: {
    verdict?: string;      // assert report.verdict
    error?: boolean;       // assert analyze() throws
    errorMatch?: string;   // substring the thrown error message MUST contain
    message?: string;      // (informational) recorded error message
    codes?: string[];      // finding codes that MUST be present
    absent?: string[];     // finding codes that must NOT be present
  };
}

// A call the replayer had no recording for. Distinct class so a test can tell a
// fixture GAP apart from a genuine recorded outage — see the `misses` array, which
// the integration runner asserts is empty (a swallowed miss must never pass as a
// valid offline run, or a hand-edited fixture could "pass" for the wrong reason).
export class FixtureMissError extends Error {
  constructor(public key: string) {
    super(`fixture miss: ${key}`);
    this.name = "FixtureMissError";
  }
}

// Records live responses. A transport throw (timeout / HTTP error) is stored as
// {__error} and re-thrown, so a "source unavailable" outage replays faithfully.
// (A JSON-RPC error field comes back as a normal 200 body and is stored as-is;
// rpc() will throw on replay exactly as it did live.)
//
// LAST-WINS by design: if a key is requested twice in one run (e.g. fetchRugcheck's
// fail-then-retry), the FINAL response is kept — that is the authoritative outcome
// the verdict actually saw, so replaying it yields the same verdict. (We test the
// verdict, not retry timing; keeping the first/error response would instead make
// replay return null and could flip the verdict — wrong.)
export function makeRecorder(): { responder: Responder; calls: Record<string, any> } {
  const calls: Record<string, any> = {};
  const responder: Responder = async (url, init) => {
    const key = requestKey(url, init);
    try {
      const res = await liveFetch(url, init);
      calls[key] = res;
      return res;
    } catch (e: any) {
      calls[key] = { __error: e?.message ?? String(e) };
      throw e;
    }
  };
  return { responder, calls };
}

// Serves recorded responses offline. STRICT: a missing key records a miss and
// throws FixtureMissError (which the runner asserts never happened). A stored
// {__error} throws a plain Error, so the source fn catches it and returns null,
// exactly like a live outage — that is the ONLY intended way to simulate an outage.
export function makeReplayer(calls: Record<string, any>): { responder: Responder; misses: string[] } {
  const misses: string[] = [];
  const responder: Responder = async (url, init) => {
    const key = requestKey(url, init);
    if (!Object.prototype.hasOwnProperty.call(calls, key)) {
      misses.push(key);
      throw new FixtureMissError(key);
    }
    const v = calls[key];
    if (v && typeof v === "object" && "__error" in v) {
      throw new Error(String((v as { __error: unknown }).__error));
    }
    return v;
  };
  return { responder, misses };
}
