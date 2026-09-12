import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceFingerprint } from "../src/atlasSourceFingerprint.js";

test("fingerprint detects source changes, normalizes checkout EOL and excludes secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-fingerprint-"));
  try {
    mkdirSync(join(root,"src")); mkdirSync(join(root,"public"));
    for (const path of ["package.json","package-lock.json","public/macro.html","public/macro.js","public/macro.css","public/macroModel.js"]) writeFileSync(join(root,path),"{}\n");
    writeFileSync(join(root,"src/a.js"),"export const n = 1;\n");
    const original = sourceFingerprint(root);
    writeFileSync(join(root,"src/a.js"),"export const n = 1;\r\n");
    writeFileSync(join(root,".env"),"PRIVATE=not-real\n");
    assert.deepEqual(sourceFingerprint(root), original);
    writeFileSync(join(root,"src/a.js"),"export const n = 2;\n");
    assert.notEqual(sourceFingerprint(root).digest, original.digest);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
