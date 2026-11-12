(function () {
    "use strict";

    /* ---------- Safe access to products.js data ---------- */
    var S = (typeof SETTINGS !== "undefined" && SETTINGS) || {};
    var shop = {
      name: S.shopName || "Fia",
      tagline: S.tagline || "",
      page: S.messengerPage || "",
      whatsapp: String(S.whatsappNumber || "").replace(/\D/g, ""),
      theme: S.theme || "rose",
      currency: S.currency || "৳",
      footer: S.footerNote || "",
      logo: typeof S.logo === "string" && /^\/images\/[\w \.\-\/]+$/i.test(S.logo) ? S.logo : ""
    };
    var offersData = (typeof OFFERS !== "undefined" && Array.isArray(OFFERS)) ? OFFERS : [];
    var rawProducts = (typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS)) ? PRODUCTS : [];
    var shopInfo = (typeof SHOP_INFO !== "undefined" && SHOP_INFO) || {};
    var sizeGuide = (typeof SIZE_GUIDE !== "undefined" && Array.isArray(SIZE_GUIDE)) ? SIZE_GUIDE : [];

    // Keep only valid products, then put featured ones first (otherwise keep file order).
    var products = rawProducts
      .filter(function (p) {
        var ok = p && p.id != null && p.name;
        if (!ok) console.warn("Skipping a product in products.js without an id or name:", p);
        return ok;
      })
      .map(function (p, i) { return { p: p, i: i }; })
      .sort(function (a, b) { return (b.p.featured ? 1 : 0) - (a.p.featured ? 1 : 0) || a.i - b.i; })
      .map(function (x) { return x.p; });

    if (["rose", "peach", "mauve"].indexOf(shop.theme) === -1) shop.theme = "rose";
    document.documentElement.setAttribute("data-theme", shop.theme);
    var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) document.querySelector('meta[name="theme-color"]').setAttribute("content", bg);

    /* ---------- Helpers ---------- */
    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function slug(text) {
      return String(text).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "other";
    }
    function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
    function money(v) {
      var n = num(v);
      if (n === null) return "";
      return shop.currency + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    function hasDiscount(p) {
      var price = num(p.price), old = num(p.oldPrice);
      return price !== null && old !== null && old > price;
    }
    function percentOff(p) { return Math.round((1 - num(p.price) / num(p.oldPrice)) * 100); }
    function inStock(p) { return p.inStock !== false; }
    function unknownStock(p) { return p.inStock !== true && p.inStock !== false; }
    function firstLetter(name) { var s = String(name || "?").trim(); return (Array.from(s)[0] || "?").toUpperCase(); }
    // WhatsApp's click-to-chat link fills the MESSAGE FIELD with a ready-made message.
    // The customer only has to tap Send. We never send anything for them.
    function hasWhatsApp() { return /^[1-9]\d{7,14}$/.test(shop.whatsapp); }
    function whatsappUrl(p) {
      return "https://wa.me/" + shop.whatsapp + "?text=" + encodeURIComponent(p ? orderMessage(p) : generalMessage());
    }
    // Messenger cannot be given a ready-made message by a link. The product id is passed as a
    // referral and the message is copied to the clipboard when the button is tapped.
    function hasMessenger() { return /^[A-Za-z0-9._-]{3,}$/.test(shop.page); }
    function messengerUrl(p) {
      var base = "https://m.me/" + encodeURIComponent(shop.page);
      return p ? base + "?ref=" + encodeURIComponent("fia_" + String(p.id).replace(/[^A-Za-z0-9_-]/g, "")) : base;
    }
    function generalMessage() {
      return "Hello " + shop.name + "! I would like to know more about your plazos and skirts.";
    }
    // Share the stable public host, not an ephemeral Workers preview URL.
    // Set PUBLIC_SITE_URL in hosting build environment for a reliable domain.
    function publicSiteOrigin() {
      // Workers preview URLs can differ from the origin injected at build time.
      // Use the ACTUAL host that served this page, not a stale preview hostname.
      if (/\.workers\.dev$/i.test(location.hostname)) return location.origin;
      var fixed = typeof window.FIA_PUBLIC_SITE_ORIGIN === "string" ? window.FIA_PUBLIC_SITE_ORIGIN.trim() : "";
      try {
        var url = new URL(fixed);
        if (url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash) return url.origin;
      } catch (_) { /* use current origin if no public domain is configured */ }
      return location.origin;
    }
    // Cloudflare Workers static-asset deployments may not resolve nested HTML
    // pages. Root/hash links work even there. On Pages/Netlify, preserve proper
    // shareable product HTML pages with per-product Open Graph metadata.
    function productPathForHost(p, host) {
      var code = encodeURIComponent(String(p.id));
      var hostname;
      try { hostname = new URL(host).hostname; } catch (_) { hostname = location.hostname; }
      return /\.workers\.dev$/i.test(hostname) ? "/#/product/" + code : "/p/" + code + "/";
    }
    function shareProductUrl(p) {
      var origin = publicSiteOrigin();
      return origin + productPathForHost(p, origin);
    }
    function orderMessage(p) {
      var lines = [
        "Hello " + shop.name + "! I would like to order this item:",
        "",
        "Product: " + p.name,
        "Colour: " + (p.variantColor && p.variantColor !== "Main product" ? p.variantColor : "Please confirm"),
        "Product code: " + p.id
      ];
      if (num(p.price) !== null) lines.push("Price: " + money(p.price));
      // The /p/ link shows the product photo and name when shared on WhatsApp or Facebook.
      lines.push("Link: " + shareProductUrl(p));
      lines.push("", "My name:", "Phone number:", "Delivery address:", "", "Please confirm availability and the delivery charge. Thank you!");
      return lines.join("\n");
    }
    function imagesOf(p) { return Array.isArray(p.images) ? p.images.filter(Boolean) : []; }

    // srcset automatically selects small WebP photos on phones and sharper ones
    // on desktop. The manifest is generated for every Pages CMS upload at build time.
    var imageManifest = (window.FIA_IMAGE_MANIFEST && typeof window.FIA_IMAGE_MANIFEST === "object") ? window.FIA_IMAGE_MANIFEST : {};
    function imageKey(file) { return String(file || "").replace(/^\/?images\//, "").replace(/^\/+/, ""); }
    // ALWAYS use root-relative paths. Relative URLs like 'images/...' break on
    // /p/PRODUCT-CODE/ because the browser requests /p/PRODUCT-CODE/images/...
    function imagePath(file) { return "/images/" + imageKey(file).split("/").map(encodeURIComponent).join("/"); }
    function optimizedPath(file) { return "/" + String(file || "").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/"); }
    function imgTag(file, p, w, opts) {
      opts = opts || {};
      var versions = imageManifest[imageKey(file)] || [];
      var desired = w || 800;
      var chosen = versions.filter(function (v) { return v.w >= desired; })[0] || versions[versions.length - 1];
      var src = chosen ? optimizedPath(chosen.src) : imagePath(file);
      var srcset = versions.length ? ' srcset="' + esc(versions.map(function (v) {
        return optimizedPath(v.src) + " " + v.w + "w";
      }).join(", ")) + '" sizes="' + esc(opts.sizes || "100vw") + '"' : "";
      // The largest fingerprinted file is the reliable fallback and the best source for zoom.
      var fallback = versions.length ? optimizedPath(versions[versions.length - 1].src) : imagePath(file);
      return '<img src="' + esc(src) + '"' + srcset +
        ' data-original="' + esc(fallback) + '" data-letter="' + esc(firstLetter(p.name)) + '"' +
        ' alt="' + esc(opts.alt != null ? opts.alt : p.name) + '"' +
        (opts.eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy" fetchpriority="low"') +
        ' decoding="async" width="900" height="1600">';
    }
    function placeholder(p) { return '<div class="ph" role="img" aria-label="' + esc(p.name) + '">' + esc(firstLetter(p.name)) + "</div>"; }
    function mainImage(p, w, opts) { var imgs = imagesOf(p); return imgs.length ? imgTag(imgs[0], p, w, opts) : placeholder(p); }

    // Missing photo? First retry the original file, then show the soft pink placeholder.
    document.addEventListener("error", function (e) {
      var img = e.target;
      if (!img || img.tagName !== "IMG" || !img.dataset.letter) return;
      if (img.dataset.original && !img.dataset.retried && img.getAttribute("src") !== img.dataset.original) {
        img.dataset.retried = "1";
        img.removeAttribute("srcset");
        img.src = img.dataset.original;
        return;
      }
      var ph = document.createElement("div");
      ph.className = "ph";
      ph.setAttribute("role", "img");
      ph.setAttribute("aria-label", img.alt || "");
      ph.textContent = img.dataset.letter;
      img.replaceWith(ph);
    }, true);

    var categories = [];
    products.forEach(function (p) {
      var name = String(p.category || "Other").trim() || "Other";
      var s = slug(name);
      var found = categories.filter(function (c) { return c.slug === s; })[0];
      if (found) found.count++; else categories.push({ name: name, slug: s, count: 1 });
    });
    function catOf(p) { return slug(String(p.category || "Other").trim() || "Other"); }
    function catName(s) { var c = categories.filter(function (c) { return c.slug === s; })[0]; return c ? c.name : ""; }

    function activeOffers() {
      var now = new Date();
      return offersData.filter(function (o) {
        if (!o || !(o.title || o.text)) return false;
        var end = parseEnd(o.ends);
        return !end || now <= end;
      });
    }
    function parseEnd(v) {
      if (!v) return null;
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v).trim());
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999); // valid until the end of that day
      var d = new Date(v);
      return isNaN(d) ? null : d;
    }
    function niceDate(d) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }

    /* ---------- Icons ---------- */
    var icons = {
      whatsapp: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z"/></svg>',
      chat: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z"/></svg>',
      messenger: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78a.8.8 0 0 0 1.12.71l1.98-.87a.8.8 0 0 1 .53-.04c.91.25 1.88.38 2.91.38 5.64 0 10-4.13 10-9.7S17.64 2 12 2Zm6 7.46-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63Z"/></svg>',
      search: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      check: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
      back: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
      flourish: '<svg class="flourish" width="88" height="18" viewBox="0 0 88 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 9h28M58 9h28"/><path d="M44 2c3 3.5 3 10.5 0 14-3-3.5-3-10.5 0-14Z" fill="currentColor" fill-opacity=".25"/><path d="M36 9c2.5-2.2 5-2.2 8 0 3-2.2 5.5-2.2 8 0"/></svg>'
    };

    /* ---------- Pieces of the page ---------- */
    function badges(p) {
      var out = [];
      if (!inStock(p)) out.push('<span class="tag tag-dark">Sold out</span>');
      else if (unknownStock(p)) out.push('<span class="tag tag-gold">Confirm availability</span>');
      if (hasDiscount(p)) out.push('<span class="tag tag-accent">' + percentOff(p) + "% off</span>");
      if (p.featured) out.push('<span class="tag tag-gold">Featured</span>');
      return out.length ? '<div class="badges">' + out.join("") + "</div>" : "";
    }
    function priceRow(p) {
      return '<div class="price-row"><span class="price">' + esc(num(p.price) === null ? 'Ask for price' : money(p.price)) + "</span>" +
        (hasDiscount(p) ? '<span class="old-price"><span class="sr-only">Was </span>' + esc(money(p.oldPrice)) + "</span>" : "") + "</div>";
    }
    // Product page: two buttons, the customer chooses WhatsApp or Messenger.
    // Product cards: one "Order" button that opens a small chooser for that product.
    function orderButton(p, compact) {
      if (!inStock(p)) {
        return '<button class="btn btn-primary btn-block" type="button" disabled>Sold out</button>';
      }
      var name = esc(p.name);
      if (compact) {
        return '<button class="btn btn-primary btn-block" type="button" data-contact data-id="' + esc(p.id) + '"' +
          ' aria-label="Order ' + name + ' on WhatsApp or Messenger">' + icons.chat + "<span>Order</span></button>";
      }
      var out = '<div class="order-choices">';
      if (hasWhatsApp()) {
        out += '<a class="btn btn-wa js-order js-wa" href="' + esc(whatsappUrl(p)) + '" target="_blank" rel="noopener" data-id="' + esc(p.id) + '"' +
          ' aria-label="Order ' + name + ' on WhatsApp">' + icons.whatsapp + "<span>WhatsApp</span></a>";
      }
      if (hasMessenger()) {
        out += '<a class="btn btn-ms js-order js-ms" href="' + esc(messengerUrl(p)) + '" target="_blank" rel="noopener" data-id="' + esc(p.id) + '"' +
          ' aria-label="Order ' + name + ' on Messenger">' + icons.messenger + "<span>Messenger</span></a>";
      }
      return out + "</div>";
    }
    // A button that opens the chooser (no product = general message to the shop).
    function contactTrigger(cls, label) {
      return '<button type="button" class="' + cls + '" data-contact>' + icons.chat + "<span>" + esc(label) + "</span></button>";
    }
    function productUrl(p) { return productPathForHost(p, location.origin); }
    // All colour entries of a design stay linked, even though every colour
    // also has its own card and unique product link in the collection feed.
    function variantsOf(p) {
      if (!p.groupId || !p.variantColor) return [];
      return products.filter(function (x) { return x.groupId === p.groupId && x.variantColor; });
    }
    function colourPicker(p, compact) {
      var choices = variantsOf(p);
      if (choices.length < 2) return "";
      var visibleChoices = compact ? choices.slice(0, 4) : choices;
      var links = visibleChoices.map(function (x) {
        // Only allow safe six-digit hex codes in an inline colour style.
        var hex = /^#[0-9a-f]{6}$/i.test(x.variantHex || "") ? x.variantHex : "#E4D8DC";
        return '<a class="colour-link' + (inStock(x) ? '' : ' is-unavailable') + '" href="' + productUrl(x) + '"' +
          (x.id === p.id ? ' aria-current="true"' : '') +
          ' title="' + esc(x.variantColor + (inStock(x) ? '' : ' (sold out)')) + '"' +
          ' aria-label="View ' + esc(x.variantColor) + ' ' + esc(p.groupName || 'product') + '">' +
          '<span class="colour-dot" style="background-color:' + hex + '"></span>' +
          '<span>' + esc(x.variantColor) + (inStock(x) ? '' : ' · Sold out') + '</span></a>';
      }).join('');
      if (compact) {
        var extra = choices.length - visibleChoices.length;
        var moreLink = extra > 0 ? '<a class="colour-link colour-more" href="' + productUrl(p) + '" aria-label="See all ' + choices.length + ' linked colours">+' + extra + '</a>' : '';
        return '<div class="card-colours"><div class="colour-list" aria-label="Other colours">' + links + moreLink + '</div></div>';
      }
      return '<div class="colour-picker"><h2>Choose your colour</h2>' +
        '<p>Selected: ' + esc(p.variantColor) + ' · Each colour has its own photos</p>' +
        '<div class="colour-list" aria-label="Available colours">' + links + '</div></div>';
    }


    function card(p) {
      return '<article class="card">' +
        '<a class="card-link" href="' + productUrl(p) + '">' +
          '<div class="media' + (inStock(p) ? "" : " is-soldout") + '">' + badges(p) +
            mainImage(p, 480, { sizes: "(min-width: 1080px) 280px, (min-width: 760px) 33vw, 50vw", alt: "" }) + "</div>" +
          '<div class="card-body">' +
            '<span class="card-cat">' + esc(catName(catOf(p))) + "</span>" +
            '<h3 class="card-name">' + esc(p.name) + "</h3>" +
            priceRow(p) +
          "</div>" +
        "</a>" +
        colourPicker(p, true) +
        '<div class="card-actions">' + orderButton(p, true) + "</div>" +
      "</article>";
    }

    function offersSection() {
      var list = activeOffers();
      if (!list.length) return "";
      return '<section id="offers" aria-labelledby="offers-title"><div class="wrap">' +
        '<div class="section-head"><div><h2 id="offers-title">Offers</h2><p>Lovely little extras, for a limited time.</p></div></div>' +
        '<div class="offers">' + list.map(function (o) {
          var end = parseEnd(o.ends);
          return '<article class="offer">' +
            (o.badge ? '<span class="tag tag-gold">' + esc(o.badge) + "</span>" : "") +
            "<h3>" + esc(o.title) + "</h3>" +
            (o.text ? "<p>" + esc(o.text) + "</p>" : "") +
            (end ? '<p class="ends">Ends ' + esc(niceDate(end)) + "</p>" : "") +
          "</article>";
        }).join("") + "</div></div></section>";
    }

    function tabs(active) {
      var all = '<a href="/#/"' + (active ? "" : ' aria-current="page"') + '>All<span class="count">' + products.length + "</span></a>";
      return '<nav class="tabs" aria-label="Categories">' + all + categories.map(function (c) {
        return '<a href="/#/category/' + encodeURIComponent(c.slug) + '"' + (active === c.slug ? ' aria-current="page"' : "") + ">" +
          esc(c.name) + '<span class="count">' + c.count + "</span></a>";
      }).join("") + "</nav>";
    }

    // Flexible search: normalize product names/codes and familiar spellings
    // while keeping the entire catalogue fully client-side (no user data sent).
    var searchAliases = {
      "palazzo": "plazo", "palazzos": "plazo", "palazo": "plazo", "palazos": "plazo", "plazzo": "plazo",
      "plazzos": "plazo", "pallazo": "plazo", "plazos": "plazo", "plazoo": "plazo", "plaza": "plazo",
      "trouser": "plazo", "trousers": "plazo", "pant": "plazo", "pants": "plazo",
      "cotten": "cotton", "cottan": "cotton", "cottons": "cotton",
      "skrit": "skirt", "skirtz": "skirt", "skirts": "skirt",
      "grey": "gray", "greys": "gray", "grays": "gray",
      "maroonish": "maroon", "colours": "color", "colour": "color", "colors": "color",
      "প্লাজো": "plazo", "পালাজো": "plazo", "প্যালাজো": "plazo",
      "প্যান্ট": "plazo", "স্কার্ট": "skirt", "কটন": "cotton", "লিনেন": "linen"
    };
    function normalizeSearch(text) {
      return String(text == null ? "" : text).toLowerCase().normalize("NFKC")
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim().split(/\s+/)
        .filter(Boolean).map(function (word) { return searchAliases[word] || word; }).join(" ");
    }
    function productSearchText(p) {
      var data = [p.name, p.category, p.id, p.sku, p.description, p.variantColor,
        p.groupName, p.fabric, p.material, p.tags, p.keywords];
      if (p.details && typeof p.details === "object") {
        Object.keys(p.details).forEach(function (key) { data.push(key, p.details[key]); });
      }
      return normalizeSearch(data.filter(Boolean).join(" "));
    }
    // Build the lightweight search index once, not on every keystroke.
    var searchIndex = new Map(products.map(function (p) { return [p, productSearchText(p)]; }));
    var searchTerm = "";
    var pageSize = window.matchMedia("(min-width: 760px)").matches ? 20 : 12;
    var visibleLimit = pageSize;
    function catalogueSection(activeCat, title) {
      return '<section id="catalogue" aria-labelledby="catalogue-title"><div class="wrap">' +
        (title ? '<div class="section-head"><div><h2 id="catalogue-title">' + esc(title) + "</h2></div></div>" : '<h2 id="catalogue-title" class="sr-only">Products</h2>') +
        '<div class="toolbar">' + tabs(activeCat) +
          '<div class="search" role="search">' + icons.search +
            '<label class="sr-only" for="q">Search products</label>' +
            '<input id="q" type="search" placeholder="Search plazos, skirts, colours, codes…" autocomplete="off" enterkeyhint="search" value="' + esc(searchTerm) + '">' +
          "</div>" +
        "</div>" +
        '<p class="result-note" id="result-note" aria-live="polite"></p>' +
        '<div class="grid" id="grid"></div>' +
        '<div class="load-more-area" id="load-more-area" hidden><button class="btn btn-ghost" id="load-more" type="button">Load more products</button><p class="load-more-status" id="load-more-status" aria-live="polite"></p></div>' +
      "</div></section>";
    }

    function renderGrid(activeCat) {
      var grid = document.getElementById("grid");
      if (!grid) return;
      var q = normalizeSearch(searchTerm);
      var terms = q ? q.split(" ") : [];
      var list = products.filter(function (p) {
        if (activeCat && catOf(p) !== activeCat) return false;
        if (!terms.length) return true;
        var hay = searchIndex.get(p) || "";
        var compactHay = hay.replace(/\s/g, "");
        return terms.every(function (term) {
          return hay.includes(term) || compactHay.includes(term);
        });
      });
      // Prioritize exact codes and relevant product names in search results.
      if (terms.length) list.sort(function (a, b) {
        function rank(p) {
          var id = normalizeSearch(p.id).replace(/\s/g, "");
          var compactQ = q.replace(/\s/g, "");
          var name = normalizeSearch(p.name);
          return (id === compactQ ? 100 : id.includes(compactQ) ? 60 : 0) +
                 (name === q ? 35 : name.startsWith(q) ? 22 : name.includes(q) ? 12 : 0);
        }
        return rank(b) - rank(a);
      });
      var note = document.getElementById("result-note");
      if (note) note.textContent = q ? list.length + (list.length === 1 ? " product" : " products") + " found for “" + searchTerm.trim() + "”" : "";
      var visible = list.slice(0, visibleLimit);
      var viewKey = (activeCat || '') + '|' + q;
      var append = grid.dataset.viewKey === viewKey && Number(grid.dataset.count || 0) > 0 && Number(grid.dataset.count) < visible.length;
      if (append) {
        grid.insertAdjacentHTML('beforeend', visible.slice(Number(grid.dataset.count)).map(card).join(''));
      } else if (list.length) {
        grid.innerHTML = visible.map(card).join('');
      } else grid.innerHTML =
        '<div class="empty" style="grid-column: 1 / -1"><h3>' + (q ? "No matches yet" : "Coming soon") + "</h3><p>" +
        (q ? "Try a different word, or send us a message — we may have it in store." : "New pieces are on their way. Check back soon!") +
        '</p>' + contactTrigger("btn btn-ghost", "Message us") + "</div>";
      grid.dataset.viewKey = viewKey;
      grid.dataset.count = String(visible.length);
      var area = document.getElementById("load-more-area");
      var status = document.getElementById("load-more-status");
      if (area) area.hidden = !(list.length > visible.length);
      if (status) status.textContent = "Showing " + visible.length + " of " + list.length + " products";
    }

    function bindSearch(activeCat) {
      var input = document.getElementById("q");
      if (!input) return;
      var searchTimer;
      input.addEventListener("input", function () {
        searchTerm = input.value;
        visibleLimit = pageSize;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { renderGrid(activeCat); }, 140);
      });
      var more = document.getElementById("load-more");
      if (more) more.addEventListener("click", function () { visibleLimit += pageSize; renderGrid(activeCat); more.focus(); });
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") input.blur(); });
    }

    /* ---------- Views ---------- */
    function viewHome() {
      var name = esc(shop.name);
      return '<section class="hero"><div class="wrap"><div class="hero-card">' +
          icons.flourish +
          '<span class="eyebrow">Women\'s fashion &amp; accessories</span>' +
          "<h1>" + name + "</h1>" +
          (shop.tagline ? '<p class="tagline">' + esc(shop.tagline) + "</p>" : "") +
          '<div class="actions">' +
            '<a class="btn btn-primary" href="#catalogue" data-scroll="catalogue">Browse the collection</a>' +
            contactTrigger("btn btn-ghost", "Message us") +
          "</div>" +
        "</div></div></section>" +
        offersSection() +
        catalogueSection(null, "The collection");
    }

    function viewCategory(s) {
      var name = catName(s);
      if (!name) return viewNotFound("We couldn't find that category.");
      return '<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/#/">Home</a><span aria-hidden="true">/</span><span>' + esc(name) + "</span></nav>" +
        '<h1 class="page-title">' + esc(name) + "</h1></div>" +
        catalogueSection(s, "");
    }

    function viewProduct(id) {
      var p = products.filter(function (x) { return String(x.id) === id; })[0];
      if (!p) return viewNotFound("This product may have sold out or moved.");
      var imgs = imagesOf(p);
      var c = catOf(p);
      var details = p.details && typeof p.details === "object" ? Object.keys(p.details) : [];
      var more = products.filter(function (x) { return x !== p && catOf(x) === c; }).slice(0, 8);

      var gallery = '<div class="gallery">' +
        '<div class="gallery-main" id="gallery-main">' + badges(p) +
          (imgs.length ? imgTag(imgs[0], p, 1000, { eager: true, sizes: "(min-width: 880px) 560px, 100vw" }) + '<button type="button" class="zoom-trigger" id="zoom-trigger" aria-label="Enlarge product photograph">⊕ Zoom</button>' : placeholder(p)) + "</div>" +
        (imgs.length > 1 ? '<div class="thumbs" role="group" aria-label="Choose a photo">' + imgs.map(function (f, i) {
          return '<button type="button" class="thumb" data-index="' + i + '"' + (i === 0 ? ' aria-current="true"' : "") +
            ' aria-label="Show photo ' + (i + 1) + " of " + imgs.length + '">' + imgTag(f, p, 200, { alt: "", sizes: "76px" }) + "</button>";
        }).join("") + "</div>" : "") +
      "</div>";

      var info = '<div class="info">' +
        '<span class="card-cat"><a href="/#/category/' + encodeURIComponent(c) + '">' + esc(catName(c)) + "</a></span>" +
        "<h1>" + esc(p.name) + "</h1>" +
        '<span class="code">Product code: <b>' + esc(p.id) + "</b></span>" +
        priceRow(p) +
        (hasDiscount(p) ? '<span class="tag tag-accent">' + percentOff(p) + "% off · You save " + esc(money(num(p.oldPrice) - num(p.price))) + "</span>" : "") +
        '<div><span class="stock' + (inStock(p) ? "" : " out") + '">' + (unknownStock(p) ? "Availability: please confirm" : inStock(p) ? "In stock" : "Sold out") + "</span></div>" +
        colourPicker(p, false) +
        '<button class="share-link" type="button" data-copy-product="' + esc(p.id) + '">Copy working link to this colour</button>' +
        (p.description ? '<p class="desc">' + esc(p.description) + "</p>" : '<div class="desc"></div>') +
        '<div class="order-box">' + (inStock(p) ? '<p class="order-title">Order this colour on:</p>' : '') + orderButton(p, false) +
          (inStock(p) ? '<p class="enquiry-help">WhatsApp opens with your order message already typed. Fill in your name and address, then tap Send. On Messenger, the message is copied for you: paste it into the chat and send.</p>' +
            (navigator.share ? '<button type="button" class="btn btn-ghost btn-block js-share-product" data-id="' + esc(p.id) + '">Share this product</button>' : '') +
            '<details class="enquiry-preview"><summary>See your ready-made message</summary><p>' + esc(orderMessage(p)).replace(/\n/g, '<br>') + '</p></details>' :
            '<p>This piece is sold out. Use Message us to ask about restocks.</p>') +
        (Array.isArray(shopInfo.highlights) && shopInfo.highlights.length ? '<ul class="highlights" aria-label="Our promises">' + shopInfo.highlights.map(function (h) { return "<li>" + esc(h) + "</li>"; }).join("") + "</ul>" : "") +
        "</div>" +
        (details.length ? '<div class="details"><h2>Details</h2><dl>' + details.map(function (k) {
          return '<div class="row"><dt>' + esc(k) + "</dt><dd>" + esc(p.details[k]) + "</dd></div>";
        }).join("") + "</dl></div>" : "") +
      "</div>";

      return '<div class="wrap">' +
          '<nav class="crumbs" aria-label="Breadcrumb"><a href="/#/">Home</a><span aria-hidden="true">/</span>' +
          '<a href="/#/category/' + encodeURIComponent(c) + '">' + esc(catName(c)) + '</a><span aria-hidden="true">/</span><span>' + esc(p.name) + "</span></nav>" +
          '<article class="product">' + gallery + info + "</article>" +
        "</div>" +
        (more.length ? '<section aria-labelledby="more-title"><div class="wrap">' +
          '<div class="section-head"><h2 id="more-title">More in ' + esc(catName(c)) + '</h2><a class="back-link" href="/#/category/' + encodeURIComponent(c) + '">See all</a></div>' +
          '<div class="more-row">' + more.map(card).join("") + "</div></div></section>" : "");
    }

    function viewNotFound(msg) {
      return '<div class="wrap" style="padding-top:2rem"><div class="empty"><h3>Oops, nothing here</h3><p>' + esc(msg) +
        '</p><a class="btn btn-primary" href="/#/">Back to the shop</a></div></div>';
    }

    /* ---------- Store information pages ---------- */
    function infoView(key) {
      var pages = {
        about: ["About FIA", "about"], delivery: ["Delivery & Cash on Delivery", "delivery"],
        returns: ["Returns & Replacements", "returns"], privacy: ["Privacy", "privacy"]
      };
      var title = pages[key] && pages[key][0];
      if (key === 'size-guide') {
        var tableRows = sizeGuide.map(function (x) {
          function measure(n) { var value = num(n); return value === null ? 'Ask FIA' : String(value) + ' in'; }
          var waist = num(x.waistMin) !== null && num(x.waistMax) !== null ? measure(x.waistMin) + '–' + measure(x.waistMax) : 'Ask FIA';
          return '<tr><th scope="row">' + esc(x.collection) + '</th><td>' + esc(waist) + '</td><td>' + esc(measure(x.length)) + '</td><td>' + esc(measure(x.hemFlat)) + '</td></tr>' +
            (x.notes ? '<tr class="size-notes"><td colspan="4">' + esc(x.notes) + '</td></tr>' : '');
        }).join('');
        return '<div class="wrap info-page"><nav class="crumbs"><a href="/#/">Home</a> / Size Guide</nav><h1>Size Guide</h1>' +
          '<p>' + esc(shopInfo.sizeIntro || 'Please ask FIA for verified measurements before ordering.') + '</p>' +
          '<div class="table-scroll"><table class="size-table"><thead><tr><th>Collection</th><th>Waist range</th><th>Length</th><th>Hem flat</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
          '<p>Values marked “Ask FIA” have not yet been measured and should not be guessed.</p>' + careButton() + '</div>';
      }
      if (!title) return viewNotFound('This page does not exist.');
      var message = String(shopInfo[pages[key][1]] || 'Details are being prepared. Please contact FIA to confirm.');
      return '<div class="wrap info-page"><nav class="crumbs"><a href="/#/">Home</a> / ' + esc(title) + '</nav><h1>' + esc(title) + '</h1>' +
        '<div class="information-copy">' + esc(message).replace(/\n/g,'<br>') + '</div>' + careButton() + '</div>';
    }
    function careButton() { return '<p class="info-contact">' + contactTrigger("btn btn-primary", "Message FIA") + '</p>'; }
    function activeProductId() {
      var hashMatch = /^#\/product\/([^/]+)/.exec(location.hash);
      var pathMatch = /^\/p\/([^/]+)\/?$/.exec(location.pathname);
      var raw = hashMatch ? hashMatch[1] : pathMatch ? pathMatch[1] : '';
      try { return decodeURIComponent(raw); } catch (_) { return raw; }
    }

    /* ---------- Router ---------- */
    var app = document.getElementById("app");
    var lastRoute = null;

    function route() {
      var hash = location.hash.replace(/^#\/?/, "");
      if (!hash) {
        var pagePath = /^\/(about|delivery|returns|size-guide|privacy)\/?$/.exec(location.pathname);
        if (pagePath) hash = "info/" + pagePath[1];
        var pathProductId = activeProductId();
        if (pathProductId) hash = "product/" + encodeURIComponent(pathProductId);
        else if (!pagePath && location.pathname !== "/" && location.pathname !== "/index.html") hash = "notfound"; // unknown address (404 page)
      }
      var parts = hash.split("/").map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
      var html, title = shop.name + " — Women's Fashion & Accessories", activeCat = null, scrollTo = null;

      if (parts[0] === "product" && parts[1]) {
        html = viewProduct(parts[1]);
        var p = products.filter(function (x) { return String(x.id) === parts[1]; })[0];
        if (p) title = p.name + " — " + shop.name;
      } else if (parts[0] === "info" && parts[1]) {
        html = infoView(parts[1]);
        title = parts[1].replace(/-/g, ' ') + " — " + shop.name;
      } else if (parts[0] === "category" && parts[1]) {
        activeCat = parts[1];
        html = viewCategory(activeCat);
        if (catName(activeCat)) title = catName(activeCat) + " — " + shop.name;
      } else if (parts[0] === "" || parts[0] === "offers" || parts[0] === "catalogue") {
        html = viewHome();
        if (parts[0]) scrollTo = parts[0];
      } else {
        html = viewNotFound("That page doesn't exist.");
      }

      var key = parts[0] === "offers" || parts[0] === "catalogue" ? "" : hash;
      var sameView = lastRoute === key && document.getElementById("grid");
      lastRoute = key;
      document.title = title;

      if (!sameView) {
        visibleLimit = pageSize;
        app.innerHTML = html;
        renderGrid(activeCat);
        bindSearch(activeCat);
        bindGallery();
      }

      if (scrollTo && document.getElementById(scrollTo)) {
        document.getElementById(scrollTo).scrollIntoView();
      } else {
        window.scrollTo(0, 0);
        if (!sameView && routedOnce) app.focus({ preventScroll: true }); // help screen-reader & keyboard users after navigation
      }
      routedOnce = true;
    }
    var routedOnce = false;

    function bindGallery() {
      var main = document.getElementById("gallery-main");
      var thumbs = document.querySelectorAll(".thumb");
      if (!main || !thumbs.length) return;
      var id = activeProductId();
      var p = products.filter(function (x) { return String(x.id) === id; })[0];
      if (!p) return;
      var imgs = imagesOf(p);
      thumbs.forEach(function (t) {
        t.addEventListener("click", function () {
          var i = +t.dataset.index;
          var old = main.querySelector("img, .ph");
          var wrap = document.createElement("div");
          wrap.innerHTML = imgTag(imgs[i], p, 1000, { eager: true, sizes: "(min-width: 880px) 560px, 100vw", alt: p.name + " — photo " + (i + 1) });
          if (old) old.replaceWith(wrap.firstChild); else main.appendChild(wrap.firstChild);
          thumbs.forEach(function (x) { x.removeAttribute("aria-current"); });
          t.setAttribute("aria-current", "true");
        });
      });
    }

    // Click to zoom product photographs. Dialog closes with Escape or its button.
    var zoomDialog = document.getElementById('photo-zoom');
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#zoom-close')) { zoomDialog.close(); return; }
      if (e.target === zoomDialog) { zoomDialog.close(); return; }
      if (!(e.target.closest && e.target.closest('#zoom-trigger'))) return;
      var product = products.find(function (x) { return x.id === activeProductId(); });
      var photo = document.querySelector('#gallery-main img');
      if (!product || !photo || !zoomDialog || !zoomDialog.showModal) return;
      // Open the genuine full-size original, not a small srcset thumbnail.
      var source = photo.dataset.original || photo.currentSrc || photo.src;
      var zoomImg = document.getElementById('zoom-image');
      zoomImg.src = source;
      zoomImg.alt = photo.alt || product.name;
      zoomDialog.showModal();
    });
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-copy-product]');
      if (!btn) return;
      var product = products.find(function (x) { return String(x.id) === btn.dataset.copyProduct; });
      if (!product) return;
      var link = shareProductUrl(product);
      copyNow(link).then(function () { showToast('<span>Product link copied.</span>'); }, function () { showToast('<span>Copy this link: <code>' + esc(link) + '</code></span>', 9000); });
    });

    /* ---------- Order enquiries: WhatsApp prefilled, Messenger clipboard fallback ---------- */
    var toast = document.getElementById("toast");
    var toastTimer;
    function showToast(html, ms) {
      clearTimeout(toastTimer);
      toast.innerHTML = html;
      toast.hidden = false;
      requestAnimationFrame(function () { requestAnimationFrame(function () { toast.classList.add("show"); }); });
      toastTimer = setTimeout(function () {
        toast.classList.remove("show");
        setTimeout(function () { toast.hidden = true; }, 400);
      }, ms || 4500);
    }
    function copyNow(text) {
      // Synchronous copy first: works best while the tap is still "fresh".
      var ok = false;
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
      if (ok) return Promise.resolve();
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
      return Promise.reject(new Error("Clipboard unavailable"));
    }

    // Messenger: links cannot carry a ready-made message, so copy it as the chat opens.
    document.addEventListener("click", function (e) {
      var link = e.target.closest && e.target.closest(".js-ms");
      if (!link) return;
      var p = products.filter(function (x) { return String(x.id) === link.dataset.id; })[0];
      var msg = p ? orderMessage(p) : generalMessage();
      copyNow(msg).then(function () {
        showToast('<span class="tick">' + icons.check + '</span><span>Message copied. Paste it in Messenger and tap Send.</span>', 8000);
      }, function () {
        showToast('<span>Copy this message, then paste it into Messenger:<code>' + esc(msg) + '</code></span>', 15000);
      });
    });

    // WhatsApp on Android: open the app directly (skips WhatsApp's "Continue to chat" web page).
    // If the app does not open within about 1.5 seconds, fall back to the normal wa.me link.
    // iPhone and desktop always use the normal link: Apple/WhatsApp require their own prompt there.
    var isAndroid = /Android/i.test(navigator.userAgent);
    document.addEventListener("click", function (e) {
      var link = e.target.closest && e.target.closest(".js-wa");
      if (!link || !isAndroid) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var m = /^https:\/\/wa\.me\/(\d+)\?text=(.*)$/.exec(link.href);
      if (!m) return;
      e.preventDefault();
      var left = false;
      function onChange() { if (document.hidden) left = true; }
      document.addEventListener("visibilitychange", onChange);
      window.location.href = "whatsapp://send?phone=" + m[1] + "&text=" + m[2];
      setTimeout(function () {
        document.removeEventListener("visibilitychange", onChange);
        if (!left && !document.hidden) window.location.href = link.href;
      }, 1500);
    });

    /* ---------- Contact / order chooser (WhatsApp or Messenger) ---------- */
    var contactDialog = document.getElementById("contact-dialog");
    function openContact(p) {
      var title = document.getElementById("contact-title");
      var sub = document.getElementById("contact-sub");
      var opts = document.getElementById("contact-options");
      var hint = document.getElementById("contact-hint");
      var id = p ? ' data-id="' + esc(p.id) + '"' : "";
      title.textContent = p ? "Order " + p.name : "Message " + shop.name;
      sub.textContent = p ? "Choose where you would like to send your order." : "Choose where you would like to chat.";
      var html = "";
      if (hasWhatsApp()) html += '<a class="btn btn-wa js-wa" href="' + esc(whatsappUrl(p)) + '" target="_blank" rel="noopener"' + id + '>' + icons.whatsapp + "<span>WhatsApp</span></a>";
      if (hasMessenger()) html += '<a class="btn btn-ms js-ms" href="' + esc(messengerUrl(p)) + '" target="_blank" rel="noopener"' + id + '>' + icons.messenger + "<span>Messenger</span></a>";
      opts.innerHTML = html;
      hint.textContent = hasWhatsApp() ? "WhatsApp opens with your message already typed. Just tap Send." : "";
      if (contactDialog && contactDialog.showModal) { if (!contactDialog.open) contactDialog.showModal(); }
      else if (hasWhatsApp()) window.open(whatsappUrl(p), "_blank", "noopener");
      else if (hasMessenger()) window.open(messengerUrl(p), "_blank", "noopener");
    }
    document.addEventListener("click", function (e) {
      var trigger = e.target.closest && e.target.closest("[data-contact]");
      if (trigger) {
        e.preventDefault();
        var p = trigger.dataset.id ? products.filter(function (x) { return String(x.id) === trigger.dataset.id; })[0] : null;
        openContact(p);
        return;
      }
      if (!contactDialog || !contactDialog.open) return;
      if (e.target === contactDialog || (e.target.closest && e.target.closest("#contact-close"))) { contactDialog.close(); return; }
      if (e.target.closest && e.target.closest("#contact-options a")) setTimeout(function () { contactDialog.close(); }, 250);
    });

    // When supported, the mobile operating system's native share sheet can
    // send the prepared product text/link to a conversation the user chooses.
    // Do not claim this automatically selects FIA or sends the message.
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest('.js-share-product');
      if (!btn || !navigator.share) return;
      var p = products.filter(function (x) { return String(x.id) === btn.dataset.id; })[0];
      if (!p) return;
      navigator.share({
        title: p.name + ' — ' + shop.name,
        text: orderMessage(p),
        url: shareProductUrl(p)
      }).catch(function (error) {
        if (error && error.name !== 'AbortError')
          showToast('<span>Sharing is unavailable. Use the order button instead.</span>');
      });
    });

    // Smooth in-page scroll for the hero button without changing the route.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-scroll]");
      if (!a) return;
      var target = document.getElementById(a.dataset.scroll);
      if (target) { e.preventDefault(); target.scrollIntoView(); var q = document.getElementById("q"); if (q) q.focus({ preventScroll: true }); }
    });

    // Skip link: jump to the content without changing the page address.
    document.getElementById("skip").addEventListener("click", function (e) { e.preventDefault(); app.focus(); });

    /* ---------- Static header & footer ---------- */
    var logo = document.getElementById("logo");
    logo.innerHTML = shop.logo ? '<img class="brand-logo" src="' + esc(shop.logo) + '" alt="' + esc(shop.name) + '">' : esc(shop.name) + '<span class="dot">.</span>';
    logo.setAttribute("aria-label", shop.name + " — home");
    if (shop.logo) {
      var favicon = document.querySelector('link[rel="icon"]');
      if (favicon) favicon.href = shop.logo;
    }
    document.getElementById("footer").innerHTML =
      '<a class="logo" href="/#/">' + esc(shop.name) + '<span class="dot">.</span></a>' +
      (shop.footer ? "<p>" + esc(shop.footer) + "</p>" : "") +
      '<nav class="footer-links" aria-label="Shop information">' +
      '<a href="/about/">About FIA</a><a href="/delivery/">Delivery</a><a href="/returns/">Returns & Replacements</a>' +
      '<a href="/size-guide/">Size Guide</a><a href="/privacy/">Privacy</a></nav>' +
      contactTrigger("btn btn-ghost", "Chat with us on WhatsApp or Messenger") +
      "<small>© " + new Date().getFullYear() + " " + esc(shop.name) + ". All prices in Bangladeshi Taka (" + esc(shop.currency) + ").</small>";

    if (!activeOffers().length) {
      var offersLink = document.querySelector('.header-nav a[href="/#/offers"]');
      if (offersLink) offersLink.remove();
    }

    // Same-origin SPA navigation: switching products/colours avoids a full page reload.
    document.addEventListener('click', function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          link.target || link.hasAttribute('download') || link.hasAttribute('data-scroll')) return;
      var u;
      try { u = new URL(link.href, location.href); } catch (_) { return; }
      if (u.origin !== location.origin) return;
      if (!(u.pathname === '/' || /^\/p\/[^/]+\/?$/.test(u.pathname) ||
            /^\/(about|delivery|returns|size-guide|privacy)\/?$/.test(u.pathname))) return;
      event.preventDefault();
      if (u.href !== location.href) history.pushState({}, '', u.href);
      route();
    });
    window.addEventListener('popstate', route);
    window.addEventListener("hashchange", route);
    route();

    /* ---------- Non-disruptive catalogue version check ---------- */
    // A customer can leave FIA open for hours. Check lightly when their tab
    // becomes visible, and periodically while shopping. Never refresh a page
    // without asking: an automatic reload could interrupt a WhatsApp enquiry.
    (function watchForNewCatalogue() {
      var tag = document.querySelector('meta[name="fia-build-version"]');
      var runningVersion = tag && tag.getAttribute('content');
      if (!runningVersion || !window.fetch) return;
      var lastChecked = 0, pending = false, offered = false;
      function showUpdateNotice() {
        if (offered) return;
        offered = true;
        var banner = document.createElement('aside');
        banner.className = 'fia-update-notice';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-label', 'Website update available');
        var message = document.createElement('span');
        message.textContent = 'New FIA products, prices or website updates are available.';
        var refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.textContent = 'Show updates';
        refresh.addEventListener('click', function () {
          // Force a distinct document URL for any visitor with a stale legacy
          // HTML cache. The URL fragment retains the selected product/colour.
          var url = new URL(location.href);
          url.searchParams.set('fia_update', String(Date.now()));
          location.replace(url.href);
        });
        var dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'fia-update-dismiss';
        dismiss.textContent = 'Later';
        dismiss.setAttribute('aria-label', 'Dismiss update notice');
        dismiss.addEventListener('click', function () { banner.remove(); });
        banner.appendChild(message);
        banner.appendChild(refresh);
        banner.appendChild(dismiss);
        document.body.appendChild(banner);
      }
      function checkVersion(force) {
        if (pending || offered || document.hidden) return;
        var now = Date.now();
        if (!force && now - lastChecked < 120000) return;
        lastChecked = now;
        pending = true;
        fetch('/site-version.json', {cache:'no-store', credentials:'same-origin'})
          .then(function (response) { if (!response.ok) throw new Error('Status unavailable'); return response.json(); })
          .then(function (status) {
            if (status && typeof status.version === 'string' && status.version !== runningVersion)
              showUpdateNotice();
          })
          .catch(function () { /* offline visitors can keep browsing */ })
          .finally(function () { pending = false; });
      }
      // Avoid a startup request for each shopper: new navigations already
      // fetch current HTML and fingerprinted assets. A check runs after 5 min.
      window.setInterval(function () { checkVersion(false); }, 300000);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkVersion(false);
      });
      window.addEventListener('pageshow', function (e) {
        if (e.persisted) checkVersion(true); // browser back-forward cache
      });
    })();
  })();
