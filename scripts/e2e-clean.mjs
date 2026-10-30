// Clears the end-to-end data directory before the test server starts. Works on every platform and refuses
// to touch anything outside .data/e2e.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), ".data", "e2e");
if (path.basename(root) !== "e2e" || path.basename(path.dirname(root)) !== ".data") {
  throw new Error(`Refusing to clean ${root}`);
}
fs.rmSync(root, { recursive: true, force: true });
console.log(`Cleaned ${root}`);
