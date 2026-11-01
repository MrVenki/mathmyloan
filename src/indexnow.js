// Tells Bing and other IndexNow search engines about every URL after a deploy.
// Never fails the deploy: indexing pings are best effort.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

try {
  const urlList = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'urls.json'), 'utf8'));
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(cfg.siteUrl).host,
      key: cfg.indexNowKey,
      keyLocation: `${cfg.siteUrl}/${cfg.indexNowKey}.txt`,
      urlList,
    }),
  });
  console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`);
} catch (err) {
  console.warn(`IndexNow skipped: ${err.message}`);
}
