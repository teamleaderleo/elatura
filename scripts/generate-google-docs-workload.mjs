// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PARAGRAPH_CODE_UNITS = 160;
const FILLER =
  "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau ";
const FIXTURES = Object.freeze([
  Object.freeze({
    id: "docs-large-text-v1",
    documents: 1,
    paragraphs: 4_800,
    anchorEvery: 480,
  }),
  Object.freeze({
    id: "docs-switch-8-v1",
    documents: 8,
    paragraphs: 1_800,
    anchorEvery: 180,
  }),
]);

function usage() {
  console.error(
    "Usage: node scripts/generate-google-docs-workload.mjs --out <directory>",
  );
}

function parseOutputDirectory(args) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    usage();
    process.exit(0);
  }
  if (args.length !== 2 || args[0] !== "--out" || !args[1]) {
    throw new Error("Expected exactly --out <directory>.");
  }
  return resolve(args[1]);
}

function fixedParagraph(
  fixtureId,
  documentOrdinal,
  paragraphOrdinal,
  anchorEvery,
) {
  const anchorOrdinal =
    paragraphOrdinal % anchorEvery === 0 ? paragraphOrdinal / anchorEvery : null;
  const prefix =
    [
      `ELATURA fixture=${fixtureId}`,
      `doc=${String(documentOrdinal).padStart(2, "0")}`,
      `paragraph=${String(paragraphOrdinal).padStart(5, "0")}`,
      ...(anchorOrdinal === null
        ? []
        : [`anchor=${String(anchorOrdinal).padStart(2, "0")}`]),
    ].join(" ") + " ";
  if (prefix.length > PARAGRAPH_CODE_UNITS) {
    throw new Error("Paragraph prefix exceeds fixed width.");
  }
  let body = "";
  while (prefix.length + body.length < PARAGRAPH_CODE_UNITS) body += FILLER;
  return `${prefix}${body.slice(0, PARAGRAPH_CODE_UNITS - prefix.length)}`;
}

function buildDocument(fixture, documentOrdinal) {
  const paragraphs = [];
  for (
    let paragraphOrdinal = 0;
    paragraphOrdinal < fixture.paragraphs;
    paragraphOrdinal += 1
  ) {
    paragraphs.push(
      fixedParagraph(
        fixture.id,
        documentOrdinal,
        paragraphOrdinal,
        fixture.anchorEvery,
      ),
    );
  }
  return `${paragraphs.join("\n")}\n`;
}

function digest(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

try {
  const outputDirectory = parseOutputDirectory(process.argv.slice(2));
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generator: "google-docs-workload-v1",
    fixtures: [],
  };

  for (const fixture of FIXTURES) {
    const files = [];
    for (
      let documentOrdinal = 0;
      documentOrdinal < fixture.documents;
      documentOrdinal += 1
    ) {
      const text = buildDocument(fixture, documentOrdinal);
      const suffix =
        fixture.documents === 1
          ? ""
          : `-${String(documentOrdinal + 1).padStart(2, "0")}`;
      const fileName = `${fixture.id}${suffix}.txt`;
      await writeFile(resolve(outputDirectory, fileName), text, "utf8");
      files.push({
        fileName,
        documentOrdinal,
        paragraphCount: fixture.paragraphs,
        anchorCount: Math.ceil(fixture.paragraphs / fixture.anchorEvery),
        textCodeUnits: text.length,
        sha256: digest(text),
      });
    }
    manifest.fixtures.push({ id: fixture.id, files });
  }

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(resolve(outputDirectory, "manifest.json"), manifestText, "utf8");
  process.stdout.write(manifestText);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exitCode = 1;
}
