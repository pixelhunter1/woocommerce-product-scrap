# Woo JSON Metadata Importer

Plugin WordPress para importar um `metadata.json` (gerado pelo scraper deste projeto) para WooCommerce.

## O que importa

- Produtos simples e variaveis
- Variacoes (por SKU)
- Categorias e tags
- Precos (`regular_price`, `sale_price`)
- Stock status
- Atributos
- Imagens (download remoto via URL)

## Instalacao

1. Copia a pasta `woo-json-importer` para `wp-content/plugins/`.
2. Ativa o plugin no painel WordPress.
3. Garante que o WooCommerce esta ativo.

## Como usar

1. Vai a `WooCommerce > Import JSON Metadata`.
2. Faz upload do ficheiro `metadata.json`.
3. Clica em `Importar JSON para WooCommerce`.

## Formato JSON esperado

Aceita:

- Objeto com chave `products` (array), ex.: `{ "products": [ ... ] }`
- Ou array direto de produtos

O formato foi desenhado para o output de:

- `/Users/miguelcarneiro/Desktop/scrap/src/scraper.js`
