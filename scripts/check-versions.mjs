import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const json = path => JSON.parse(read(path));
const manifest = json('package.json');
const npmLock = json('package-lock.json');
const tauri = json('src-tauri/tauri.conf.json');
const cargoPackage = read('src-tauri/Cargo.toml').match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
const cargoVersion = cargoPackage?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLock = read('src-tauri/Cargo.lock');
const launcherLock = cargoLock.match(/^\[\[package\]\]\s*\nname\s*=\s*"ccl-launcher"\s*\nversion\s*=\s*"([^"]+)"/m)?.[1];
const versions = {
  'package.json': manifest.version,
  'package-lock.json': npmLock.version,
  'package-lock.json (root package)': npmLock.packages?.['']?.version,
  'src-tauri/tauri.conf.json': tauri.version,
  'src-tauri/Cargo.toml': cargoVersion,
  'src-tauri/Cargo.lock': launcherLock,
};
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '') || Object.values(versions).some(version => version !== manifest.version)) {
  console.error('版本号缺失、不一致，或不符合 X.Y.Z 格式：');
  for (const [file, version] of Object.entries(versions)) console.error(`  ${file}: ${version ?? '未找到'}`);
  process.exitCode = 1;
} else {
  console.log(`版本号一致：${manifest.version}`);
}
