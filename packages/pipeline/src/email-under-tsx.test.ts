import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..");

describe("emails under tsx", () => {
  it("build and render the way the Railway pipeline runs them", () => {
    const run = spawnSync(path.join(root, "node_modules/.bin/tsx"), ["fixtures/tsx/render-email.ts"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(run.stderr).not.toMatch(/React is not defined/);
    expect(run.stdout).toContain("rendered 4");
  }, 60_000);
});
