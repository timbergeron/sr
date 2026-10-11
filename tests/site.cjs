const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const localURL = 'http://sr.test/sr/';

// A browser origin with routed static files also works when localhost ports are
// unavailable. Pass a real URL to check a deployed app instead.
async function routeSite(page, url) {
  await page.route('**/*', async route => {
    const requested = route.request().url();
    if (requested.startsWith('blob:') || requested.startsWith('data:')) return route.continue();
    if (!requested.startsWith(url)) return route.abort();
    if (url !== localURL) return route.continue();
    const name = decodeURIComponent(new URL(requested).pathname.slice('/sr/'.length)) || 'index.html';
    let file = path.resolve(root, name);
    if (!file.startsWith(root + '/') || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    return route.fulfill({ contentType: { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
      '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file) });
  });
}

function launchBrowser(type) {
  return type.launch({ headless: true, ...(process.env.SR_BROWSER_EXECUTABLE ? { executablePath: process.env.SR_BROWSER_EXECUTABLE } : {}) });
}

module.exports = { localURL, routeSite, launchBrowser };
