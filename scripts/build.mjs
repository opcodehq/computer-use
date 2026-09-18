import { build } from 'esbuild';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
await mkdir('dist/renderer', { recursive: true });
await build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external' });
await build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await build({ entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', bundle: true, platform: 'browser' });
await copyFile('src/renderer/index.html', 'dist/renderer/index.html');
await copyFile('src/renderer/style.css', 'dist/renderer/style.css');
await mkdir('dist/renderer/fonts', { recursive: true });
for (const name of ['BarlowCondensed-Medium.ttf', 'OFL.txt']) await copyFile(`src/renderer/fonts/${name}`, `dist/renderer/fonts/${name}`);

await build({ entryPoints: ['src/tool/cli.ts'], outfile: 'dist/cli.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', banner: { js: '#!/usr/bin/env bun' } });
await chmod('dist/cli.mjs', 0o755);
