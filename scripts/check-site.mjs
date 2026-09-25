import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const html = readFileSync('index.html', 'utf8');
const required = ['id="repos"', 'id="contactForm"', 'id="activity"', 'id="q"', 'id="topic"', 'id="lang"'];
for (const marker of required) if (!html.includes(marker)) throw Error(`Missing essential control: ${marker}`);
for (const path of ['app.js', 'sw.js', 'style.css', 'config.js', 'manifest.webmanifest', '404.html', 'favicon.svg']) if (!existsSync(path)) throw Error(`Missing linked asset: ${path}`);
const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
for (const icon of manifest.icons) if (!existsSync(icon.src.replace(/^\.\//, ''))) throw Error(`Missing app icon: ${icon.src}`);
for (const file of ['app.js', 'sw.js', 'config.js']) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (check.status) throw Error(`Invalid JavaScript: ${file}`);
}
console.log('Site files and scripts are valid.');
