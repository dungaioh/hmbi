import test from "node:test";
import assert from "node:assert/strict";
import { extractRows } from "./data-service.mjs";

test("extractRows supports common read-only API envelopes", () => {
  const rows = [{ value: 1 }];
  assert.deepEqual(extractRows(rows), rows);
  assert.deepEqual(extractRows({ data: rows }), rows);
  assert.deepEqual(extractRows({ result: { records: rows } }), rows);
  assert.deepEqual(extractRows({ unknown: rows }), []);
});
