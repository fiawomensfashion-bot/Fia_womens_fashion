// FIA production build for Cloudflare Pages and Netlify.
// Uses already-compressed originals as full-resolution images, and makes only
// two smaller variants for display. Only catalogue-referenced photos are built.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(base, 'dist');
const images = path.join(base, 'images');
const products = JSON.parse(await fs.readFile(path.join(base,'.fia-generated-products.json'),'utf8'));
const settings = JSON.parse(await fs.readFile(path.join(base,'data/settings.json'),'utf8'));
const shopInfo = JSON.parse(await fs.readFile(path.join(base,'data/site-info.json'),'utf8'));
const sizes = JSON.parse(await fs.readFile(path.join(base,'data/sizes.json'),'utf8'));
// Public address of the site, used for link previews (Facebook/WhatsApp), canonical tags and the sitemap.
// Order of preference: PUBLIC_SITE_URL (hosting environment variable), then "siteUrl" in
// data/settings.json (editable in Pages CMS > FIA Shop Settings), then the host's own build variables.
const fromSettings = String(settings.siteUrl || '').trim();
const settingsOrigin = fromSettings && !/^https?:\/\//i.test(fromSettings) ? 'https://' + fromSettings : fromSettings;
const origin = String(process.env.PUBLIC_SITE_URL || settingsOrigin || process.env.CF_PAGES_URL || process.env.URL || '').trim().replace(/\/+$/,'');
const safeOrigin = /^https:\/\/[^/\s]+$/i.test(origin) ? origin : '';
const imageExtensions = /\.(?:webp|png|jpe?g|avif)$/i;
const contentHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12);
const escapeHtml = value => String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const encodeSegments = pathName => pathName.split('/').map(encodeURIComponent).join('/');
const normaliseImage = img => {
  if (typeof img !== 'string') return null;
  const s=img.trim().replace(/^\/?images\//,'').replace(/^\/+/, '');
  if (!s || s.includes('\\') || s.split('/').some(p=>p==='..'||p==='.'||!p)) return null;
  return s;
};
const selected = new Set();
for (const p of products) for (const img of (p.images || [])) {
  const file=normaliseImage(img);
  if (file) selected.add(file);
}
const logo=normaliseImage(settings.logo);
if (logo) selected.add(logo);
const ogImageRel=normaliseImage(settings.ogImage);
if (ogImageRel) selected.add(ogImageRel);
// Only these need a plain copy under /images/ (the site logo is read from there directly).
// Every other photo is served from the optimised, fingerprinted files, so nothing is stored twice.
const needsPlainCopy = new Set([logo].filter(Boolean));
await fs.rm(dist,{recursive:true,force:true});
await fs.mkdir(path.join(dist,'assets'),{recursive:true});
await fs.mkdir(path.join(dist,'images','optimized'),{recursive:true});
await fs.cp(path.join(base,'assets','fonts'),path.join(dist,'assets','fonts'),{recursive:true});
await fs.copyFile(path.join(base,'products.js'),path.join(dist,'products.js'));
await fs.copyFile(path.join(base,'_headers'),path.join(dist,'_headers'));
const template = await fs.readFile(path.join(base,'index.html'),'utf8');
let homepage = template;
for (const ext of ['css','js']) {
  const bytes=await fs.readFile(path.join(base,'assets',`site.${ext}`));
  const hashed=`site.${contentHash(bytes)}.${ext}`;
  await fs.writeFile(path.join(dist,'assets',hashed),bytes);
  homepage=homepage.replace(`/assets/site.${ext}`,`/assets/${hashed}`);
}
const makeSrc = rel => '/images/'+encodeSegments(rel);
const manifest=Object.create(null);
let originalsBytes=0, generatedBytes=0, converted=0, missing=0;
const paths=[...selected].sort();
// Bounded concurrency speeds up Cloudflare builds without excessive memory.
const workers=4;
let next=0;
async function processPhoto(rel) {
  const source=path.join(images,...rel.split('/'));
  if (!path.resolve(source).startsWith(path.resolve(images)+path.sep)) throw new Error('Unsafe image path');
  let raw;
  try { raw=await fs.readFile(source); } catch(e) { console.warn('MISSING PHOTO:',rel); missing++; return; }
  const dest=path.join(dist,'images',...rel.split('/'));
  const plainCopy=async()=>{ await fs.mkdir(path.dirname(dest),{recursive:true}); await fs.copyFile(source,dest); };
  originalsBytes+=raw.length;
  if (needsPlainCopy.has(rel) || !imageExtensions.test(rel)) await plainCopy();
  if (!imageExtensions.test(rel)) return;
  try {
    const meta=await sharp(raw).metadata();
    const uprightWidth=meta.orientation>=5&&meta.orientation<=8?meta.height:meta.width;
    if (!uprightWidth) throw Error('Missing image dimensions');
    const list=[];
    // Keep original WebP unchanged (already ~100 KB). Produce small card sizes.
    for (const size of [240,480]) {
      if (size>=uprightWidth) continue;
      const outputRel=`images/optimized/${rel.replace(/\.[^.]+$/, '')}.${contentHash(raw)}.w${size}.webp`;
      const outputFile=path.join(dist,...outputRel.split('/'));
      await fs.mkdir(path.dirname(outputFile),{recursive:true});
      const result=await sharp(raw).rotate().resize({width:size,withoutEnlargement:true})
        .toColourspace('srgb').webp({quality:size===240?72:80,effort:1}).toFile(outputFile);
      generatedBytes+=result.size;
      list.push({w:result.width,src:outputRel});
    }
    // Use an immutable, content-hashed COPY of the original image as the
    // largest srcset candidate; do not recompress the already-optimised file.
    const originalRel=`images/optimized/${rel.replace(/\.[^.]+$/, '')}.${contentHash(raw)}.original${path.extname(rel)}`;
    const originalCopy=path.join(dist,...originalRel.split('/'));
    await fs.mkdir(path.dirname(originalCopy),{recursive:true});
    await fs.copyFile(source,originalCopy);
    list.push({w:uprightWidth,src:originalRel});
    list.sort((a,b)=>a.w-b.w);
    manifest[rel]=list;
    converted++;
  } catch(e) { console.warn('Image optimization skipped:',rel,e.message); await plainCopy(); }
}
await Promise.all(Array.from({length:workers},async()=>{
  while(next<paths.length) { const i=next++; await processPhoto(paths[i]); }
}));
const manifestSource =
  '/* Generated FIA responsive images and stable public URL. No visitor tracking. */\n' +
  'window.FIA_PUBLIC_SITE_ORIGIN = '+JSON.stringify(safeOrigin)+';\n' +
  'window.FIA_IMAGE_MANIFEST = '+JSON.stringify(manifest)+';\n';
await fs.writeFile(path.join(dist,'image-manifest.js'),manifestSource);

// The HTML changes on every catalogue or UI update. Unlike an unversioned
// products.js, a fingerprinted URL cannot accidentally reuse an old browser copy.
const productsSource=await fs.readFile(path.join(base,'products.js'));
const productAsset=`products.${contentHash(productsSource)}.js`;
const manifestAsset=`image-manifest.${contentHash(Buffer.from(manifestSource))}.js`;
await fs.writeFile(path.join(dist,productAsset),productsSource);
await fs.writeFile(path.join(dist,manifestAsset),manifestSource);
homepage=homepage.replace('src="/products.js"',`src="/${productAsset}"`)
  .replace('src="/image-manifest.js"',`src="/${manifestAsset}"`);

// A tiny, non-personal status file lets already-open tabs detect fresh stock,
// prices, colours and buttons without making customers clear their browser cache.
const versionHash=crypto.createHash('sha256')
  .update(productsSource).update(manifestSource).update(template)
  .update(await fs.readFile(path.join(base,'assets/site.css')))
  .update(await fs.readFile(path.join(base,'assets/site.js')))
  .digest('hex').slice(0,16);
await fs.writeFile(path.join(dist,'site-version.json'),JSON.stringify({version:versionHash})+'\n');
homepage=homepage.replace('</head>',
  `  <meta name="fia-build-version" content="${versionHash}">\n</head>`);

const absolute=(suffix)=>safeOrigin+suffix;
const shopName=String(settings.shopName||"FIA Women's Fashion");
const highlights=Array.isArray(shopInfo.highlights)?shopInfo.highlights.map(String).filter(Boolean):[];
const brNewlines=text=>escapeHtml(text).replace(/\r?\n/g,'<br>');
const clip=(text,max)=>{
  const t=String(text||'').replace(/\s+/g,' ').trim();
  if (t.length<=max) return t;
  const cut=t.slice(0,max-1), at=cut.lastIndexOf(' ');
  return (at>40?cut.slice(0,at):cut).replace(/[\s,;:.\-–—]+$/,'')+'…';   // never cut a word in half
};
const firstSentence=text=>{ const t=String(text||'').trim(); const m=/^(.+?[.!?])(\s|$)/.exec(t); return m?m[1]:t; };
// Best public file for a photo: the fingerprinted original (largest) or a card-sized WebP.
const publicImage=(rel,minWidth)=>{
  const list=manifest[rel];
  if (!list||!list.length) return makeSrc(rel);
  const pick=list.find(v=>v.w>=minWidth)||list[list.length-1];
  return '/'+encodeSegments(pick.src);
};
const firstProductImage=products.map(p=>(p.images||[]).map(normaliseImage).filter(Boolean)[0]).find(Boolean);
const homeImageRel=ogImageRel||firstProductImage||'';
const homeImage=homeImageRel&&safeOrigin?absolute(publicImage(homeImageRel,1200)):'';
const mainDescription="Shop FIA Women's Fashion: Signature Linen Plazos, Swiss Cotton Plazos and Swiss Cotton Skirts in every colour. Quality guaranteed, free replacement. Order on WhatsApp or Messenger.";
const mainTitle="FIA Women's Fashion — Linen Plazos, Swiss Cotton Plazos & Skirts";
const replaceMeta=(html,title,description,imageUrl,url,type='website')=>{
  let out=html;
  out=out.replace(/<title>[\s\S]*?<\/title>/,`<title>${escapeHtml(title)}</title>`);
  out=out.replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${escapeHtml(description)}">`);
  out=out.replace(/<meta property="og:title" content="[^"]*">/,`<meta property="og:title" content="${escapeHtml(title)}">`);
  out=out.replace(/<meta property="og:description" content="[^"]*">/,`<meta property="og:description" content="${escapeHtml(description)}">`);
  out=out.replace(/<meta property="og:type" content="[^"]*">/,`<meta property="og:type" content="${escapeHtml(type)}">`);
  const tags=[];
  if (imageUrl) {
    tags.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`);
  }
  if (url) { tags.push(`<meta property="og:url" content="${escapeHtml(url)}">`); tags.push(`<link rel="canonical" href="${escapeHtml(url)}">`); }
  out=out.replace('</head>',tags.join('\n  ')+'\n</head>');
  return out;
};
const homepageHtml=replaceMeta(homepage,mainTitle,mainDescription,homeImage,safeOrigin?safeOrigin+'/':'');
await fs.writeFile(path.join(dist,'index.html'),homepageHtml);
const infoPages={
  about:['About FIA',shopInfo.about], delivery:['Delivery & Cash on Delivery',shopInfo.delivery],
  returns:['Returns & Replacements',shopInfo.returns], privacy:['Privacy',shopInfo.privacy],
  'size-guide':['Size Guide',shopInfo.sizeIntro]
};
for (const [route,[title,text]] of Object.entries(infoPages)) {
  const url=safeOrigin?absolute(`/${route}/`):'';
  const page=replaceMeta(homepage,title+" | "+shopName,clip(String(text||'').replace(/\s+/g,' '),200),homeImage,url);
  const built=page.replace(/<main id="app" tabindex="-1">[\s\S]*?<\/main>/,
    `<main id="app" tabindex="-1"><article class="wrap"><h1>${escapeHtml(title)}</h1><p>${brNewlines(text)}</p></article></main>`);
  const file=path.join(dist,route,'index.html');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,built);
}
for (const product of products) {
  const id=String(product.id);
  // Product ids are public URL segments and local directories: validate strictly.
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Unsafe product ID: '+id);
  const route=`/p/${encodeURIComponent(id)}/`;
  const url=safeOrigin?absolute(route):'';
  const first=(product.images||[]).map(normaliseImage).filter(Boolean)[0];
  const firstAbs=first && safeOrigin?absolute(publicImage(first,1200)):'';   // full-size photo for link previews
  const firstSmall=first?publicImage(first,480):'';
  const fullDescription=String(product.description||`Explore ${product.name} at ${shopName}.`).replace(/\s+/g,' ').trim();
  const priceNote=product.price!=null?`Price ৳${Number(product.price).toLocaleString('en-US')}.`:'';
  // Short, complete description for Google and for Facebook/WhatsApp previews.
  const description=clip([product.name+'.',priceNote,firstSentence(fullDescription),highlights.join(' · ')+(highlights.length?'.':'')].filter(Boolean).join(' '),200);
  const title=String(product.name)+' | '+shopName;
  const productPage=replaceMeta(homepage,title,description,firstAbs,url,'product');
  const stock=product.inStock === true ? 'InStock' : product.inStock===false ? 'OutOfStock' : '';
  const offer={ '@type':'Offer', priceCurrency:'BDT', price:product.price, itemCondition:'https://schema.org/NewCondition', url:url || undefined, availability:stock?'https://schema.org/'+stock:undefined };
  const jsonLd={ '@context':'https://schema.org', '@type':'Product', name:product.name, sku:id, description:fullDescription,
    brand:{'@type':'Brand',name:'FIA'}, color:product.variantColor&&product.variantColor!=='Main product'?product.variantColor:undefined,
    category:product.category, image:firstAbs || undefined, offers:product.price==null?undefined:offer };
  const ld=JSON.stringify(jsonLd).replace(/</g,'\\u003c');
  const fallback=`<main id="app" tabindex="-1"><article class="wrap"><h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(fullDescription)}</p>${firstSmall?`<img width="360" height="640" loading="lazy" src="${escapeHtml(firstSmall)}" alt="${escapeHtml(product.name)}">`:''}<p><a href="/#/">Browse all FIA colours</a></p></article></main>`;
  const html=productPage.replace('</head>',`<script type="application/ld+json">${ld}</script>\n</head>`)
    .replace(/<main id="app" tabindex="-1">[\s\S]*?<\/main>/, fallback);
  const file=path.join(dist,'p',id,'index.html');
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,html);
}
// 404 page (Cloudflare Pages and Netlify both serve /404.html for unknown addresses).
{
  const page=replaceMeta(homepage,"Page not found | "+shopName,"This page does not exist. Browse FIA Women's Fashion.",'','')
    .replace('</head>','  <meta name="robots" content="noindex">\n</head>')
    .replace(/<main id="app" tabindex="-1">[\s\S]*?<\/main>/,
      '<main id="app" tabindex="-1"><article class="wrap"><h1>Page not found</h1><p>Sorry, we could not find that page.</p><p><a href="/#/">Back to the FIA shop</a></p></article></main>');
  await fs.writeFile(path.join(dist,'404.html'),page);
}
const sitemapLinks=['/',...Object.keys(infoPages).map(p=>'/'+p+'/'),...products.map(p=>`/p/${encodeURIComponent(p.id)}/`)];
if (safeOrigin) await fs.writeFile(path.join(dist,'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+
  sitemapLinks.map(p=>'<url><loc>'+escapeHtml(absolute(p))+'</loc></url>').join('')+'</urlset>');
await fs.writeFile(path.join(dist,'robots.txt'),`User-agent: *\nAllow: /\n${safeOrigin?'Sitemap: '+absolute('/sitemap.xml')+'\n':''}`);
console.log(`FIA generated: ${products.length} linked product pages, ${Object.keys(infoPages).length} store pages, ${converted} optimized image sets, ${missing} missing image(s).`);
console.log(`Source photos: ${(originalsBytes/1024/1024).toFixed(2)} MiB; new small image variants: ${(generatedBytes/1024/1024).toFixed(2)} MiB.`);
if (safeOrigin) console.log('Public site address for link previews: '+safeOrigin);
else console.warn('\n*** LINK PREVIEWS NEED A SITE ADDRESS ***\nSet "siteUrl" in data/settings.json (or PUBLIC_SITE_URL in the host settings) to your public https:// address,\nfor example https://fia-women.pages.dev . Without it, shared product links will not show a photo or title in Facebook/WhatsApp.\n');
