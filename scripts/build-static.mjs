import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "public");

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "src"), { recursive: true });

for (const file of ["index.html", "styles.css"]) {
  await copyFile(resolve(root, file), resolve(output, file));
}

for (const file of ["app.js", "domain.js", "model.js", "store.js"]) {
  await copyFile(resolve(root, "src", file), resolve(output, "src", file));
}

console.log("STATIC BUILD: ĐẠT · public/ đã sẵn sàng cho Vercel");
