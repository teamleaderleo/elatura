// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectBaselineInputFiles,
  readBaselineJsonEntry,
  readBaselinePlan,
} from "./baseline-input-bundle.mjs";

const roots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "elatura-baseline-inputs-"));
  roots.push(root);
  return root;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("strict live-baseline input bundles", () => {
  it("accepts bounded nested JSON files and parses them", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "manifests"));
    await mkdir(join(root, "observations"));
    await writeFile(join(root, "manifests", "one.json"), '{"kind":"manifest"}\n');
    await writeFile(join(root, "observations", "two.json"), '{"kind":"observation"}\n');

    const entries = await collectBaselineInputFiles([root], { outputPath: join(root, "..", "readiness.json") });
    expect(entries).toHaveLength(2);
    expect(await Promise.all(entries.map((entry) => readBaselineJsonEntry(entry)))).toEqual([
      { kind: "manifest" },
      { kind: "observation" },
    ]);
  });

  it("rejects unexpected files without echoing their names", async () => {
    const root = await temporaryDirectory();
    const privateName = "private-conversation-title.png";
    await writeFile(join(root, privateName), "private");

    try {
      await collectBaselineInputFiles([root]);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "unexpected-file-type" });
      expect(String(error)).not.toContain(privateName);
      expect(String(error)).not.toContain("private-conversation-title");
    }
  });

  it.skipIf(process.platform === "win32")("rejects symbolic links", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source.json");
    await writeFile(source, "{}\n");
    await symlink(source, join(root, "linked.json"));

    await expectCode(collectBaselineInputFiles([root]), "symbolic-link");
  });

  it("rejects output paths inside scanned directories", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "one.json"), "{}\n");

    await expectCode(
      collectBaselineInputFiles([root], { outputPath: join(root, "readiness.json") }),
      "output-inside-input",
    );
  });

  it("bounds files and aggregate bytes independently", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "first"));
    await mkdir(join(root, "second"));
    await writeFile(join(root, "first", "one.json"), "123");
    await writeFile(join(root, "second", "two.json"), "456");

    await expectCode(
      collectBaselineInputFiles([root], { limits: { maxFiles: 1 } }),
      "too-many-files",
    );
    await expectCode(
      collectBaselineInputFiles([root], { limits: { maxTotalBytes: 5 } }),
      "bundle-too-large",
    );
    await expectCode(
      collectBaselineInputFiles([join(root, "first", "one.json")], { limits: { maxFileBytes: 2 } }),
      "file-too-large",
    );
  });

  it("bounds directory count, entries, and nesting depth", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "one"));
    await mkdir(join(root, "two"));
    await writeFile(join(root, "one", "a.json"), "{}\n");
    await writeFile(join(root, "two", "b.json"), "{}\n");

    await expectCode(
      collectBaselineInputFiles([root], { limits: { maxDirectories: 1 } }),
      "too-many-directories",
    );
    await expectCode(
      collectBaselineInputFiles([root], { limits: { maxEntriesPerDirectory: 1 } }),
      "too-many-directory-entries",
    );

    const deep = await temporaryDirectory();
    await mkdir(join(deep, "one", "two"), { recursive: true });
    await writeFile(join(deep, "one", "two", "value.json"), "{}\n");
    await expectCode(
      collectBaselineInputFiles([deep], { limits: { maxDepth: 1 } }),
      "directory-depth-exceeded",
    );
  });

  it("bounds and strictly parses the session plan", async () => {
    const root = await temporaryDirectory();
    const plan = join(root, "session-plan.json");
    await writeFile(plan, '{"schemaVersion":1}\n');
    expect(await readBaselinePlan(plan)).toEqual({ schemaVersion: 1 });

    await writeFile(plan, Buffer.from([0xff]));
    await expectCode(readBaselinePlan(plan), "invalid-utf8");

    await writeFile(plan, "not json");
    await expectCode(readBaselinePlan(plan), "invalid-json");
    await expectCode(readBaselinePlan(plan, { limits: { maxFileBytes: 4 } }), "file-too-large");
  });
});
