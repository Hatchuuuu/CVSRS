import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "public", "ocr");
mkdirSync(output, { recursive: true });
copyFileSync(join(root, "node_modules/tesseract.js/dist/worker.min.js"), join(output, "worker.min.js"));
for (const name of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  copyFileSync(join(root, "node_modules/tesseract.js-core", name), join(output, name));
}
copyFileSync(join(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), join(output, "eng.traineddata.gz"));
console.log("Local OCR worker, engine and English model prepared.");
