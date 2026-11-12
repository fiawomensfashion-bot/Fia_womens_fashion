# AGENTS.md — FIA catalogue

## What this is
A static, browse-only catalogue for FIA Women's Fashion (Bangladesh). Customers choose WhatsApp or Messenger to order. No backend, no database, no login, no payments, no customer data.

## Rules from the owner
- Always spell it **plazo**, never "palazzo" (the only exception is the search-alias list in `assets/site.js`, which maps what people might type to "plazo").
- Collections: Signature Linen Plazo, Swiss Cotton Plazo, Swiss Cotton Skirt.
- All product photos are **9:16**. Cards, gallery and thumbnails use `aspect-ratio: 9 / 16` with `object-fit: cover`.
- Keep the fonts DM Serif Display (headings) and Nunito (body). They are self-hosted in `assets/fonts`; do not add Google Fonts or any other outside request (the CSP in `_headers` blocks them).
- Hosting is Cloudflare Pages now and Netlify later. Everything must work on both: keep `netlify.toml`, `_headers` and `.node-version`, and do not use host-specific features.
- Facts to keep consistent everywhere: delivery ৳70 inside Dhaka; Cash on Delivery; quality guaranteed; free replacement within 7 days of delivery, no questions asked, with no end date; offers: buy 3 Swiss Cotton Plazos get 1 Signature Linen Plazo free, buy 3 Signature Linen Plazos get free delivery. Do not invent prices, measurements or other policy terms.

## Structure
- `data/*.json` is the source of truth (edited by the owner in Pages CMS via `.pages.yml`). `scripts/build-catalogue.mjs` turns it into `products.js` (generated, never hand-edit). `scripts/build-site.mjs` builds `dist/`: fingerprinted CSS/JS, responsive WebP copies of photos (240/480 px plus the untouched original), `/p/<code>/` pages with link-preview tags and JSON-LD, info pages, `404.html`, sitemap and robots.
- `index.html` is the template. `assets/site.js` is one IIFE that renders everything from `products.js` (`SETTINGS`, `OFFERS`, `PRODUCTS`, `SHOP_INFO`, `SIZE_GUIDE`). `assets/site.css` holds the design and theme variables.
- Photos live in `images/<collection-slug>/<colour>-<n>.webp`. Only photos referenced by `data/products.json` are built.

## Behaviour to preserve
- Hash routes (`/#/`, `/#/category/<slug>`, `/#/product/<code>`) plus real pages at `/p/<code>/` and info pages. Shared and WhatsApp links use `/p/<code>/` (except on `*.workers.dev`).
- Product page shows WhatsApp and Messenger buttons. Cards show one Order button that opens a chooser dialog. WhatsApp links use `wa.me/<number>?text=` with a pre-written message; on Android the app is opened directly with a timed fallback to the web link. Messenger cannot be prefilled, so the message is copied to the clipboard on tap.
- Every value from data goes through `esc()` before it is put into HTML.
- Site address for link previews: `PUBLIC_SITE_URL` env var, else `settings.siteUrl`, else the host's build variables.
- Accessibility: visible focus outlines, skip link, reduced-motion support, body text 17px or larger.
