import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const TEST_DIR = path.join(ROOT_DIR, "tests");

const files = (await readdir(TEST_DIR))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

let passed = 0;
for (const file of files) {
  const startedAt = Date.now();
  await import(pathToFileURL(path.join(TEST_DIR, file)).href);
  passed += 1;
  console.log(`OK ${file} (${Date.now() - startedAt}ms)`);
}

console.log(`\n${passed}/${files.length} test files passed`);
