#!/usr/bin/env python3
import csv
import hashlib
import json
import mimetypes
import os
import re
import ssl
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

USER_AGENT = "Mozilla/5.0 (compatible; WooExportPython/1.0; +https://localhost)"
REQUEST_TIMEOUT = 30
PRODUCTS_PER_PAGE = 100
ALLOW_INSECURE_TLS_FALLBACK = os.environ.get("PYTHON_SCRAPER_INSECURE_TLS", "1") != "0"
_TLS_WARNING_EMITTED = False


def emit(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_log(message: str) -> None:
    emit({"type": "log", "message": message})


def emit_progress(patch: Dict[str, Any]) -> None:
    emit({"type": "progress", "patch": patch})


def read_input_payload() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("Missing job payload on stdin.")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON payload on stdin: {exc}") from exc

    if not isinstance(payload, dict):
        raise ValueError("Payload must be a JSON object.")

    return payload


def has_content(value: Any) -> bool:
    if value is None:
        return False
    return str(value).strip() != ""


def sanitize_segment(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"[^a-zA-Z0-9._-]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "item"


def normalize_site_root(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Store URL must use http:// or https://")
    if not parsed.netloc:
        raise ValueError("Store URL must include a valid host.")
    return f"{parsed.scheme}://{parsed.netloc}/"


def to_absolute_url(url_like: Any, site_root: str) -> str:
    if not has_content(url_like):
        return ""
    try:
        return urljoin(site_root, str(url_like))
    except Exception:
        return ""


def request_bytes(url: str) -> Tuple[bytes, Dict[str, str]]:
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
        },
    )
    try:
        with open_with_tls_fallback(req) as response:
            body = response.read()
            headers = {k.lower(): v for k, v in response.headers.items()}
            return body, headers
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            detail = ""
        raise RuntimeError(f"HTTP {exc.code} for {url}. {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc}") from exc


def request_json(url: str, allow_404: bool = False) -> Any:
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    try:
        with open_with_tls_fallback(req) as response:
            body = response.read().decode("utf-8", errors="replace")
            return json.loads(body)
    except HTTPError as exc:
        if allow_404 and exc.code == 404:
            return None
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            detail = ""
        raise RuntimeError(f"HTTP {exc.code} for {url}. {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from {url}: {exc}") from exc


def is_tls_verification_error(exc: URLError) -> bool:
    reason = getattr(exc, "reason", None)
    if reason is None:
        return False
    text = str(reason).lower()
    return "certificate verify failed" in text or "ssl: cert" in text


def open_with_tls_fallback(req: Request):
    global _TLS_WARNING_EMITTED
    try:
        return urlopen(req, timeout=REQUEST_TIMEOUT)
    except URLError as exc:
        if not ALLOW_INSECURE_TLS_FALLBACK or not is_tls_verification_error(exc):
            raise

        if not _TLS_WARNING_EMITTED:
            emit_log(
                "TLS verification failed in Python runtime. Retrying with insecure TLS fallback."
            )
            _TLS_WARNING_EMITTED = True

        context = ssl._create_unverified_context()
        return urlopen(req, timeout=REQUEST_TIMEOUT, context=context)


def slugify(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"^attribute_", "", text)
    text = re.sub(r"^pa_", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def first_non_empty(values: List[Any]) -> Any:
    for value in values:
        if has_content(value):
            return value
    return ""


def extract_image_urls(value: Any, out: Optional[List[str]] = None) -> List[str]:
    out = out if out is not None else []
    if not value:
        return out

    if isinstance(value, str):
        if value.strip():
            out.append(value.strip())
        return out

    if isinstance(value, list):
        for item in value:
            extract_image_urls(item, out)
        return out

    if isinstance(value, dict):
        for key in ("src", "thumbnail", "url", "full", "original", "full_src"):
            if has_content(value.get(key)):
                out.append(str(value[key]).strip())
    return out


def normalize_term_collection(primary: Any, secondary: Any) -> List[Dict[str, Any]]:
    merged: List[Any] = []
    if isinstance(primary, list):
        merged.extend(primary)
    if isinstance(secondary, list):
        merged.extend(secondary)

    found: Dict[str, Dict[str, Any]] = {}
    for item in merged:
        if isinstance(item, dict):
            term_id = item.get("id")
            name = str(item.get("name") or item.get("slug") or "").strip()
            slug = str(item.get("slug") or slugify(name) or "").strip()
        else:
            term_id = None
            name = str(item or "").strip()
            slug = slugify(name)

        if not name and not slug:
            continue

        key = str(term_id) if term_id is not None else (slug or name.lower())
        found[key] = {
            "id": term_id,
            "name": name or slug,
            "slug": slug or slugify(name),
        }

    return list(found.values())


def extract_attribute_options(attribute: Dict[str, Any]) -> List[str]:
    options: List[str] = []

    terms = attribute.get("terms")
    if isinstance(terms, list):
        for term in terms:
            if isinstance(term, dict):
                candidate = first_non_empty([term.get("name"), term.get("slug")])
                if has_content(candidate):
                    options.append(str(candidate).strip())
            elif has_content(term):
                options.append(str(term).strip())

    attr_options = attribute.get("options")
    if isinstance(attr_options, list):
        for item in attr_options:
            if has_content(item):
                options.append(str(item).strip())

    for single_key in ("option", "value"):
        single = attribute.get(single_key)
        if has_content(single):
            options.append(str(single).strip())

    values = attribute.get("values")
    if isinstance(values, list):
        for value in values:
            if has_content(value):
                options.append(str(value).strip())

    clean = []
    seen = set()
    for option in options:
        key = option.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        clean.append(option.strip())

    return clean


def normalize_attribute(attribute: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw_name = first_non_empty(
        [
            attribute.get("name"),
            attribute.get("label"),
            attribute.get("attribute"),
            attribute.get("slug"),
            attribute.get("taxonomy"),
        ]
    )
    if not has_content(raw_name):
        return None

    text_name = str(raw_name).strip()
    text_name = re.sub(r"^attribute_", "", text_name, flags=re.IGNORECASE)
    text_name = re.sub(r"^pa_", "", text_name, flags=re.IGNORECASE)
    name = text_name.strip()
    if not name:
        return None

    slug = slugify(first_non_empty([attribute.get("slug"), attribute.get("taxonomy"), name]))
    if not slug:
        return None

    taxonomy_candidate = str(
        first_non_empty([attribute.get("taxonomy"), attribute.get("attribute"), ""])
    ).strip()
    taxonomy_candidate = re.sub(r"^attribute_", "", taxonomy_candidate, flags=re.IGNORECASE)
    if taxonomy_candidate and not taxonomy_candidate.lower().startswith("pa_"):
        taxonomy_candidate = f"pa_{slugify(taxonomy_candidate)}"

    taxonomy = taxonomy_candidate or f"pa_{slug}"
    options = extract_attribute_options(attribute)

    return {
        "id": attribute.get("id"),
        "name": name,
        "slug": slug,
        "taxonomy": taxonomy,
        "options": options,
        "visible": False if attribute.get("visible") is False else True,
        "variation": True if attribute.get("variation") is not False else False,
    }


def normalize_attribute_collection(primary: Any, secondary: Any) -> List[Dict[str, Any]]:
    merged: List[Any] = []
    if isinstance(primary, list):
        merged.extend(primary)
    if isinstance(secondary, list):
        merged.extend(secondary)

    found: Dict[str, Dict[str, Any]] = {}
    for item in merged:
        if not isinstance(item, dict):
            continue
        normalized = normalize_attribute(item)
        if not normalized:
            continue

        key = slugify(
            first_non_empty(
                [normalized.get("taxonomy"), normalized.get("slug"), normalized.get("name")]
            )
        )
        if not key:
            continue

        if key not in found:
            found[key] = normalized
            continue

        current_values = found[key].get("options") or []
        next_values = normalized.get("options") or []
        if len(next_values) > len(current_values):
            found[key] = normalized

    return list(found.values())


def minor_to_decimal(value: Any, minor_unit: Any) -> str:
    if not has_content(value):
        return ""

    raw = str(value).strip().replace(",", ".")
    if not raw:
        return ""

    if re.match(r"^-?\d+\.\d+$", raw):
        return raw

    if not re.match(r"^-?\d+$", raw):
        return ""

    try:
        numeric_minor = int(minor_unit)
    except Exception:
        return raw

    numeric = int(raw)
    divisor = 10 ** max(0, numeric_minor)
    if divisor == 1:
        return str(numeric)

    decimal = numeric / divisor
    return f"{decimal:.{max(0, numeric_minor)}f}"


def normalize_variation_prices(variation: Dict[str, Any]) -> Dict[str, Any]:
    prices = variation.get("prices") if isinstance(variation.get("prices"), dict) else {}
    minor_unit = first_non_empty(
        [
            prices.get("currency_minor_unit"),
            variation.get("currency_minor_unit"),
            (variation.get("raw") or {}).get("currency_minor_unit")
            if isinstance(variation.get("raw"), dict)
            else None,
        ]
    )

    return {
        **prices,
        "currency_minor_unit": int(minor_unit) if str(minor_unit).isdigit() else prices.get("currency_minor_unit", 2),
        "price": first_non_empty(
            [
                prices.get("price"),
                variation.get("price"),
                (variation.get("raw") or {}).get("price")
                if isinstance(variation.get("raw"), dict)
                else None,
            ]
        ),
        "regular_price": first_non_empty(
            [
                prices.get("regular_price"),
                prices.get("price"),
                variation.get("regular_price"),
                variation.get("price"),
                (variation.get("raw") or {}).get("regular_price")
                if isinstance(variation.get("raw"), dict)
                else None,
            ]
        ),
        "sale_price": first_non_empty(
            [
                prices.get("sale_price"),
                variation.get("sale_price"),
                (variation.get("raw") or {}).get("sale_price")
                if isinstance(variation.get("raw"), dict)
                else None,
            ]
        ),
    }


def resolve_variation_image_src(variation: Dict[str, Any], site_root: str) -> str:
    candidates: List[str] = []
    extract_image_urls(variation.get("image"), candidates)
    extract_image_urls(variation.get("images"), candidates)
    if isinstance(variation.get("raw"), dict):
        extract_image_urls(variation["raw"].get("image"), candidates)
        extract_image_urls(variation["raw"].get("images"), candidates)

    for candidate in candidates:
        absolute = to_absolute_url(candidate, site_root)
        if absolute:
            return absolute
    return ""


def simplify_variation(variation: Dict[str, Any], site_root: str) -> Dict[str, Any]:
    prices = normalize_variation_prices(variation)
    image_src = resolve_variation_image_src(variation, site_root)
    image = {"src": image_src} if image_src else None
    images = []
    for candidate in extract_image_urls(
        variation.get("images") if variation.get("images") else ([image] if image else [])
    ):
        absolute = to_absolute_url(candidate, site_root)
        if absolute and absolute not in images:
            images.append(absolute)

    attributes = normalize_attribute_collection(variation.get("attributes"), None)
    diagnostics = {
        "missing_price": not has_content(prices.get("regular_price"))
        and not has_content(prices.get("price")),
        "missing_image": not has_content(image_src),
        "price_source": "api",
        "image_source": "api",
    }

    return {
        "id": variation.get("id"),
        "name": variation.get("name"),
        "sku": variation.get("sku"),
        "description": variation.get("description"),
        "stock_status": variation.get("stock_status"),
        "is_in_stock": variation.get("is_in_stock"),
        "tax_status": variation.get("tax_status"),
        "prices": prices,
        "attributes": attributes,
        "image": image,
        "images": images,
        "raw": variation,
        "_diagnostics": diagnostics,
    }


def simplify_product(product: Dict[str, Any], site_root: str) -> Dict[str, Any]:
    images = []
    for image in product.get("images") if isinstance(product.get("images"), list) else []:
        if not isinstance(image, dict):
            continue
        src = to_absolute_url(image.get("src"), site_root)
        if not src:
            continue
        entry = dict(image)
        entry["src"] = src
        images.append(entry)

    raw_hint: Dict[str, Any] = {}
    if "has_options" in product:
        raw_hint["has_options"] = bool(product.get("has_options"))
    if isinstance(product.get("variations"), list):
        raw_hint["variations"] = product.get("variations")

    return {
        "id": product.get("id"),
        "name": product.get("name"),
        "slug": product.get("slug"),
        "type": str(product.get("type") or "simple").lower(),
        "permalink": product.get("permalink"),
        "description": product.get("description"),
        "short_description": product.get("short_description"),
        "sku": product.get("sku"),
        "stock_status": product.get("stock_status"),
        "catalog_visibility": product.get("catalog_visibility"),
        "tax_status": product.get("tax_status"),
        "is_featured": bool(product.get("is_featured")),
        "is_in_stock": product.get("is_in_stock"),
        "prices": product.get("prices") if isinstance(product.get("prices"), dict) else {},
        "categories": normalize_term_collection(product.get("categories"), raw_hint.get("categories")),
        "tags": normalize_term_collection(product.get("tags"), raw_hint.get("tags")),
        "attributes": normalize_attribute_collection(product.get("attributes"), raw_hint.get("attributes")),
        "images": images,
        "variationDetails": [],
        "raw": raw_hint,
    }


def fetch_products(site_root: str, max_products: int) -> List[Dict[str, Any]]:
    products: List[Dict[str, Any]] = []
    page = 1

    while True:
        endpoint = (
            f"{site_root}wp-json/wc/store/v1/products?"
            f"per_page={PRODUCTS_PER_PAGE}&page={page}"
        )
        data = request_json(endpoint)
        if not isinstance(data, list) or not data:
            break

        products.extend(data)
        if max_products > 0 and len(products) >= max_products:
            products = products[:max_products]
            emit_log(f"Reached maxProducts limit ({max_products}).")
            break

        emit_log(f"Products page {page}: +{len(data)} (total={len(products)}).")
        emit_progress(
            {
                "stage": "scanning_products",
                "productsDiscovered": len(products),
                "productsProcessed": 0,
                "imagesDownloaded": 0,
                "imagesSkipped": 0,
                "csvGenerated": 0,
                "variationProductsTotal": 0,
                "variationProductsProcessed": 0,
            }
        )

        if len(data) < PRODUCTS_PER_PAGE:
            break
        page += 1

    return products


def fetch_product_variations(site_root: str, product_id: Any) -> List[Dict[str, Any]]:
    if not has_content(product_id):
        return []

    variations: List[Dict[str, Any]] = []
    page = 1

    while True:
        endpoint = (
            f"{site_root}wp-json/wc/store/v1/products/{product_id}/variations?"
            f"per_page={PRODUCTS_PER_PAGE}&page={page}"
        )
        data = request_json(endpoint, allow_404=True)
        if data is None:
            return []
        if not isinstance(data, list) or not data:
            break

        variations.extend(data)
        if len(data) < PRODUCTS_PER_PAGE:
            break
        page += 1

    return variations


def is_variable_product(product: Dict[str, Any]) -> bool:
    if str(product.get("type") or "").lower() == "variable":
        return True
    raw = product.get("raw") if isinstance(product.get("raw"), dict) else {}
    if raw.get("has_options") is True:
        return True
    if isinstance(raw.get("variations"), list) and len(raw.get("variations")) > 0:
        return True
    return False


def destination_for_image(url: str, image_dir: Path) -> Path:
    parsed = urlparse(url)
    base = sanitize_segment(Path(parsed.path).name or "image")
    stem = Path(base).stem or "image"
    ext = Path(base).suffix or ".bin"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return image_dir / f"{stem}-{digest}{ext}"


def download_image(url: str, image_dir: Path) -> Dict[str, Any]:
    if not has_content(url):
        return {"skipped": True}

    image_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_for_image(url, image_dir)
    if destination.exists():
        return {"skipped": True, "path": str(destination)}

    body, headers = request_bytes(url)
    target = destination
    if destination.suffix == ".bin":
        content_type = str(headers.get("content-type") or "").split(";")[0].strip().lower()
        guessed_ext = mimetypes.guess_extension(content_type) if content_type else None
        if guessed_ext:
            target = destination.with_suffix(guessed_ext)

    target.write_bytes(body)
    return {"skipped": False, "path": str(target)}


def to_stock_flag(stock_status: Any, is_in_stock: Any) -> str:
    if stock_status == "instock" or is_in_stock is True:
        return "1"
    if stock_status == "outofstock" or is_in_stock is False:
        return "0"
    return ""


def attribute_identity(attribute: Dict[str, Any]) -> Tuple[str, List[str]]:
    candidates = [
        attribute.get("name"),
        attribute.get("taxonomy"),
        attribute.get("slug"),
        attribute.get("attribute"),
    ]
    name = ""
    keys: List[str] = []
    for candidate in candidates:
        text = str(candidate or "").strip()
        if not text:
            continue
        if not name:
            name = text
        key = slugify(text)
        if key and key not in keys:
            keys.append(key)
    return name or "attribute", keys


def attribute_values(attribute: Dict[str, Any]) -> List[str]:
    values = extract_attribute_options(attribute)
    if values:
        return values
    return []


def build_product_attribute_schema(product: Dict[str, Any]) -> List[Dict[str, Any]]:
    schema = []
    attributes = product.get("attributes") if isinstance(product.get("attributes"), list) else []
    for attribute in attributes:
        if not isinstance(attribute, dict):
            continue
        name, keys = attribute_identity(attribute)
        values = attribute_values(attribute)
        if not keys:
            continue
        schema.append(
            {
                "name": name,
                "keys": keys,
                "values": values,
                "visible": "0" if attribute.get("visible") is False else "1",
                "global": "1"
                if str(attribute.get("taxonomy") or "").startswith("pa_")
                else "0",
            }
        )
    return schema


def build_variation_selection_map(variation: Dict[str, Any]) -> Dict[str, str]:
    selection: Dict[str, str] = {}
    attributes = variation.get("attributes") if isinstance(variation.get("attributes"), list) else []
    for attribute in attributes:
        if not isinstance(attribute, dict):
            continue
        _, keys = attribute_identity(attribute)
        values = attribute_values(attribute)
        if not values:
            continue
        for key in keys:
            if key not in selection:
                selection[key] = values[0]
    return selection


def build_variation_name(variation: Dict[str, Any], parent_name: str) -> str:
    if has_content(variation.get("name")):
        return str(variation.get("name"))
    values: List[str] = []
    attrs = variation.get("attributes") if isinstance(variation.get("attributes"), list) else []
    for attribute in attrs:
        if not isinstance(attribute, dict):
            continue
        opts = attribute_values(attribute)
        if opts:
            values.append(opts[0])
    if values:
        return f"{parent_name or 'Variation'} - {' / '.join(values)}"
    return f"{parent_name or 'Variation'} - {variation.get('id') or 'item'}"


def build_woo_import_rows(products: List[Dict[str, Any]]) -> Tuple[List[str], List[Dict[str, Any]]]:
    max_attributes = 0
    for product in products:
        attrs_count = len(product.get("attributes") or [])
        variation_max = 0
        for variation in product.get("variationDetails") or []:
            variation_max = max(variation_max, len(variation.get("attributes") or []))
        max_attributes = max(max_attributes, attrs_count, variation_max)

    headers = [
        "ID",
        "Type",
        "Parent",
        "SKU",
        "Name",
        "Published",
        "Is featured?",
        "Visibility in catalog",
        "Short description",
        "Description",
        "Tax status",
        "In stock?",
        "Regular price",
        "Sale price",
        "Categories",
        "Tags",
        "Images",
    ]

    for index in range(max_attributes):
        position = index + 1
        headers.extend(
            [
                f"Attribute {position} name",
                f"Attribute {position} value(s)",
                f"Attribute {position} visible",
                f"Attribute {position} global",
            ]
        )

    rows: List[Dict[str, Any]] = []

    for product in products:
        prices = product.get("prices") if isinstance(product.get("prices"), dict) else {}
        minor_unit = prices.get("currency_minor_unit", 2)
        is_variable = is_variable_product(product) or len(product.get("variationDetails") or []) > 0
        product_type = "variable" if is_variable else str(product.get("type") or "simple")
        parent_sku = str(product.get("sku") or f"parent-{product.get('id')}")
        schema = build_product_attribute_schema(product)

        categories = ", ".join(
            [str(item.get("name")) for item in (product.get("categories") or []) if has_content(item.get("name"))]
        )
        tags = ", ".join(
            [str(item.get("name")) for item in (product.get("tags") or []) if has_content(item.get("name"))]
        )
        images = ", ".join(
            [
                str(item.get("src"))
                for item in (product.get("images") or [])
                if isinstance(item, dict) and has_content(item.get("src"))
            ]
        )

        parent_row: Dict[str, Any] = {
            "ID": "",
            "Type": product_type,
            "Parent": "",
            "SKU": parent_sku if is_variable else str(product.get("sku") or ""),
            "Name": str(product.get("name") or ""),
            "Published": "1",
            "Is featured?": "1" if product.get("is_featured") else "0",
            "Visibility in catalog": str(product.get("catalog_visibility") or "visible"),
            "Short description": str(product.get("short_description") or ""),
            "Description": str(product.get("description") or ""),
            "Tax status": str(product.get("tax_status") or "taxable"),
            "In stock?": to_stock_flag(product.get("stock_status"), product.get("is_in_stock")),
            "Regular price": ""
            if is_variable
            else minor_to_decimal(prices.get("regular_price"), minor_unit),
            "Sale price": ""
            if is_variable
            else minor_to_decimal(prices.get("sale_price"), minor_unit),
            "Categories": categories,
            "Tags": tags,
            "Images": images,
        }

        for index in range(max_attributes):
            if index >= len(schema):
                parent_row[f"Attribute {index + 1} name"] = ""
                parent_row[f"Attribute {index + 1} value(s)"] = ""
                parent_row[f"Attribute {index + 1} visible"] = ""
                parent_row[f"Attribute {index + 1} global"] = ""
                continue

            entry = schema[index]
            parent_row[f"Attribute {index + 1} name"] = entry["name"]
            parent_row[f"Attribute {index + 1} value(s)"] = " | ".join(entry["values"])
            parent_row[f"Attribute {index + 1} visible"] = entry["visible"]
            parent_row[f"Attribute {index + 1} global"] = entry["global"]

        rows.append(parent_row)

        if not is_variable:
            continue

        for variation in product.get("variationDetails") or []:
            if not isinstance(variation, dict):
                continue

            variation_prices = (
                variation.get("prices") if isinstance(variation.get("prices"), dict) else {}
            )
            variation_minor = variation_prices.get("currency_minor_unit", minor_unit)
            variation_regular = minor_to_decimal(
                first_non_empty(
                    [variation_prices.get("regular_price"), variation_prices.get("price")]
                ),
                variation_minor,
            )
            variation_sale = minor_to_decimal(variation_prices.get("sale_price"), variation_minor)
            variation_sku = str(
                variation.get("sku")
                or f"{parent_sku}-var-{variation.get('id') or hashlib.sha1(parent_sku.encode('utf-8')).hexdigest()[:6]}"
            )
            variation_image = ""
            image = variation.get("image")
            if isinstance(image, dict) and has_content(image.get("src")):
                variation_image = str(image.get("src"))

            variation_row: Dict[str, Any] = {
                "ID": "",
                "Type": "variation",
                "Parent": parent_sku,
                "SKU": variation_sku,
                "Name": build_variation_name(variation, str(product.get("name") or "")),
                "Published": "1",
                "Is featured?": "",
                "Visibility in catalog": "visible",
                "Short description": "",
                "Description": str(variation.get("description") or ""),
                "Tax status": str(variation.get("tax_status") or product.get("tax_status") or "taxable"),
                "In stock?": to_stock_flag(variation.get("stock_status"), variation.get("is_in_stock")),
                "Regular price": variation_regular,
                "Sale price": variation_sale,
                "Categories": "",
                "Tags": "",
                "Images": variation_image,
            }

            selection_map = build_variation_selection_map(variation)
            for index in range(max_attributes):
                if index >= len(schema):
                    variation_row[f"Attribute {index + 1} name"] = ""
                    variation_row[f"Attribute {index + 1} value(s)"] = ""
                    variation_row[f"Attribute {index + 1} visible"] = ""
                    variation_row[f"Attribute {index + 1} global"] = ""
                    continue

                entry = schema[index]
                selected = ""
                for key in entry["keys"]:
                    if key in selection_map:
                        selected = selection_map[key]
                        break

                variation_row[f"Attribute {index + 1} name"] = entry["name"]
                variation_row[f"Attribute {index + 1} value(s)"] = selected
                variation_row[f"Attribute {index + 1} visible"] = entry["visible"]
                variation_row[f"Attribute {index + 1} global"] = entry["global"]

            rows.append(variation_row)

    return headers, rows


def write_csv(file_path: Path, headers: List[str], rows: List[Dict[str, Any]]) -> None:
    with file_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({header: row.get(header, "") for header in headers})


def run_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = payload.get("url")
    if not has_content(url):
        raise ValueError("Missing store URL.")

    max_products = 0
    if has_content(payload.get("maxProducts")):
        try:
            max_products = max(0, min(10000, int(payload.get("maxProducts"))))
        except Exception:
            max_products = 0

    output_dir = str(payload.get("outputDir") or "").strip()
    if not output_dir:
        output_dir = str(Path.home() / "Downloads" / "woo-exports")

    site_root = normalize_site_root(str(url))
    hostname = sanitize_segment(urlparse(site_root).hostname or "store")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    root_dir = Path(output_dir).expanduser().resolve() / hostname / timestamp
    woo_dir = root_dir / "woocommerce"
    products_dir = woo_dir / "products"
    products_dir.mkdir(parents=True, exist_ok=True)

    emit_log(f"Python extractor started for {site_root}")
    emit_log(f"Output folder: {root_dir}")
    emit_progress(
        {
            "stage": "scanning_products",
            "productsDiscovered": 0,
            "productsProcessed": 0,
            "imagesDownloaded": 0,
            "imagesSkipped": 0,
            "csvGenerated": 0,
            "variationProductsTotal": 0,
            "variationProductsProcessed": 0,
        }
    )

    raw_products = fetch_products(site_root, max_products)
    simplified = [simplify_product(product, site_root) for product in raw_products]
    emit_log(f"Products discovered: {len(simplified)}")

    variable_products = [product for product in simplified if is_variable_product(product)]
    variation_products_total = len(variable_products)
    variation_products_processed = 0
    total_variations = 0

    if variation_products_total > 0:
        emit_log(f"Variable products detected: {variation_products_total}")

    for product in variable_products:
        product_id = product.get("id")
        variations_raw = fetch_product_variations(site_root, product_id)
        product["variationDetails"] = [
            simplify_variation(variation, site_root) for variation in variations_raw
        ]
        total_variations += len(product["variationDetails"])
        variation_products_processed += 1
        emit_log(
            f"Product {product_id}: variations={len(product['variationDetails'])}"
        )
        emit_progress(
            {
                "stage": "processing_variations",
                "productsDiscovered": len(simplified),
                "productsProcessed": 0,
                "imagesDownloaded": 0,
                "imagesSkipped": 0,
                "csvGenerated": 0,
                "variationProductsTotal": variation_products_total,
                "variationProductsProcessed": variation_products_processed,
            }
        )

    metadata_path = woo_dir / "metadata.json"
    metadata_payload = {
        "source": site_root,
        "captured_at": datetime.utcnow().isoformat() + "Z",
        "total": len(simplified),
        "products": simplified,
    }
    metadata_path.write_text(
        json.dumps(metadata_payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    emit_log("metadata.json generated.")

    emit_progress(
        {
            "stage": "downloading_images",
            "productsDiscovered": len(simplified),
            "productsProcessed": 0,
            "imagesDownloaded": 0,
            "imagesSkipped": 0,
            "csvGenerated": 0,
            "variationProductsTotal": variation_products_total,
            "variationProductsProcessed": variation_products_processed,
        }
    )

    images_downloaded = 0
    images_skipped = 0
    products_processed = 0

    for product in simplified:
        product_slug = sanitize_segment(product.get("slug") or product.get("id"))
        product_id = sanitize_segment(product.get("id") or "item")
        image_dir = products_dir / f"{product_slug}-{product_id}" / "images"
        image_dir.mkdir(parents=True, exist_ok=True)

        image_urls: List[str] = []
        seen = set()
        for image in product.get("images") or []:
            if isinstance(image, dict) and has_content(image.get("src")):
                src = str(image["src"])
                if src not in seen:
                    seen.add(src)
                    image_urls.append(src)

        for variation in product.get("variationDetails") or []:
            if not isinstance(variation, dict):
                continue
            image = variation.get("image")
            if isinstance(image, dict) and has_content(image.get("src")):
                src = str(image["src"])
                if src not in seen:
                    seen.add(src)
                    image_urls.append(src)

        for image_url in image_urls:
            try:
                result = download_image(image_url, image_dir)
                if result.get("skipped"):
                    images_skipped += 1
                else:
                    images_downloaded += 1
            except Exception as exc:
                images_skipped += 1
                emit_log(f"Image download failed ({image_url}): {exc}")

            emit_progress(
                {
                    "stage": "downloading_images",
                    "productsDiscovered": len(simplified),
                    "productsProcessed": products_processed,
                    "imagesDownloaded": images_downloaded,
                    "imagesSkipped": images_skipped,
                    "csvGenerated": 0,
                    "variationProductsTotal": variation_products_total,
                    "variationProductsProcessed": variation_products_processed,
                }
            )

        products_processed += 1
        emit_progress(
            {
                "stage": "downloading_images",
                "productsDiscovered": len(simplified),
                "productsProcessed": products_processed,
                "imagesDownloaded": images_downloaded,
                "imagesSkipped": images_skipped,
                "csvGenerated": 0,
                "variationProductsTotal": variation_products_total,
                "variationProductsProcessed": variation_products_processed,
            }
        )

    headers, rows = build_woo_import_rows(simplified)
    csv_path = woo_dir / "woocommerce-import.csv"
    write_csv(csv_path, headers, rows)
    emit_log("woocommerce-import.csv generated.")

    emit_progress(
        {
            "stage": "completed",
            "productsDiscovered": len(simplified),
            "productsProcessed": products_processed,
            "imagesDownloaded": images_downloaded,
            "imagesSkipped": images_skipped,
            "csvGenerated": 1,
            "variationProductsTotal": variation_products_total,
            "variationProductsProcessed": variation_products_processed,
        }
    )

    emit_log(
        f"Export completed: products={len(simplified)}, variations={total_variations}, images={images_downloaded}"
    )

    return {
        "source": site_root,
        "outputDir": str(root_dir),
        "files": {
            "metadataJson": str(metadata_path),
            "importCsv": str(csv_path),
        },
        "summary": {
            "productsDiscovered": len(simplified),
            "productsProcessed": products_processed,
            "variableProducts": variation_products_total,
            "variationsDiscovered": total_variations,
            "imagesDownloaded": images_downloaded,
            "imagesSkipped": images_skipped,
            "csvGenerated": True,
        },
    }


def main() -> int:
    try:
        payload = read_input_payload()
        result = run_job(payload)
        emit({"type": "result", "result": result})
        return 0
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        emit_log(traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
