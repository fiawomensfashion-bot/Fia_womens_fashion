// FIA Catalogue Builder — colour-variant edition.
// Pages CMS edits data/*.json. Netlify runs this command before publishing.
// Every main product becomes a card, even when it has colours. Each colour also
// becomes its own card and all cards share a group for colour switching.
import fs from 'node:fs';
import path from 'node:path';

const base = process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(path.join(base, 'data', file), 'utf8'));
const settings = read('settings.json');
const offers = read('offers.json');
const records = read('products.json');
const siteInfo = read('site-info.json');
const sizeGuide = read('sizes.json');
if (!Array.isArray(records) || !Array.isArray(offers) || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
  throw new Error('Expected products.json and offers.json to be arrays, and settings.json to be an object.');
}

// The list of collections lives in data/sizes.json (one row per collection) and in .pages.yml (the CMS drop-down).
const categories = new Set(sizeGuide.map(row => String(row.collection || '').trim()).filter(Boolean));
const usedIds = new Set();
const products = [];
const asText = (value) => String(value ?? '').trim();
const validPrice = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const cleanImage = (image) => {
  if (typeof image !== 'string') return null;
  const s = image.trim();
  if (!s || /^https?:|^data:|^\/\//i.test(s)) return null;
  const stripped = s.replace(/^\/?images\//, '').replace(/^\/+/, '');
  if (!stripped || stripped.split('/').some(part => part === '..' || part === '.' || part === '')) return null;
  return stripped;
};
const imageList = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(cleanImage).filter(Boolean);
const optionalOld = (value, price) => price !== null && validPrice(value) && Number(value) > price ? Number(value) : null;
const addProduct = (p) => {
  if (usedIds.has(p.id)) throw new Error(`Duplicate product/colour code: ${p.id}`);
  usedIds.add(p.id);
  products.push(p);
};

for (const parent of records) {
  if (!parent || typeof parent !== 'object') continue;
  const id = asText(parent.id);
  const name = asText(parent.name);
  const category = asText(parent.category);
  if (!id || !name || !categories.has(category)) {
    console.warn(`Skipping product ${JSON.stringify(id || name)}: needs an ID, name and a collection that exists in data/sizes.json.`);
    continue;
  }
  const basePrice = validPrice(parent.price) ? Number(parent.price) : null;
  const baseImages = imageList(parent.images);
  const baseDetails = {};
  for (const [key, label] of [['fabric','Fabric'], ['size','Size'], ['waist','Waist'], ['design','Design'], ['care','Care']]) {
    if (asText(parent[key])) baseDetails[label] = asText(parent[key]);
  }
  const variants = Array.isArray(parent.variants) ? parent.variants : [];

  // Always show the main product in the shop feed. Before this fix, the
  // main product disappeared as soon as a colour was added to `variants`.
  const mainColour = asText(parent.mainColor) || 'Main product';
  const mainHex = /^#[0-9a-f]{6}$/i.test(asText(parent.mainHex)) ? asText(parent.mainHex) : '';
  const fallbackImages = variants.flatMap(v => imageList(v?.images)).slice(0, 1);
  { // Unpriced items remain visible with 'Ask for price' instead of invented prices.
    const mainDetails = { ...baseDetails };
    if (asText(parent.mainColor)) mainDetails.Colour = asText(parent.mainColor);
    if (!baseImages.length && fallbackImages.length) {
      console.warn(`Main product ${id} has no main photos; displaying the first colour photo as a preview. Upload Main Product Photos to replace it.`);
    }
    addProduct({
      id,
      groupId: id,
      groupName: name,
      isMainProduct: true,
      // A non-empty variantColor includes the parent in the existing colour picker.
      variantColor: mainColour,
      variantHex: mainHex,
      name: asText(parent.mainColor) ? `${name} — ${asText(parent.mainColor)}` : name,
      category,
      price: basePrice,
      oldPrice: optionalOld(parent.oldPrice, basePrice),
      images: baseImages.length ? baseImages : fallbackImages,
      description: asText(parent.description),
      details: mainDetails,
      inStock: parent.inStock === true ? true : parent.inStock === false ? false : null,
      featured: parent.featured === true
    });
  }

  // Show every additional colour as its own card. All colours and the main
  // listing are joined by groupId, so visitors can switch in either direction.
  for (const v of variants) {
    if (!v || typeof v !== 'object') continue;
    const variantId = asText(v.id);
    const colour = asText(v.color);
    const price = validPrice(v.price) ? Number(v.price) : basePrice;
    if (!variantId || !colour) {
      console.warn(`Skipping colour ${JSON.stringify(colour)} for ${id}: requires unique code and colour.`);
      continue;
    }
    const oldVal = validPrice(v.oldPrice) ? v.oldPrice : parent.oldPrice;
    const swatch = /^#[0-9a-f]{6}$/i.test(asText(v.hex)) ? asText(v.hex) : '';
    const colourImages = imageList(v.images);
    if (!colourImages.length) console.warn(`Colour ${variantId} has no photos. Upload photos for this colour so its gallery is accurate.`);
    if (variantId === id) throw new Error(`Colour code ${variantId} must differ from its main product code.`);
    if (asText(parent.mainColor).toLowerCase() === colour.toLowerCase() && asText(parent.mainColor)) {
      console.warn(`Main product ${id} and additional colour ${variantId} are both labeled ${colour}; consider removing the duplicate colour entry.`);
    }
    addProduct({
      id: variantId,
      groupId: id,
      groupName: name,
      isMainProduct: false,
      variantColor: colour,
      variantHex: swatch,
      name: `${name} — ${colour}`,
      category,
      price,
      oldPrice: optionalOld(oldVal, price),
      // Do NOT reuse the main colour's photos if this colour has no gallery.
      images: colourImages,
      description: asText(v.description) || asText(parent.description),
      details: { ...baseDetails, Colour: colour },
      inStock: v.inStock === true ? true : v.inStock === false ? false : null,
      featured: v.featured === true
    });
  }
}

const output = [
  '/* GENERATED BY FIA BUILD SCRIPT — edit products in Pages CMS, not in this file. */',
  `const SETTINGS = ${JSON.stringify(settings, null, 2)};`,
  `const OFFERS = ${JSON.stringify(offers, null, 2)};`,
  `const PRODUCTS = ${JSON.stringify(products, null, 2)};`,
  `const SHOP_INFO = ${JSON.stringify(siteInfo, null, 2)};`,
  `const SIZE_GUIDE = ${JSON.stringify(sizeGuide, null, 2)};`,
  ''
].join('\n');
fs.writeFileSync(path.join(base, 'products.js'), output, 'utf8');
fs.writeFileSync(path.join(base, '.fia-generated-products.json'), JSON.stringify(products), 'utf8');
console.log(`Generated products.js: ${records.length} design(s), ${products.length} displayed colour listing(s), ${offers.length} offer(s).`);
