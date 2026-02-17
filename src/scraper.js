const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const mime = require('mime-types');

const USER_AGENT =
  'Mozilla/5.0 (compatible; WooExportBot/1.0; +https://localhost)';
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'woo-exports');
const CORE_SOURCE_PRIORITY = {
  html: 0,
  byIds: 1,
  inline: 2,
  endpoint: 3
};
const PRICE_IMAGE_SOURCE_PRIORITY = {
  html: 0,
  inline: 1,
  byIds: 3,
  endpoint: 3
};

function sanitizeSegment(input) {
  return String(input)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function dateStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function isHttpUrl(value) {
  return value && (value.protocol === 'http:' || value.protocol === 'https:');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function priceMinorToDecimal(value, minorUnit) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  const raw = String(value).trim().replace(',', '.');
  if (!raw) {
    return '';
  }

  if (/^-?\d+\.\d+$/.test(raw)) {
    return raw;
  }

  if (!Number.isFinite(Number(minorUnit))) {
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      return raw;
    }
    return '';
  }

  const numeric = Number(raw);
  const minor = Number(minorUnit);
  if (!Number.isFinite(numeric)) {
    return '';
  }

  const converted = numeric / Math.pow(10, minor);
  return minor > 0 ? converted.toFixed(minor) : String(converted);
}

function csvEscape(value) {
  if (value === undefined || value === null) {
    return '';
  }

  const raw = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }

  return raw;
}

function toSiteRoot(urlObj) {
  const root = new URL(urlObj.href);
  root.pathname = '/';
  root.search = '';
  root.hash = '';
  return root;
}

function toAbsoluteUrl(urlLike, baseUrl) {
  if (!urlLike) {
    return null;
  }

  try {
    return new URL(urlLike, baseUrl);
  } catch {
    return null;
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function firstNonEmptyValue(values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    if (String(value).trim() === '') {
      continue;
    }
    return value;
  }
  return '';
}

function extractImageUrls(value, out = []) {
  if (!value) {
    return out;
  }

  if (typeof value === 'string') {
    out.push(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractImageUrls(item, out);
    }
    return out;
  }

  if (typeof value === 'object') {
    const keys = ['src', 'thumbnail', 'url', 'full', 'original'];
    for (const key of keys) {
      if (value[key]) {
        out.push(String(value[key]));
      }
    }
  }

  return out;
}

function resolveVariationImageSrc(variation, siteRoot) {
  const candidates = [];
  extractImageUrls(variation?.image, candidates);
  extractImageUrls(variation?.images, candidates);
  extractImageUrls(variation?.raw?.image, candidates);
  extractImageUrls(variation?.raw?.images, candidates);

  for (const candidate of candidates) {
    const absolute = toAbsoluteUrl(candidate, siteRoot);
    if (absolute) {
      return absolute.href;
    }
  }

  return '';
}

function normalizeVariationPrices(variation) {
  const prices = variation?.prices && typeof variation.prices === 'object' ? variation.prices : {};
  const minorCandidate = firstNonEmptyValue([
    prices.currency_minor_unit,
    variation?.currency_minor_unit,
    variation?.raw?.prices?.currency_minor_unit,
    variation?.raw?.currency_minor_unit
  ]);
  const numericMinor = Number(minorCandidate);
  const finalMinor = Number.isFinite(numericMinor) ? numericMinor : undefined;

  const price = firstNonEmptyValue([
    prices.price,
    variation?.price,
    variation?.raw?.prices?.price,
    variation?.raw?.price
  ]);
  const regularPrice = firstNonEmptyValue([
    prices.regular_price,
    price,
    variation?.regular_price,
    variation?.raw?.prices?.regular_price,
    variation?.raw?.regular_price
  ]);
  const salePrice = firstNonEmptyValue([
    prices.sale_price,
    variation?.sale_price,
    variation?.raw?.prices?.sale_price,
    variation?.raw?.sale_price
  ]);

  return {
    ...prices,
    currency_minor_unit: finalMinor,
    price,
    regular_price: regularPrice,
    sale_price: salePrice
  };
}

function formatDecimalString(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  const numeric = Number(String(value).replace(',', '.').trim());
  if (!Number.isFinite(numeric)) {
    return '';
  }

  return numeric.toFixed(2);
}

function decodeHtmlJsonAttr(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeHtmlVariationAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return [];
  }

  return Object.entries(attributes)
    .map(([key, value]) => {
      if (!hasContent(value)) {
        return null;
      }

      return {
        name: String(key || '').replace(/^attribute_/, ''),
        option: String(value || '')
      };
    })
    .filter(Boolean);
}

function extractHtmlVariationImageSrc(variation) {
  const image = variation?.image;
  if (!image || typeof image !== 'object') {
    return '';
  }

  return String(image.full_src || image.src || image.url || '').trim();
}

function mapHtmlVariationToInternal(variation) {
  if (!variation || typeof variation !== 'object') {
    return null;
  }

  const displayPrice = formatDecimalString(
    firstNonEmptyValue([variation.display_price, variation.price, variation.price_raw])
  );
  const displayRegular = formatDecimalString(
    firstNonEmptyValue([
      variation.display_regular_price,
      variation.regular_price,
      variation.regular_price_raw,
      variation.display_price,
      variation.price
    ])
  );
  let salePrice = formatDecimalString(
    firstNonEmptyValue([variation.display_sale_price, variation.sale_price, variation.sale_price_raw])
  );
  if (!salePrice && displayRegular && displayPrice && Number(displayRegular) > Number(displayPrice)) {
    salePrice = displayPrice;
  }

  return {
    id: Number.isFinite(Number(variation.variation_id))
      ? Number(variation.variation_id)
      : Number.isFinite(Number(variation.id))
        ? Number(variation.id)
        : undefined,
    sku: variation.sku || '',
    name: variation.variation_description || variation.name || '',
    description: variation.variation_description || variation.description || '',
    stock_status: variation.is_in_stock === false ? 'outofstock' : undefined,
    is_in_stock:
      typeof variation.is_in_stock === 'boolean' ? variation.is_in_stock : undefined,
    attributes: normalizeHtmlVariationAttributes(variation.attributes),
    prices: {
      regular_price: displayRegular,
      price: displayPrice,
      sale_price: salePrice
    },
    image: {
      src: extractHtmlVariationImageSrc(variation)
    },
    raw: variation
  };
}

function parseVariationsJsonAttr(rawAttr) {
  if (!rawAttr) {
    return [];
  }

  const attempts = [String(rawAttr), decodeHtmlJsonAttr(rawAttr)];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try next decode strategy.
    }
  }

  return [];
}

function normalizeOutputDir(outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) {
    return DEFAULT_OUTPUT_DIR;
  }

  const trimmed = outputDir.trim();
  if (trimmed === '~') {
    return os.homedir();
  }

  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return path.resolve(trimmed);
}

async function fetchWooProducts(siteRoot, onLog, maxProducts, onCollected) {
  const collected = [];

  for (let page = 1; page <= 100; page += 1) {
    const endpoints = [
      `/wp-json/wc/store/v1/products?per_page=100&page=${page}`,
      `/?rest_route=/wc/store/v1/products&per_page=100&page=${page}`
    ];

    let payload = null;

    for (const endpoint of endpoints) {
      try {
        const endpointUrl = new URL(endpoint, siteRoot);
        const response = await axios.get(endpointUrl.href, {
          timeout: 25000,
          headers: { 'User-Agent': USER_AGENT },
          validateStatus: (status) => status >= 200 && status < 500
        });

        if (response.status === 200 && Array.isArray(response.data)) {
          payload = response.data;
          break;
        }
      } catch {
        // Try next endpoint.
      }
    }

    if (!payload) {
      if (page === 1) {
        throw new Error(
          'Não foi possível obter produtos via API pública WooCommerce (wc/store/v1).'
        );
      }
      break;
    }

    if (payload.length === 0) {
      break;
    }

    collected.push(...payload);
    onLog(`WooCommerce: página ${page} capturada (${payload.length} produtos).`);
    if (typeof onCollected === 'function') {
      onCollected(collected.length);
    }

    if (maxProducts && collected.length >= maxProducts) {
      const limited = collected.slice(0, maxProducts);
      if (typeof onCollected === 'function') {
        onCollected(limited.length);
      }
      return limited;
    }

    if (payload.length < 100) {
      break;
    }
  }

  return collected;
}

async function fetchWooVariations(siteRoot, productId, onLog) {
  const collected = [];

  for (let page = 1; page <= 100; page += 1) {
    const endpoints = [
      `/wp-json/wc/store/v1/products/${productId}/variations?per_page=100&page=${page}`,
      `/?rest_route=/wc/store/v1/products/${productId}/variations&per_page=100&page=${page}`
    ];

    let payload = null;

    for (const endpoint of endpoints) {
      try {
        const endpointUrl = new URL(endpoint, siteRoot);
        const response = await axios.get(endpointUrl.href, {
          timeout: 25000,
          headers: { 'User-Agent': USER_AGENT },
          validateStatus: (status) => status >= 200 && status < 500
        });

        if (response.status === 200 && Array.isArray(response.data)) {
          payload = response.data;
          break;
        }
      } catch {
        // Try next endpoint.
      }
    }

    if (!payload || payload.length === 0) {
      break;
    }

    collected.push(...payload);
    if (payload.length < 100) {
      break;
    }
  }

  if (collected.length > 0) {
    onLog(`Produto ${productId}: ${collected.length} variações capturadas.`);
  }

  return collected;
}

async function fetchWooProductsByIds(siteRoot, ids) {
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const collected = [];
  const chunks = chunkArray(uniqueIds, 20);

  for (const idChunk of chunks) {
    const includeValue = idChunk.join(',');
    const endpoints = [
      `/wp-json/wc/store/v1/products?include=${includeValue}&per_page=100`,
      `/?rest_route=/wc/store/v1/products&include=${includeValue}&per_page=100`
    ];

    let payload = null;

    for (const endpoint of endpoints) {
      try {
        const endpointUrl = new URL(endpoint, siteRoot);
        const response = await axios.get(endpointUrl.href, {
          timeout: 25000,
          headers: { 'User-Agent': USER_AGENT },
          validateStatus: (status) => status >= 200 && status < 500
        });

        if (response.status === 200 && Array.isArray(response.data)) {
          payload = response.data;
          break;
        }
      } catch {
        // Try next endpoint.
      }
    }

    if (payload) {
      collected.push(...payload);
    }
  }

  return collected;
}

async function fetchVariationsFromProductPage(product, siteRoot, onLog) {
  const permalink = toAbsoluteUrl(product?.permalink || product?.raw?.permalink, siteRoot);
  if (!permalink) {
    return [];
  }

  try {
    const response = await axios.get(permalink.href, {
      timeout: 25000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (status) => status >= 200 && status < 500
    });

    if (response.status !== 200 || typeof response.data !== 'string') {
      return [];
    }

    const $ = cheerio.load(response.data);
    const rawAttrs = [];

    $('form.variations_form[data-product_variations]').each((_, element) => {
      const raw = $(element).attr('data-product_variations');
      if (raw) {
        rawAttrs.push(raw);
      }
    });

    const variations = [];
    for (const rawAttr of rawAttrs) {
      const parsed = parseVariationsJsonAttr(rawAttr);
      for (const item of parsed) {
        const mapped = mapHtmlVariationToInternal(item);
        if (mapped) {
          variations.push(mapped);
        }
      }
    }

    if (variations.length > 0) {
      onLog(
        `Produto ${product.id}: variações extraídas via HTML (${variations.length}).`
      );
    }

    return variations;
  } catch (error) {
    onLog(`Produto ${product.id}: falha ao ler variações via HTML (${error.message}).`);
    return [];
  }
}

function extractInlineVariations(rawProduct) {
  if (!Array.isArray(rawProduct?.variations)) {
    return [];
  }

  return rawProduct.variations.filter((variation) => {
    if (!variation || typeof variation !== 'object' || Array.isArray(variation)) {
      return false;
    }

    return Boolean(variation.id || variation.sku || variation.attributes || variation.prices);
  });
}

function extractVariationIds(rawProduct) {
  if (!Array.isArray(rawProduct?.variations)) {
    return [];
  }

  const ids = [];
  for (const variation of rawProduct.variations) {
    if (typeof variation === 'number' || /^\d+$/.test(String(variation))) {
      ids.push(Number(variation));
      continue;
    }

    if (variation && typeof variation === 'object' && Number.isFinite(Number(variation.id))) {
      ids.push(Number(variation.id));
    }
  }

  return [...new Set(ids)];
}

function extractVariationIdsFromPool(pool) {
  if (!Array.isArray(pool)) {
    return [];
  }

  const ids = [];
  for (const variation of pool) {
    if (Number.isFinite(Number(variation?.id))) {
      ids.push(Number(variation.id));
      continue;
    }

    if (Number.isFinite(Number(variation?.raw?.id))) {
      ids.push(Number(variation.raw.id));
    }
  }

  return [...new Set(ids)];
}

function hasContent(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
}

function variationKey(variation) {
  if (Number.isFinite(Number(variation?.id))) {
    return `id:${Number(variation.id)}`;
  }

  if (variation?.sku) {
    return `sku:${String(variation.sku).trim()}`;
  }

  if (Number.isFinite(Number(variation?.raw?.id))) {
    return `id:${Number(variation.raw.id)}`;
  }

  if (variation?.raw?.sku) {
    return `sku:${String(variation.raw.sku).trim()}`;
  }

  return null;
}

function pickBestValue(candidates, valueGetter, priorityMap) {
  let best = null;
  let bestRank = -Infinity;

  for (const candidate of candidates) {
    const value = valueGetter(candidate.variation);
    if (!hasContent(value)) {
      continue;
    }

    const rank = priorityMap[candidate.source] ?? -Infinity;
    if (rank > bestRank) {
      best = {
        source: candidate.source,
        value
      };
      bestRank = rank;
    }
  }

  if (!best) {
    return { source: 'none', value: undefined };
  }

  return best;
}

function getVariationIdValue(variation) {
  if (Number.isFinite(Number(variation?.id))) {
    return Number(variation.id);
  }

  if (Number.isFinite(Number(variation?.raw?.id))) {
    return Number(variation.raw.id);
  }

  return undefined;
}

function getVariationSkuValue(variation) {
  if (hasContent(variation?.sku)) {
    return String(variation.sku).trim();
  }

  if (hasContent(variation?.raw?.sku)) {
    return String(variation.raw.sku).trim();
  }

  return undefined;
}

function resolveVariationFromCandidates(candidates, siteRoot) {
  const idChoice = pickBestValue(candidates, getVariationIdValue, CORE_SOURCE_PRIORITY);
  const skuChoice = pickBestValue(candidates, getVariationSkuValue, CORE_SOURCE_PRIORITY);
  const nameChoice = pickBestValue(candidates, (variation) => variation?.name, CORE_SOURCE_PRIORITY);
  const descriptionChoice = pickBestValue(
    candidates,
    (variation) => variation?.description,
    CORE_SOURCE_PRIORITY
  );
  const stockStatusChoice = pickBestValue(
    candidates,
    (variation) => variation?.stock_status,
    CORE_SOURCE_PRIORITY
  );
  const inStockChoice = pickBestValue(
    candidates,
    (variation) => variation?.is_in_stock,
    CORE_SOURCE_PRIORITY
  );
  const taxStatusChoice = pickBestValue(
    candidates,
    (variation) => variation?.tax_status,
    CORE_SOURCE_PRIORITY
  );
  const attributesChoice = pickBestValue(
    candidates,
    (variation) => variation?.attributes,
    CORE_SOURCE_PRIORITY
  );

  const pricesChoice = pickBestValue(
    candidates,
    (variation) => {
      const prices = normalizeVariationPrices(variation);
      if (!hasContent(prices.regular_price) && !hasContent(prices.price) && !hasContent(prices.sale_price)) {
        return undefined;
      }
      return prices;
    },
    PRICE_IMAGE_SOURCE_PRIORITY
  );

  const imageChoice = pickBestValue(
    candidates,
    (variation) => resolveVariationImageSrc(variation, siteRoot),
    PRICE_IMAGE_SOURCE_PRIORITY
  );

  const resolvedImage = imageChoice.value ? { src: imageChoice.value } : null;
  const resolvedPrices = pricesChoice.value || {
    currency_minor_unit: undefined,
    regular_price: '',
    price: '',
    sale_price: ''
  };

  const rawChoice = pickBestValue(
    candidates,
    (variation) => variation?.raw || variation,
    CORE_SOURCE_PRIORITY
  );

  return {
    id: idChoice.value,
    name: nameChoice.value || '',
    sku: skuChoice.value || '',
    description: descriptionChoice.value || '',
    stock_status: stockStatusChoice.value,
    is_in_stock: inStockChoice.value,
    tax_status: taxStatusChoice.value,
    prices: resolvedPrices,
    attributes: attributesChoice.value || [],
    image: resolvedImage,
    raw: rawChoice.value || {},
    _diagnostics: {
      missing_price: !hasContent(resolvedPrices.regular_price) && !hasContent(resolvedPrices.price),
      missing_image: !hasContent(resolvedImage?.src),
      price_source: pricesChoice.source || 'none',
      image_source: imageChoice.source || 'none'
    }
  };
}

function slugifyAttributeTerm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatAttributeLabel(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^pa_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^.+_$/, (match) => match.slice(0, -1));

  if (!cleaned) {
    return '';
  }

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveAttributeIdentity(attribute) {
  const rawName = formatAttributeLabel(attribute?.name);
  const rawLabel = formatAttributeLabel(attribute?.label);
  const taxonomy = formatAttributeLabel(attribute?.taxonomy);
  const slug = formatAttributeLabel(attribute?.slug);
  const rawAttributeKey = formatAttributeLabel(attribute?.attribute);

  const resolvedName = rawName || rawLabel || taxonomy || slug || rawAttributeKey;
  const globalCandidate = String(
    attribute?.taxonomy || attribute?.slug || attribute?.name || attribute?.attribute || ''
  ).toLowerCase();
  const isGlobal =
    globalCandidate.startsWith('pa_') ||
    (Number.isFinite(Number(attribute?.id)) && Number(attribute.id) > 0);

  return {
    name: resolvedName,
    global: isGlobal ? '1' : '0'
  };
}

function normalizeMatchValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^pa_/, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function toKeyVariants(value) {
  const normalized = normalizeMatchValue(value);
  const variants = new Set();
  if (!normalized) {
    return [];
  }

  variants.add(normalized);
  if (normalized.endsWith('es') && normalized.length > 2) {
    variants.add(normalized.slice(0, -2));
  }
  if (normalized.endsWith('s') && normalized.length > 1) {
    variants.add(normalized.slice(0, -1));
  }

  return [...variants].filter(Boolean);
}

function attributeKeyCandidates(attribute) {
  const candidates = new Set();
  const rawCandidates = [
    attribute?.attribute,
    attribute?.taxonomy,
    attribute?.slug,
    attribute?.name,
    attribute?.label,
    formatAttributeLabel(attribute?.taxonomy),
    formatAttributeLabel(attribute?.slug),
    formatAttributeLabel(attribute?.name),
    formatAttributeLabel(attribute?.label)
  ];

  for (const raw of rawCandidates) {
    for (const key of toKeyVariants(raw)) {
      candidates.add(key);
    }
  }

  return [...candidates];
}

function buildProductAttributeSchema(product) {
  const attrs = Array.isArray(product?.attributes) ? product.attributes : [];
  const schema = attrs.map((attribute) => {
    const identity = resolveAttributeIdentity(attribute);
    const values = resolveAttributeValues(attribute, identity);
    const optionMap = new Map();

    for (const value of values) {
      optionMap.set(normalizeMatchValue(value), value);
    }

    return {
      name: identity.name,
      visible: attribute.visible === false ? '0' : '1',
      global: identity.global,
      values,
      keys: attributeKeyCandidates(attribute),
      optionMap
    };
  });

  const variations = Array.isArray(product?.variationDetails) ? product.variationDetails : [];
  for (const variation of variations) {
    const selectionMap = buildVariationSelectionMap(variation);
    for (const entry of schema) {
      let selected = '';
      for (const key of entry.keys) {
        if (selectionMap.has(key)) {
          selected = selectionMap.get(key);
          break;
        }
      }

      const resolved = resolveVariationAttributeValue(entry, selected);
      const normalized = normalizeMatchValue(resolved);
      if (!resolved || !normalized || entry.optionMap.has(normalized)) {
        continue;
      }

      entry.optionMap.set(normalized, resolved);
      entry.values.push(resolved);
    }
  }

  return schema;
}

function buildVariationSelectionMap(variation) {
  const attrs = Array.isArray(variation?.attributes) ? variation.attributes : [];
  const map = new Map();

  for (const attribute of attrs) {
    const identity = resolveAttributeIdentity(attribute);
    const values = resolveAttributeValues(attribute, identity);
    const selected = values[0] || '';
    for (const key of attributeKeyCandidates(attribute)) {
      if (!map.has(key)) {
        map.set(key, selected);
      }
    }
  }

  return map;
}

function resolveVariationAttributeValue(schemaEntry, selectedValue) {
  if (!selectedValue) {
    return '';
  }

  const normalized = normalizeMatchValue(selectedValue);
  if (!normalized) {
    return '';
  }

  if (schemaEntry.optionMap.has(normalized)) {
    return schemaEntry.optionMap.get(normalized);
  }

  for (const [key, value] of schemaEntry.optionMap.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return value;
    }
  }

  return selectedValue;
}

function resolveAttributeValues(attribute, identity) {
  if (!attribute) {
    return [];
  }

  const isGlobal = identity?.global === '1';
  const values = [];
  const pushValue = (rawValue) => {
    const raw = String(rawValue || '').trim();
    if (!raw) {
      return;
    }
    values.push(isGlobal ? slugifyAttributeTerm(raw) : raw);
  };

  const pushTokenized = (rawValue) => {
    const raw = String(rawValue || '').trim();
    if (!raw) {
      return;
    }

    if (raw.includes('|')) {
      for (const token of raw.split('|')) {
        pushValue(token);
      }
      return;
    }

    if (raw.includes(',') && !raw.includes('http')) {
      for (const token of raw.split(',')) {
        pushValue(token);
      }
      return;
    }

    pushValue(raw);
  };

  if (Array.isArray(attribute.terms)) {
    for (const term of attribute.terms) {
      if (term && typeof term === 'object') {
        const value = isGlobal
          ? term?.slug || term?.name || term?.value || term?.option
          : term?.name || term?.value || term?.option || term?.slug;
        pushValue(value);
      } else {
        pushTokenized(term);
      }
    }
  }

  if (Array.isArray(attribute.options)) {
    for (const value of attribute.options) {
      pushTokenized(value);
    }
  }

  if (attribute.option) {
    pushTokenized(attribute.option);
  }

  if (Array.isArray(attribute.values)) {
    for (const value of attribute.values) {
      pushTokenized(value);
    }
  }

  if (attribute.value !== undefined && attribute.value !== null) {
    pushTokenized(attribute.value);
  }

  if (attribute.attribute_value !== undefined && attribute.attribute_value !== null) {
    pushTokenized(attribute.attribute_value);
  }

  return [...new Set(values)].filter(Boolean);
}

function extractAttributeColumns(productLike, index) {
  const attribute = Array.isArray(productLike.attributes) ? productLike.attributes[index] : null;
  if (!attribute) {
    return {
      [`Attribute ${index + 1} name`]: '',
      [`Attribute ${index + 1} value(s)`]: '',
      [`Attribute ${index + 1} visible`]: '',
      [`Attribute ${index + 1} global`]: ''
    };
  }

  const identity = resolveAttributeIdentity(attribute);
  const values = resolveAttributeValues(attribute, identity);
  const fallbackName =
    identity.name ||
    attribute.name ||
    attribute.slug ||
    attribute.taxonomy ||
    attribute.attribute ||
    `attribute-${index + 1}`;

  return {
    [`Attribute ${index + 1} name`]: String(fallbackName),
    [`Attribute ${index + 1} value(s)`]: values.join(' | '),
    [`Attribute ${index + 1} visible`]: attribute.visible === false ? '0' : '1',
    [`Attribute ${index + 1} global`]: identity.global
  };
}

function toStockFlag(stockStatus, isInStock) {
  if (stockStatus === 'instock' || isInStock === true) {
    return '1';
  }

  if (stockStatus === 'outofstock' || isInStock === false) {
    return '0';
  }

  return '';
}

function deriveType(product) {
  if (product?.type) {
    return String(product.type).toLowerCase();
  }
  return 'simple';
}

function isVariableProduct(product) {
  if (deriveType(product) === 'variable') {
    return true;
  }

  const raw = product?.raw || {};
  if (raw.has_options === true) {
    return true;
  }

  if (Array.isArray(raw.variations) && raw.variations.length > 0) {
    return true;
  }

  return false;
}

function buildParentSku(product) {
  if (product?.sku) {
    return String(product.sku);
  }

  return `parent-${product.id}`;
}

function buildVariationName(variation, parentName) {
  if (variation?.name) {
    return String(variation.name);
  }

  const attributes = Array.isArray(variation?.attributes) ? variation.attributes : [];
  const parts = attributes
    .map((attr) => resolveAttributeValues(attr, resolveAttributeIdentity(attr))[0] || '')
    .filter(Boolean);

  if (parts.length > 0) {
    return `${parentName || 'Variation'} - ${parts.join(' / ')}`;
  }

  return `${parentName || 'Variation'} - ${variation?.id || 'item'}`;
}

function buildWooImportRows(products, siteRoot) {
  const maxAttributes = products.reduce((max, product) => {
    const count = Array.isArray(product.attributes) ? product.attributes.length : 0;
    const variationMax = Array.isArray(product.variationDetails)
      ? product.variationDetails.reduce((variationCount, variation) => {
          const current = Array.isArray(variation.attributes) ? variation.attributes.length : 0;
          return Math.max(variationCount, current);
        }, 0)
      : 0;
    return Math.max(max, count, variationMax);
  }, 0);

  const headers = [
    'ID',
    'Type',
    'Parent',
    'SKU',
    'Name',
    'Published',
    'Is featured?',
    'Visibility in catalog',
    'Short description',
    'Description',
    'Tax status',
    'In stock?',
    'Regular price',
    'Sale price',
    'Categories',
    'Tags',
    'Images'
  ];

  for (let i = 0; i < maxAttributes; i += 1) {
    headers.push(`Attribute ${i + 1} name`);
    headers.push(`Attribute ${i + 1} value(s)`);
    headers.push(`Attribute ${i + 1} visible`);
    headers.push(`Attribute ${i + 1} global`);
  }

  const rows = [];

  for (const product of products) {
    const prices = product.prices || {};
    const minorUnit = prices.currency_minor_unit;
    const isVariable = isVariableProduct(product);
    const productType = isVariable ? 'variable' : deriveType(product);
    const parentSku = buildParentSku(product);
    const productAttributeSchema = buildProductAttributeSchema(product);
    const regularPrice = isVariable ? '' : priceMinorToDecimal(prices.regular_price, minorUnit);
    const salePrice = isVariable ? '' : priceMinorToDecimal(prices.sale_price, minorUnit);

    const categories = Array.isArray(product.categories)
      ? product.categories.map((item) => item?.name).filter(Boolean).join(', ')
      : '';

    const tags = Array.isArray(product.tags)
      ? product.tags.map((item) => item?.name).filter(Boolean).join(', ')
      : '';

    const images = Array.isArray(product.images)
      ? product.images
          .map((img) => toAbsoluteUrl(img?.src, siteRoot))
          .filter(Boolean)
          .map((img) => img.href)
          .join(', ')
      : '';

    const parentRow = {
      ID: '',
      Type: productType,
      Parent: '',
      SKU: isVariable ? parentSku : product.sku || '',
      Name: product.name || '',
      Published: '1',
      'Is featured?': product.is_featured ? '1' : '0',
      'Visibility in catalog': product.catalog_visibility || 'visible',
      'Short description': product.short_description || '',
      Description: product.description || '',
      'Tax status': product.tax_status || 'taxable',
      'In stock?': toStockFlag(product.stock_status, product.is_in_stock),
      'Regular price': regularPrice,
      'Sale price': salePrice,
      Categories: categories,
      Tags: tags,
      Images: images
    };

    for (let i = 0; i < maxAttributes; i += 1) {
      const schemaEntry = productAttributeSchema[i];
      if (!schemaEntry) {
        parentRow[`Attribute ${i + 1} name`] = '';
        parentRow[`Attribute ${i + 1} value(s)`] = '';
        parentRow[`Attribute ${i + 1} visible`] = '';
        parentRow[`Attribute ${i + 1} global`] = '';
        continue;
      }

      parentRow[`Attribute ${i + 1} name`] = schemaEntry.name;
      parentRow[`Attribute ${i + 1} value(s)`] = schemaEntry.values.join(' | ');
      parentRow[`Attribute ${i + 1} visible`] = schemaEntry.visible;
      parentRow[`Attribute ${i + 1} global`] = schemaEntry.global;
    }

    rows.push(parentRow);

    if (isVariable && Array.isArray(product.variationDetails)) {
      for (const variation of product.variationDetails) {
        const variationPrices = normalizeVariationPrices(variation);
        const variationMinorUnit =
          variationPrices.currency_minor_unit ?? minorUnit ?? product.prices?.currency_minor_unit;
        const variationRegular = priceMinorToDecimal(
          variationPrices.regular_price ?? variationPrices.price,
          variationMinorUnit
        );
        const variationSale = priceMinorToDecimal(variationPrices.sale_price, variationMinorUnit);
        const variationSku = variation.sku || `${parentSku}-var-${variation.id || crypto.randomUUID()}`;
        const variationImage = toAbsoluteUrl(variation.image?.src, siteRoot)?.href || '';

        const variationRow = {
          ID: '',
          Type: 'variation',
          Parent: parentSku,
          SKU: variationSku,
          Name: buildVariationName(variation, product.name),
          Published: '1',
          'Is featured?': '',
          'Visibility in catalog': 'visible',
          'Short description': '',
          Description: variation.description || '',
          'Tax status': variation.tax_status || product.tax_status || 'taxable',
          'In stock?': toStockFlag(variation.stock_status, variation.is_in_stock),
          'Regular price': variationRegular,
          'Sale price': variationSale,
          Categories: '',
          Tags: '',
          Images: variationImage
        };

        const selectionMap = buildVariationSelectionMap(variation);

        for (let i = 0; i < maxAttributes; i += 1) {
          const schemaEntry = productAttributeSchema[i];
          if (!schemaEntry) {
            variationRow[`Attribute ${i + 1} name`] = '';
            variationRow[`Attribute ${i + 1} value(s)`] = '';
            variationRow[`Attribute ${i + 1} visible`] = '';
            variationRow[`Attribute ${i + 1} global`] = '';
            continue;
          }

          let selected = '';
          for (const key of schemaEntry.keys) {
            if (selectionMap.has(key)) {
              selected = selectionMap.get(key);
              break;
            }
          }

          variationRow[`Attribute ${i + 1} name`] = schemaEntry.name;
          variationRow[`Attribute ${i + 1} value(s)`] = resolveVariationAttributeValue(
            schemaEntry,
            selected
          );
          variationRow[`Attribute ${i + 1} visible`] = schemaEntry.visible;
          variationRow[`Attribute ${i + 1} global`] = schemaEntry.global;
        }

        rows.push(variationRow);
      }
    }
  }

  return { headers, rows };
}

async function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] || '')).join(','));
  }

  await fs.writeFile(filePath, `\uFEFF${lines.join('\n')}\n`, 'utf8');
}

function normalizeTermCollection(primary, secondary) {
  const merged = [];
  if (Array.isArray(primary)) {
    merged.push(...primary);
  }
  if (Array.isArray(secondary)) {
    merged.push(...secondary);
  }

  const map = new Map();
  for (const item of merged) {
    if (!item) {
      continue;
    }

    if (typeof item === 'string') {
      const name = item.trim();
      if (!name) {
        continue;
      }
      const key = `name:${name.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, { name });
      }
      continue;
    }

    if (typeof item !== 'object') {
      continue;
    }

    const id = Number(item.id);
    const slug = String(item.slug || '').trim();
    const name = String(item.name || slug || '').trim();
    if (!name && !Number.isFinite(id) && !slug) {
      continue;
    }

    const key = Number.isFinite(id)
      ? `id:${id}`
      : slug
        ? `slug:${slug.toLowerCase()}`
        : `name:${name.toLowerCase()}`;

    if (!map.has(key)) {
      map.set(key, {
        ...(Number.isFinite(id) ? { id } : {}),
        ...(slug ? { slug } : {}),
        ...(name ? { name } : {})
      });
    }
  }

  return [...map.values()];
}

function normalizeAttributeCollection(primary, secondary) {
  const merged = [];
  if (Array.isArray(primary)) {
    merged.push(...primary);
  }
  if (Array.isArray(secondary)) {
    merged.push(...secondary);
  }

  const map = new Map();
  for (const attribute of merged) {
    if (!attribute || typeof attribute !== 'object') {
      continue;
    }

    const identity = resolveAttributeIdentity(attribute);
    const key = normalizeMatchValue(
      attribute?.attribute || attribute?.taxonomy || attribute?.slug || identity.name
    );
    if (!key) {
      continue;
    }

    if (!map.has(key)) {
      map.set(key, attribute);
      continue;
    }

    const existing = map.get(key);
    const existingValues = resolveAttributeValues(existing, resolveAttributeIdentity(existing));
    const nextValues = resolveAttributeValues(attribute, resolveAttributeIdentity(attribute));
    if (nextValues.length > existingValues.length) {
      map.set(key, { ...existing, ...attribute });
    }
  }

  return [...map.values()];
}

function simplifyProduct(product, siteRoot) {
  const images = Array.isArray(product.images)
    ? product.images
        .map((img) => ({
          ...img,
          src: toAbsoluteUrl(img?.src, siteRoot)?.href || img?.src || ''
        }))
        .filter((img) => img.src)
    : [];

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    type: product.type,
    permalink: product.permalink,
    description: product.description,
    short_description: product.short_description,
    sku: product.sku,
    stock_status: product.stock_status,
    catalog_visibility: product.catalog_visibility,
    tax_status: product.tax_status,
    is_featured: product.is_featured,
    is_in_stock: product.is_in_stock,
    prices: product.prices,
    categories: normalizeTermCollection(product.categories, product.raw?.categories),
    tags: normalizeTermCollection(product.tags, product.raw?.tags),
    attributes: normalizeAttributeCollection(product.attributes, product.raw?.attributes),
    images,
    variationDetails: [],
    raw: product
  };
}

function simplifyVariation(variation, siteRoot) {
  const imageSrc = resolveVariationImageSrc(variation, siteRoot);

  const image = imageSrc ? { src: imageSrc } : null;
  const images = extractImageUrls(
    variation?.images || variation?.raw?.images || (imageSrc ? [{ src: imageSrc }] : []),
    []
  )
    .map((src) => toAbsoluteUrl(src, siteRoot)?.href || '')
    .filter(Boolean);
  const prices = normalizeVariationPrices(variation);
  const diagnostics = variation?._diagnostics || {
    missing_price: !hasContent(prices.regular_price) && !hasContent(prices.price),
    missing_image: !hasContent(image?.src),
    price_source: 'none',
    image_source: 'none'
  };

  return {
    id: variation.id,
    name: variation.name,
    sku: variation.sku,
    description: variation.description,
    stock_status: variation.stock_status,
    is_in_stock: variation.is_in_stock,
    tax_status: variation.tax_status,
    prices,
    attributes: variation.attributes,
    image,
    images,
    raw: variation,
    _diagnostics: diagnostics
  };
}

function countMissingVariationFields(variationDetails) {
  if (!Array.isArray(variationDetails)) {
    return { missingPrices: 0, missingImages: 0, pricesFromHtml: 0, imagesFromHtml: 0 };
  }

  const missingPrices = variationDetails.filter((variation) => {
    const prices = variation?.prices || {};
    return !hasContent(prices.regular_price) && !hasContent(prices.price);
  }).length;

  const missingImages = variationDetails.filter(
    (variation) => !hasContent(variation?.image?.src)
  ).length;

  const pricesFromHtml = variationDetails.filter(
    (variation) => variation?._diagnostics?.price_source === 'html'
  ).length;

  const imagesFromHtml = variationDetails.filter(
    (variation) => variation?._diagnostics?.image_source === 'html'
  ).length;

  return { missingPrices, missingImages, pricesFromHtml, imagesFromHtml };
}

function destinationForImage(urlObj, imageDir) {
  const parsedBase = path.basename(decodeURIComponent(urlObj.pathname || ''));
  const base = sanitizeSegment(parsedBase || 'image');
  const ext = path.extname(base) || '.bin';
  const basename = base.replace(/\.[^/.]+$/, '') || 'image';
  const hash = crypto.createHash('sha1').update(urlObj.href).digest('hex').slice(0, 10);
  return path.join(imageDir, `${basename}-${hash}${ext}`);
}

async function downloadImage(urlObj, imageDir, onLog) {
  const fallbackPath = destinationForImage(urlObj, imageDir);
  await ensureDir(path.dirname(fallbackPath));

  try {
    const response = await axios.get(urlObj.href, {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (status) => status >= 200 && status < 400
    });

    let finalPath = fallbackPath;
    if (path.extname(finalPath) === '.bin') {
      const contentType = response.headers['content-type'];
      const parsedMime = contentType ? contentType.split(';')[0].trim() : '';
      const mimeExt = parsedMime ? mime.extension(parsedMime) : null;
      if (mimeExt) {
        finalPath = finalPath.replace(/\.bin$/, `.${mimeExt}`);
      }
    }

    await fs.writeFile(finalPath, response.data);
    return { skipped: false, path: finalPath };
  } catch (error) {
    onLog(`Falha ao baixar imagem: ${urlObj.href} (${error.message})`);
    return { skipped: true, path: fallbackPath, error: error.message };
  }
}

async function runScrapeJob({ url, maxProducts = 0, outputDir }, onProgress) {
  const parsedUrl = new URL(url);
  if (!isHttpUrl(parsedUrl)) {
    throw new Error('URL inválida. Use http:// ou https://');
  }

  const siteRoot = toSiteRoot(parsedUrl);
  const runId = dateStamp();
  const baseOutputDir = normalizeOutputDir(outputDir);
  const rootDir = path.join(baseOutputDir, sanitizeSegment(siteRoot.hostname), runId);
  const wooDir = path.join(rootDir, 'woocommerce');
  const productsDir = path.join(wooDir, 'products');

  await ensureDir(productsDir);

  const limit = Number.isFinite(Number(maxProducts)) ? Math.max(0, Number(maxProducts)) : 0;

  const log = (message) => {
    onProgress({ type: 'log', message });
  };

  onProgress({
    type: 'progress',
    patch: {
      stage: 'scanning_products',
      productsDiscovered: 0,
      productsProcessed: 0,
      imagesDownloaded: 0,
      imagesSkipped: 0,
      csvGenerated: 0,
      variationProductsTotal: 0,
      variationProductsProcessed: 0
    }
  });

  log(`A obter produtos WooCommerce de ${siteRoot.href}`);
  log(`Destino de saída: ${rootDir}`);

  const products = await fetchWooProducts(siteRoot, log, limit || null, (discoveredCount) => {
    onProgress({
      type: 'progress',
      patch: {
        stage: 'scanning_products',
        productsDiscovered: discoveredCount
      }
    });
  });

  if (products.length === 0) {
    throw new Error('Nenhum produto encontrado na API pública do WooCommerce.');
  }

  const simplified = products.map((product) => simplifyProduct(product, siteRoot));

  const variableProducts = simplified.filter((product) => isVariableProduct(product));
  let totalVariations = 0;
  let variationProductsProcessed = 0;

  onProgress({
    type: 'progress',
    patch: {
      stage: 'processing_variations',
      productsDiscovered: simplified.length,
      variationProductsTotal: variableProducts.length,
      variationProductsProcessed: 0
    }
  });

  await mapWithConcurrency(variableProducts, 3, async (product) => {
    const byEndpoint = await fetchWooVariations(siteRoot, product.id, log);
    const inline = extractInlineVariations(product.raw);

    if (inline.length > 0) {
      log(`Produto ${product.id}: variações embutidas detectadas (${inline.length}).`);
    }

    const idCandidates = [
      ...extractVariationIds(product.raw),
      ...extractVariationIdsFromPool(byEndpoint),
      ...extractVariationIdsFromPool(inline)
    ];

    let byIds = [];
    if (idCandidates.length > 0) {
      byIds = await fetchWooProductsByIds(siteRoot, idCandidates);
      if (byIds.length > 0) {
        log(`Produto ${product.id}: detalhes de variações por IDs (${byIds.length}).`);
      }
    }

    const resolveFromPools = (pools) => {
      const dedup = new Map();
      for (const pool of pools) {
        for (const variation of pool.items) {
          const key = variationKey(variation);
          if (!key) {
            continue;
          }

          const existing = dedup.get(key) || [];
          existing.push({
            source: pool.source,
            variation
          });
          dedup.set(key, existing);
        }
      }

      return [...dedup.values()].map((candidates) =>
        simplifyVariation(resolveVariationFromCandidates(candidates, siteRoot), siteRoot)
      );
    };

    const basePools = [
      { source: 'endpoint', items: byEndpoint },
      { source: 'inline', items: inline },
      { source: 'byIds', items: byIds }
    ];
    let resolvedVariations = resolveFromPools(basePools);
    let counts = countMissingVariationFields(resolvedVariations);

    let byHtml = [];
    if (counts.missingPrices > 0 || counts.missingImages > 0) {
      byHtml = await fetchVariationsFromProductPage(product, siteRoot, log);
      if (byHtml.length > 0) {
        resolvedVariations = resolveFromPools([...basePools, { source: 'html', items: byHtml }]);
        counts = countMissingVariationFields(resolvedVariations);
      }
    }

    product.variationDetails = resolvedVariations;

    if (product.variationDetails.length > 0) {
      log(
        `Produto ${product.id}: variações=${product.variationDetails.length}, preço via HTML=${counts.pricesFromHtml}, imagem via HTML=${counts.imagesFromHtml}, sem preço=${counts.missingPrices}, sem imagem=${counts.missingImages}.`
      );
    }

    totalVariations += product.variationDetails.length;
    variationProductsProcessed += 1;

    onProgress({
      type: 'progress',
      patch: {
        stage: 'processing_variations',
        productsDiscovered: simplified.length,
        variationProductsTotal: variableProducts.length,
        variationProductsProcessed
      }
    });
  });

  if (variableProducts.length > 0) {
    log(
      `Produtos variáveis: ${variableProducts.length}. Total de variações capturadas: ${totalVariations}.`
    );
  }

  onProgress({
    type: 'progress',
    patch: {
      stage: 'downloading_images',
      productsDiscovered: simplified.length,
      productsProcessed: 0,
      imagesDownloaded: 0,
      imagesSkipped: 0,
      csvGenerated: 0,
      variationProductsTotal: variableProducts.length,
      variationProductsProcessed
    }
  });

  const metadataJsonPath = path.join(wooDir, 'metadata.json');
  await fs.writeFile(
    metadataJsonPath,
    JSON.stringify(
      {
        source: siteRoot.href,
        captured_at: new Date().toISOString(),
        total: simplified.length,
        products: simplified
      },
      null,
      2
    )
  );

  let imagesDownloaded = 0;
  let imagesSkipped = 0;
  let productsProcessed = 0;

  for (const product of simplified) {
    const productSlug = sanitizeSegment(product.slug || `${product.id}`);
    const productDir = path.join(productsDir, `${productSlug}-${product.id}`);
    const imageDir = path.join(productDir, 'images');
    await ensureDir(imageDir);

    const imageUrlSet = new Set();

    const productImages = Array.isArray(product.images) ? product.images : [];
    for (const image of productImages) {
      if (image?.src) {
        imageUrlSet.add(image.src);
      }
    }

    const variationImages = Array.isArray(product.variationDetails) ? product.variationDetails : [];
    for (const variation of variationImages) {
      if (variation?.image?.src) {
        imageUrlSet.add(variation.image.src);
      }
    }

    const images = [...imageUrlSet].map((src) => ({ src }));

    await mapWithConcurrency(images, 4, async (image) => {
      const imageUrl = toAbsoluteUrl(image?.src, siteRoot);
      if (!imageUrl) {
        imagesSkipped += 1;
        return;
      }

      const result = await downloadImage(imageUrl, imageDir, log);
      if (result.skipped) {
        imagesSkipped += 1;
      } else {
        imagesDownloaded += 1;
      }

      onProgress({
        type: 'progress',
        patch: {
          stage: 'downloading_images',
          productsDiscovered: simplified.length,
          productsProcessed,
          imagesDownloaded,
          imagesSkipped,
          variationProductsTotal: variableProducts.length,
          variationProductsProcessed
        }
      });
    });

    productsProcessed += 1;
    onProgress({
      type: 'progress',
      patch: {
        stage: 'downloading_images',
        productsDiscovered: simplified.length,
        productsProcessed,
        imagesDownloaded,
        imagesSkipped,
        variationProductsTotal: variableProducts.length,
        variationProductsProcessed
      }
    });
  }

  const { headers, rows } = buildWooImportRows(simplified, siteRoot);
  const csvPath = path.join(wooDir, 'woocommerce-import.csv');
  await writeCsv(csvPath, headers, rows);

  onProgress({
    type: 'progress',
    patch: {
      stage: 'completed',
      productsDiscovered: simplified.length,
      productsProcessed,
      imagesDownloaded,
      imagesSkipped,
      csvGenerated: 1,
      variationProductsTotal: variableProducts.length,
      variationProductsProcessed
    }
  });

  log(
    `Exportação concluída: ${simplified.length} produtos, ${imagesDownloaded} imagens, metadata.json e CSV gerados.`
  );

  return {
    source: siteRoot.href,
    outputDir: rootDir,
    files: {
      metadataJson: metadataJsonPath,
      importCsv: csvPath
    },
    summary: {
      productsDiscovered: simplified.length,
      productsProcessed,
      variableProducts: variableProducts.length,
      variationsDiscovered: totalVariations,
      imagesDownloaded,
      imagesSkipped,
      csvGenerated: true
    }
  };
}

module.exports = {
  runScrapeJob
};
