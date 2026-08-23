import test from "node:test";
import assert from "node:assert/strict";
import { adminTokenMatches } from "./auth.mjs";

test("admin token is required and must match exactly", () => {
  assert.equal(adminTokenMatches(undefined, "anything"), false);
  assert.equal(adminTokenMatches("server-secret", ""), false);
  assert.equal(adminTokenMatches("server-secret", "user-token"), false);
  assert.equal(adminTokenMatches("server-secret", "server-secret"), true);
});
