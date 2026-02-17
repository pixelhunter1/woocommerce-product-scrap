# WooCommerce Store Migrator

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![WooCommerce](https://img.shields.io/badge/WooCommerce-Compatible-96588A?logo=woocommerce&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

**A complete toolkit to export products from any WooCommerce store and import them into another — no API keys required.**

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Usage Guide](#usage-guide)
- [Output Structure](#output-structure)
- [WooCommerce Importer Plugin](#woocommerce-importer-plugin)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Important Notes](#important-notes)
- [License](#license)

---

## Overview

WooCommerce Store Migrator is a two-part system for migrating products between WooCommerce stores:

```
┌─────────────────┐       ┌──────────────┐       ┌─────────────────┐
│  Source Store    │──────▶│  Export App   │──────▶│  JSON + CSV     │
│  (any WooStore) │       │  (Node.js)   │       │  + Images       │
└─────────────────┘       └──────────────┘       └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  WP Plugin      │
                                                 │  (Importer)     │
                                                 │  ─────────────  │
                                                 │  Target Store   │
                                                 └─────────────────┘
```

1. **Web App** — Connects to any WooCommerce store's public API, exports all products (including images and metadata) to local files.
2. **WordPress Plugin** — Imports the exported JSON data into a new WooCommerce store, recreating products with all their details.

---

## Features

- **No authentication needed** — Uses the public WooCommerce Store API (`wc/store/v1`)
- **Simple & variable products** — Full support for variable products with all variations, attributes, and per-variation pricing
- **Automatic image download** — Downloads all product images with 4x concurrent connections
- **Dual output formats** — CSV (WooCommerce-native format) + JSON (complete metadata)
- **Real-time dashboard** — Live progress metrics, logs, and job tracking
- **Hacker/cyberpunk UI** — Dark theme with terminal-style interface and live stats
- **Multilingual UI** — English, French, and Spanish support
- **Configurable output** — Choose your export directory and product limits

---

## Prerequisites

- **Node.js** 20 or higher
- **npm**
- **WordPress + WooCommerce** (only for the importer plugin)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/pixelhunter1/woocommerce-product-scrap.git
cd woocommerce-product-scrap

# Install dependencies
npm install

# Start the server
npm start
```

Open your browser at **http://localhost:3100**

---

## Usage Guide

1. **Enter the store URL** — Paste the full URL of any WooCommerce store (e.g., `https://example-store.com`)
2. **Set product limit** *(optional)* — Enter a max number of products to export, or leave at `0` for all products (up to 10,000)
3. **Choose output directory** *(optional)* — Defaults to `~/Downloads/woo-exports`
4. **Click Export** — The app fetches products via the store's public API, downloads images, and generates export files
5. **Monitor progress** — Watch real-time logs and metrics on the dashboard

| Field | Description | Default |
|-------|-------------|---------|
| Store URL | Full URL of the WooCommerce store | *(required)* |
| Max Products | Limit number of products (0 = all) | `0` |
| Output Directory | Where to save exported files | `~/Downloads/woo-exports` |

---

## Output Structure

```
<output-directory>/
  example-store.com/
    20260216_140500/
      woocommerce/
        metadata.json              # Complete product metadata (all products)
        woocommerce-import.csv     # WooCommerce-native CSV import format
        products/
          product-slug-123/
            images/
              image-1.jpg
              image-2.jpg
              ...
          product-slug-456/
            images/
              ...
```

---

## WooCommerce Importer Plugin

The **WooJSON Importer** plugin allows you to import the exported `metadata.json` directly into any WordPress + WooCommerce installation.

### Plugin Features

- Creates simple and variable products from JSON
- Imports all product attributes and variations
- Downloads and attaches product images from URLs
- Sets pricing, stock, descriptions, and categories
- Handles parent/child relationships for variable products

### Download

> **[Download woo-json-importer.zip](https://github.com/pixelhunter1/woocommerce-product-scrap/raw/master/wp-plugin/woo-json-importer.zip)**

### Installation

**Option A — Upload via WordPress Admin:**

1. Go to **Plugins > Add New > Upload Plugin**
2. Upload the `woo-json-importer.zip` file
3. Click **Install Now**, then **Activate**

**Option B — Manual Installation:**

1. Extract `woo-json-importer.zip`
2. Copy the `woo-json-importer` folder to `wp-content/plugins/`
3. Activate the plugin in **Plugins > Installed Plugins**

### Usage

1. Navigate to **WooCommerce > Import JSON Metadata**
2. Upload the `metadata.json` file generated by the export app
3. Click **Import** and wait for the process to complete

### Expected JSON Format

The plugin expects the `metadata.json` file generated by this tool. The structure follows this pattern:

```json
[
  {
    "name": "Product Name",
    "slug": "product-slug",
    "type": "simple",
    "price": "29.99",
    "regular_price": "29.99",
    "description": "Full product description...",
    "short_description": "Short summary",
    "images": [
      { "src": "https://...", "name": "image.jpg", "alt": "" }
    ],
    "categories": [
      { "name": "Category Name" }
    ],
    "attributes": [],
    "variations": []
  }
]
```

---

## API Reference

### `POST /api/scrape`

Start a new export job.

**Request body:**
```json
{
  "url": "https://example-store.com",
  "maxProducts": 0,
  "outputDir": "~/Downloads/woo-exports"
}
```

**Response** `202`:
```json
{
  "message": "Job iniciado.",
  "jobId": "uuid"
}
```

### `GET /api/jobs/:id`

Get full details for a specific job (status, progress, logs, result).

### `GET /api/jobs`

List the 25 most recent jobs (summary view with status and progress).

### `GET /api/config`

Get server configuration (default output directory).

**Response:**
```json
{
  "defaultOutputDir": "/Users/you/Downloads/woo-exports"
}
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend** | Node.js, Express 5 | HTTP server & API |
| **Scraping** | Axios, Cheerio | API requests & HTML parsing |
| **Frontend** | Vanilla JS, CSS3 | UI dashboard (no build step) |
| **Plugin** | PHP, WooCommerce API | WordPress product import |

---

## Project Structure

```
scrap/
├── public/
│   ├── index.html          # Main UI page
│   ├── app.js              # Frontend logic & API client
│   └── styles.css          # Hacker/cyberpunk theme styles
├── src/
│   ├── server.js           # Express server & API routes
│   └── scraper.js          # WooCommerce scraping engine
├── wp-plugin/
│   ├── woo-json-importer/  # Plugin source files
│   └── woo-json-importer.zip  # Ready-to-install plugin
├── package.json
└── README.md
```

---

## Important Notes

- The source store's **public WooCommerce API must be accessible** — if `wc/store/v1` is disabled or blocked, the export will fail.
- The **CSV output** follows the standard WooCommerce import format but may need minor adjustments depending on custom fields or plugins on the target store.
- This tool is **focused exclusively on WooCommerce** — it does not crawl general site assets.
- Default output directory: `~/Downloads/woo-exports`

---

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).

```
MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
