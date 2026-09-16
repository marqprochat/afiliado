// Build da extensão Afilados Connect: copia os arquivos distribuíveis para dist/afilados-connect
// e gera dist/afilados-connect.zip (carregável em chrome://extensions → "Carregar sem compactação"
// apontando para a pasta, ou publicável a partir do zip).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const distRoot = path.join(root, 'dist');
const outDir = path.join(distRoot, 'afilados-connect');
const zipPath = path.join(distRoot, 'afilados-connect.zip');

const INCLUDE = ['manifest.json', 'background', 'content', 'popup', 'icons'];

fs.rmSync(distRoot, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const entry of INCLUDE) {
  fs.cpSync(path.join(root, entry), path.join(outDir, entry), { recursive: true });
}

// zip: PowerShell no Windows, `zip` nos demais; se nenhum existir, só a pasta é gerada
let zipped = false;
try {
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${outDir}\*' -DestinationPath '${zipPath}' -Force`,
    ]);
  } else {
    execFileSync('zip', ['-qr', zipPath, 'afilados-connect'], { cwd: distRoot });
  }
  zipped = fs.existsSync(zipPath);
} catch {
  zipped = false;
}

console.log(`Afilados Connect v${manifest.version} → ${path.relative(root, outDir)}`);
console.log(
  zipped
    ? `zip: ${path.relative(root, zipPath)}`
    : 'zip: ferramenta de compactação indisponível (só a pasta foi gerada)',
);
