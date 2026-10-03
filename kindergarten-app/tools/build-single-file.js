// Bundles the app into ONE self-contained .html file (no other files needed),
// e.g. to send over WhatsApp and open in a phone browser.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
const outDir = path.join(__dirname, '..', 'build-web');
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

for (const f of ['logic.js', 'app.js']) {
  if (/<\/script/i.test(read(f))) throw new Error(f + ' contains "</script" and cannot be inlined');
}

// Function replacers: the JS contains "$" sequences that String.replace would otherwise interpret.
let html = read('index.html')
  .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>\s*/, () => '') // inline scripts need no CSP here
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${read('styles.css')}\n</style>`)
  .replace('<script src="logic.js"></script>', () => `<script>\n${read('logic.js')}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${read('app.js')}\n</script>`);

if (/(src|href)="(styles|logic|app)\./.test(html)) throw new Error('an asset was not inlined');

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'KindergartenManager.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
