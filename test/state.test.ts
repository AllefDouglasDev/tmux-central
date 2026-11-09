import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { emptyState, readState, writeJsonAtomic } from "../src/core/state.ts";
import { paths } from "../src/core/paths.ts";

test("withState serializa escritas concorrentes entre processos", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "central-")), ".central");
  mkdirSync(dir);
  writeJsonAtomic(paths(dir).state, emptyState("/x", "x"));
  const script = `import { withState } from ${JSON.stringify(new URL("../src/core/state.ts", import.meta.url).pathname)};
for (let i = 0; i < 10; i++) withState(${JSON.stringify(dir)}, (s) => { s.nextTaskId++; });`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "inherit" });
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
      }),
    ),
  );
  assert.equal(readState(dir).nextTaskId, 1 + 80);
});
