import { test } from "node:test";
import assert from "node:assert/strict";
import { windowName } from "../src/core/naming.ts";

test("uma task com ticket", () => {
  assert.equal(windowName("working", [{ id: 1, ticket: "TG-123" }], "corrige login"), "● [#1] TG-123");
});

test("várias tasks e tickets", () => {
  assert.equal(
    windowName("idle", [{ id: 1, ticket: "TG-123" }, { id: 2, ticket: "TG-456" }]),
    "✓ [#1 | #2] TG-123 | TG-456",
  );
});

test("sem ticket e descrição longa é encurtada", () => {
  const name = windowName("waiting", [{ id: 3 }], "uma descrição bem comprida que passa do limite da aba");
  assert.ok(name.startsWith("? [#3] uma descrição"));
  assert.ok(!name.includes("||"));
  assert.ok(name.endsWith("…"));
});
