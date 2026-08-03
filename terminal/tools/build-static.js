/* =============================================================================
 * build-static.js — package the site for a host that cannot run Node.
 *
 * Shared hosting (Hostinger Premium/Business, cPanel, any plain web space)
 * serves files and nothing else, so the backend has to live somewhere that
 * runs Node and the pages have to be told where that is. This writes an
 * upload-ready folder with the API base already pointed at it.
 *
 *   node tools/build-static.js https://verdict-api.onrender.com
 *
 * Then upload everything inside dist/static/ into public_html/.
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'static');

/* Everything the browser needs. The server/ and tests/ trees deliberately do
   not ship — a static host would serve config.json as plain text, keys and
   all, to anyone who guessed the URL. */
const COPY = ['css', 'js', 'fonts', 'favicon.svg'];
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

const apiOrigin = (process.argv[2] || '').replace(/\/+$/, '');
if (!apiOrigin) {
  console.error('usage: node tools/build-static.js https://your-backend.example.com');
  console.error('  (the origin only — /api is appended for you)');
  process.exit(1);
}
/* http:// is allowed for a backend on this machine — a local page calling a
   local port is not mixed content — and refused for anything else, because an
   https:// page silently blocks every call to an http:// API. */
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiOrigin);
if (!/^https:\/\//.test(apiOrigin) && !isLocal) {
  console.error('refusing to build: the backend must be https://, or browsers on an\n' +
                'https:// page will block every call as mixed content.');
  console.error('(http://localhost:PORT is allowed, for testing the split locally.)');
  process.exit(1);
}

function copyInto(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(f => copyInto(path.join(src, f), path.join(dest, f)));
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

COPY.forEach(rel => {
  const src = path.join(ROOT, rel);
  if (fs.existsSync(src)) copyInto(src, path.join(OUT, rel));
});
PAGES.forEach(p => fs.copyFileSync(path.join(ROOT, p), path.join(OUT, p)));

/* Point the client at the remote backend. live.js reads exactly this one
   value, so nothing else in the client has to change. */
const cfgPath = path.join(OUT, 'js', 'config.js');
const before = fs.readFileSync(cfgPath, 'utf8');
const after = before.replace(
  /(\/\* The live backend[^*]*\*\/\s*api:\s*\{\s*base:\s*)'[^']*'/,
  `$1'${apiOrigin}/api'`
);
if (after === before) {
  console.error('could not rewrite the API base in js/config.js — has it moved?');
  process.exit(1);
}
fs.writeFileSync(cfgPath, after);

/* Shared hosts serve .woff2 and .svg with the wrong type often enough that it
   is worth stating, and the whole site is static so it caches hard. */
fs.writeFileSync(path.join(OUT, '.htaccess'), `# Verdict — static site on shared hosting

<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

<IfModule mod_mime.c>
  AddType font/woff2 .woff2
  AddType image/svg+xml .svg
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript image/svg+xml
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  # Fingerprint-free filenames, so hold the markup briefly and the rest for long.
  ExpiresByType text/html                "access plus 10 minutes"
  ExpiresByType text/css                 "access plus 7 days"
  ExpiresByType application/javascript   "access plus 7 days"
  ExpiresByType font/woff2               "access plus 1 year"
  ExpiresByType image/svg+xml            "access plus 30 days"
</IfModule>

# The pages call the backend over https; keep the page itself on https too.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} off
  RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>

ErrorDocument 404 /index.html
`);

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);

console.log(`built ${path.relative(ROOT, OUT)}  ${count(OUT)} files`);
console.log(`  backend  ${apiOrigin}/api`);
console.log(`  upload the CONTENTS of dist/static/ into public_html/`);
console.log(`  (including the hidden .htaccess — turn on "show hidden files")`);
