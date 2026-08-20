#!/usr/bin/env node
// Package Moondash for Windows using @electron/packager
// Produces: dist-release/Moondash-win32-x64/ (unpacked) + Moondash-win32-x64.zip
import { packager } from '@electron/packager';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const webDist = path.join(root, '..', 'web', 'dist');

// Ensure web dist exists
if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  console.error('ERROR: web/dist not found. Run "npm run build:web" first.');
  process.exit(1);
}

// Bundle web/dist inside the desktop folder so it gets packed into the ASAR.
const bundledWebDist = path.join(root, '_web-dist');
console.log('📋 Copying web/dist into desktop for packaging...');
fs.rmSync(bundledWebDist, { recursive: true, force: true });
fs.cpSync(webDist, bundledWebDist, { recursive: true });
console.log('   Copied', fs.readdirSync(bundledWebDist).length, 'items');

console.log('\n📦 Packaging Moondash for Windows...\n');
console.log('  Source:', root);
console.log('  Web dist:', webDist, '→ bundled as _web-dist/');
console.log('  Output:', path.join(root, 'dist-release'));
console.log('');

const appBundle = await packager({
  dir: root,
  out: path.join(root, 'dist-release'),
  name: 'Moondash',
  appVersion: '1.0.0',
  platform: 'win32',
  arch: 'x64',
  icon: path.join(root, 'build', 'icon.ico'),
  overwrite: true,
  asar: true,
  prune: true,
  ignore: [
    /^\/scripts$/,
    /^\/scripts\/.*$/,
    /^\/dist-release$/,
    /^\/dist-release\/.*$/,
    /^\/\.git$/,
    /^\/\.git\/.*$/,
    /^\/node_modules\/\.cache$/,
    /package-lock\.json$/,
    /\.mjs$/
  ],
  extraResource: [],
  win32metadata: {
    CompanyName: 'Moondash',
    FileDescription: 'Moondash - Markdown editor with sync',
    OriginalFilename: 'Moondash.exe',
    ProductName: 'Moondash',
    InternalName: 'moondash'
  }
});

// Clean up the temporary bundled web dist
fs.rmSync(bundledWebDist, { recursive: true, force: true });
console.log('🧹 Cleaned up temporary _web-dist/');

console.log('\n✅ Packaging complete!\n');

// List output
const outDir = appBundle[0];
console.log('📁 Output directory:', outDir);
const files = fs.readdirSync(outDir);
console.log('   Files:', files.length);
const exePath = path.join(outDir, 'Moondash.exe');
if (fs.existsSync(exePath)) {
  const stat = fs.statSync(exePath);
  console.log('   Moondash.exe:', (stat.size / 1024 / 1024).toFixed(1) + ' MB');
}

// Create a zip for easy distribution
console.log('\n🗜️  Creating zip archive...');
const { execSync } = await import('child_process');
const zipName = 'Moondash-1.0.0-win32-x64.zip';
const zipPath = path.join(root, 'dist-release', zipName);

try {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'pipe' }
  );
  const zipStat = fs.statSync(zipPath);
  console.log(`   ${zipName}: ${(zipStat.size / 1024 / 1024).toFixed(1)} MB`);
} catch (e) {
  console.log('   ⚠️  Zip creation failed (zip not installed). You can zip manually.');
  console.log('   Directory:', outDir);
}

console.log('\n🎉 Done! To install:');
console.log('   1. Run Moondash.exe from the dist-release folder, OR');
console.log('   2. Extract the zip and run Moondash.exe');
console.log('');
