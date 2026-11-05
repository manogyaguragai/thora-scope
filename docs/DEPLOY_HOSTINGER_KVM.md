# Deploy notes — Hostinger KVM (NOTES ONLY)

Nothing in this repo deploys anything. These are notes for the owner to act on by hand.

## What ships
`npm run build` → `dist/`: `index.html`, `assets/` (content-hashed JS/CSS/fonts), `models/thorax_sim.opt.glb`
(~11 MB), `decoders/basis_transcoder.{js,wasm}`. It is a static site: no backend, no database, no env secrets.
`npm test` (`tests/unit/dist-contents.test.ts`) guards that nothing from `assets_src/` and no duplicate transcoder
is in `dist/`. Copy `dist/` to the server, e.g. `rsync -av --delete dist/ user@host:/var/www/thorascope/`.

The build uses Vite's default `base: '/'`. Serving under a sub-path (e.g. `/thorascope/`) needs `base` set in
`vite.config.ts` and a rebuild; `config.modelUrl` / `decoderPath` follow `import.meta.env.BASE_URL`.

## nginx (Ubuntu KVM)
```nginx
server {
  listen 443 ssl http2;
  server_name thorascope.example.org;
  root /var/www/thorascope;
  # ssl_certificate ... (certbot --nginx)

  types {                       # add to mime.types if missing
    application/wasm      wasm;
    model/gltf-binary     glb;
    image/ktx2            ktx2;
    font/woff2            woff2;
  }

  # hashed by Vite: safe to cache forever
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }
  # NOT hashed: revalidate (ETag/Last-Modified) so a new build is picked up
  location /models/   { add_header Cache-Control "public, no-cache"; try_files $uri =404; }
  location /decoders/ { add_header Cache-Control "public, no-cache"; try_files $uri =404; }
  # the entry point must never be stale (it names the hashed bundle)
  location = /index.html { add_header Cache-Control "no-cache"; }
  location / { try_files $uri /index.html; }

  gzip on;
  gzip_types text/css application/javascript application/wasm model/gltf-binary image/svg+xml;
  # brotli (ngx_brotli module) if installed: brotli on; brotli_types <same list>;
  # Or precompress at build time and use gzip_static on; / brotli_static on;
}
```
- The glb is already meshopt + KTX2 compressed; gzip still trims a little but brotli/gzip mostly helps JS/CSS/wasm.
- `no-cache` means "revalidate", not "don't store": repeat visits get a 304 for the 11 MB glb.
- To make the glb/decoders immutable too, put a version in their filename and bump it in `src/core/config.ts`.
- Preloads in `index.html` (glb `as=fetch`, Inter woff2 `as=font`) are same-origin with `crossorigin`; keep the
  site on one origin or they will be fetched twice.

## No external network
The app makes no runtime requests off its own origin: no CDNs, fonts are self-hosted (`@fontsource/inter`),
decoders are local, no analytics (enforced by `tests/e2e/network.spec.ts`). A strict CSP fits:
`default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; img-src 'self' data: blob:;
connect-src 'self' data: blob:; style-src 'self' 'unsafe-inline'` (blob: workers = KTX2 + meshopt decoders;
inline style = the loading-screen critical CSS). Verify in the browser console after deploying.

## Not done
- Service worker / offline cache: deferred (T704). HTTP caching above covers repeat visits.
