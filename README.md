# WooCommerce Product Exporter

Aplicacao web para exportar dados de produtos de uma loja WooCommerce.

## O que faz

1. Recebe uma URL de loja WooCommerce.
2. Permite definir a pasta de saida (fora da app) antes de iniciar.
3. Busca produtos pela API publica `wc/store/v1`.
4. Baixa imagens de cada produto.
5. Gera ficheiros prontos para migracao/import:
- `metadata.json` com metadados completos (todos os produtos num unico ficheiro).
- `woocommerce-import.csv` com colunas padrao do importador WooCommerce, incluindo produtos variaveis e respetivas variacoes (com `Parent` e precos por variacao).

## Requisitos

- Node.js 20+
- npm

## Como usar

```bash
npm install
npm start
```

Abre no browser:

- `http://localhost:3100`

## Estrutura de output

```text
<pasta-escolhida>/
  loja.com/
    20260216_140500/
      woocommerce/
        metadata.json
        woocommerce-import.csv
        products/
          product-slug-123/
            images/
              ...
```

## Plugin importador JSON (WooCommerce)

Foi incluido um plugin dedicado para importar o `metadata.json`:

- Pasta do plugin: `wp-plugin/woo-json-importer`
- ZIP pronto para instalar: `wp-plugin/woo-json-importer.zip`

No WordPress:

1. `Plugins > Adicionar novo > Enviar plugin`
2. Faz upload de `woo-json-importer.zip` e ativa
3. Vai a `WooCommerce > Import JSON Metadata`
4. Faz upload do `metadata.json` exportado por esta app

## Notas importantes

- Esta versao esta focada apenas em WooCommerce (sem crawl geral de assets do site).
- Pasta de saida default: `~/Downloads/woo-exports`.
- Se a API publica estiver bloqueada/desativada, a exportacao pode falhar.
- O CSV ja sai no formato base para import, mas pode exigir pequenos ajustes conforme plugins/campos custom da tua loja destino.
