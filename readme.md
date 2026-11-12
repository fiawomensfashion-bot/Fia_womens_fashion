# FIA Women's Fashion — catalogue website

A browse-only catalogue for Signature Linen Plazos, Swiss Cotton Plazos and Swiss Cotton Skirts. Customers look at the photos, pick a colour and order on **WhatsApp or Messenger** (they choose). There are no accounts, no payments and no customer data on the site.

Hosting today: **Cloudflare Pages**. Later: **Netlify**. The same files work on both (see "Moving to Netlify" below).

## How it fits together

| Where | What |
| --- | --- |
| `data/products.json` | Products, colours, prices, photos, descriptions |
| `data/offers.json` | The offer cards |
| `data/site-info.json` | About, Delivery, Returns, Privacy, Size Guide intro, promise badges |
| `data/sizes.json` | Size chart rows (one per collection) |
| `data/settings.json` | Shop name, WhatsApp number, Facebook page, website address, theme |
| `images/` | Product photos, one folder per collection |
| `assets/` | Website design (`site.css`), behaviour (`site.js`) and the fonts |
| `scripts/` | The build. It turns `data/` into the finished site in `dist/` |
| `.pages.yml` | Setup for Pages CMS (the editing screen) |

`products.js` is created by the build. Do not edit it by hand.

You normally edit everything in **Pages CMS** and never touch the code. When you save, GitHub updates and the host rebuilds the site.

## Photos (important)

- Shape: **9:16** (tall, like a phone screen). Every card and product page uses this shape. Any other shape is cropped to fit, so crop your photos to 9:16 first.
- Size: **1080 x 1920 px** is plenty. 720 x 1280 also looks good and loads faster.
- Format: **WebP**, aiming for about 100-200 KB each. Compress with any online compressor (for example Squoosh).
- Names: lowercase with dashes, like `red-1.webp`. Pages CMS renames uploads safely for you.
- Folders: `images/linen-plazo`, `images/swiss-cotton-plazo`, `images/swiss-cotton-skirt`.
- The build makes small phone-sized copies automatically. You never need to resize for phones yourself.

## Before you go live (checklist)

1. **Prices.** Enter the real price for each product in Pages CMS. Leave empty to show "Ask for price". Only fill "Previous price" if it was a real earlier price.
2. **Website address.** In Pages CMS > FIA Shop Settings, fill **Public Website Address** (for example `https://fia-women.pages.dev`). Without it, shared product links will not show a photo and title on Facebook and WhatsApp.
3. **Facebook Page username** (`messengerPage`). Open `https://m.me/YOURUSERNAME` to check it opens your page's chat.
4. **WhatsApp number** in international digits, no plus sign (Bangladesh: `8801XXXXXXXXX`).
5. **Delivery outside Dhaka.** The Delivery page says the charge depends on the area. Add your charges in `data/site-info.json` > `delivery` when you are ready.
6. **Measurements.** Fill `data/sizes.json` (waist range, length, hem) when you have them.
7. **Logo.** Upload your logo in Pages CMS > FIA Shop Settings.
8. Test: open a product link in Facebook Messenger or WhatsApp and check the preview. Facebook caches old previews; use the Facebook Sharing Debugger to refresh one.

## Names

The shop always writes **plazo** (never "palazzo"). Collections: **Signature Linen Plazo**, **Swiss Cotton Plazo**, **Swiss Cotton Skirt**. To rename a collection, change it in `data/sizes.json`, in `data/products.json` (the `category` and product names) and in the drop-down list in `.pages.yml`.

## Hosting

**Cloudflare Pages (now):** Framework: None. Build command: `npm run build`. Output directory: `dist`. Node 20 or newer (the `.node-version` file sets it).

### Moving to Netlify (later)

1. Create a Netlify site from the same GitHub repository. `netlify.toml` already holds the settings (`npm run build`, publish `dist`).
2. In Pages CMS > FIA Shop Settings, change **Public Website Address** to the new address (or your own domain), and save.
3. Nothing else changes. `_headers` and the 404 page work the same on both hosts.
4. Free Netlify plans count build minutes and deploys. While you are still testing, pause automatic production builds or keep testing on Cloudflare.

## Build it on your own computer

You need Node 20+. Run `npm install` and then `npm run build`. Open the `dist` folder through a local web server (for example `npx serve dist`), not by double-clicking the HTML file.

## Privacy and security

- No accounts, no order storage, no tracking scripts, and no outside requests (fonts are served from this site).
- `_headers` adds security headers and sensible caching.
- Never put customers' addresses, phone numbers or supplier records in the repository. Turn on two-factor login for GitHub and your host.
