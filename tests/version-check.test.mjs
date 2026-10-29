import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-versions.mjs', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ccl-version-test-'));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'src-tauri'));
  cpSync(script, join(root, 'scripts/check-versions.mjs'));
  const write = (path, content) => writeFileSync(join(root, path), content);
  write('package.json', JSON.stringify({version:'1.2.3'}));
  write('package-lock.json', JSON.stringify({version:'1.2.3',packages:{'':{version:'1.2.3'}}}));
  write('src-tauri/tauri.conf.json', JSON.stringify({version:'1.2.3'}));
  write('src-tauri/Cargo.toml', '[package]\nname = "ccl-launcher"\nversion = "1.2.3"\n[dependencies]\n');
  write('src-tauri/Cargo.lock', '[[package]]\nname = "ccl-launcher"\nversion = "1.2.3"\n');
  return {root, write, script:join(root,'scripts/check-versions.mjs')};
}

test('accepts consistent release versions', () => {
  const f = fixture();
  try { assert.match(execFileSync(process.execPath, [f.script], {encoding:'utf8'}), /1\.2\.3/); }
  finally { rmSync(f.root, {recursive:true, force:true}); }
});

test('rejects a stale Cargo lockfile', () => {
  const f = fixture();
  try {
    f.write('src-tauri/Cargo.lock', '[[package]]\nname = "ccl-launcher"\nversion = "1.2.2"\n');
    const result = spawnSync(process.execPath, [f.script], {encoding:'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src-tauri\/Cargo\.lock: 1\.2\.2/);
  } finally { rmSync(f.root, {recursive:true, force:true}); }
});
