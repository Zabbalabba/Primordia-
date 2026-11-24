// Build step. Usage: npm run build
//  - dist/primordia.html: the whole game in one file (double-click to play).
//  - dist/artifact.html: the same, shaped for publishing on claude.ai.
//  - sw.js: the offline cache for the installable version (GitHub Pages),
//    listing the game's files and stamped with a hash of their contents.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [join(root, 'js/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020'],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
// The installable-app tags only make sense on the hosted source version.
html = html.replace(/<!-- pwa[\s\S]*?<!-- \/pwa -->\s*/, '');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>', () => `<script>\n${js}\n</script>`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/primordia.html'), html);

// Artifact variant: the publisher supplies the document skeleton, so keep
// only what goes inside <head> (title, meta, fonts, style) and <body>.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset="utf-8">\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync(join(root, 'dist/artifact.html'), `${head.trim()}\n${body.trim()}\n`);
console.log(`dist/primordia.html ${(html.length / 1024).toFixed(0)} KB`);

// Offline cache for the installed app.
const shell = [
  'index.html',
  'style.css',
  'manifest.webmanifest',
  ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort().map((f) => `js/${f}`),
  ...readdirSync(join(root, 'icons')).filter((f) => f.endsWith('.png')).sort().map((f) => `icons/${f}`),
];
const hash = createHash('sha256');
for (const f of shell) hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 12);
const template = readFileSync(join(root, 'tools/sw-template.js'), 'utf8');
writeFileSync(
  join(root, 'sw.js'),
  template.replace("'__VERSION__'", JSON.stringify(version)).replace('[/* __SHELL__ */]', JSON.stringify(['./', ...shell], null, 2))
);
console.log(`sw.js ${version} (${shell.length + 1} files)`);
