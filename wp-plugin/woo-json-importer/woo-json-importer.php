<?php
/**
 * Plugin Name: Woo JSON Metadata Importer
 * Plugin URI: https://example.com
 * Description: Importa um ficheiro metadata.json (gerado pelo scraper) para WooCommerce.
 * Version: 1.0.0
 * Author: Local
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
	exit;
}

if (!class_exists('WJMI_Plugin')) {
	class WJMI_Plugin {
		const MENU_SLUG = 'wjmi-import-json';
		const NONCE_ACTION = 'wjmi_import_json';

		public function __construct() {
			add_action('admin_menu', array($this, 'register_admin_page'));
			add_action('admin_post_wjmi_import_json', array($this, 'handle_import'));
		}

		public function register_admin_page() {
			add_submenu_page(
				'woocommerce',
				'Import JSON Metadata',
				'Import JSON Metadata',
				$this->required_capability(),
				self::MENU_SLUG,
				array($this, 'render_admin_page')
			);
		}

		private function required_capability() {
			if (current_user_can('manage_woocommerce')) {
				return 'manage_woocommerce';
			}

			return 'manage_options';
		}

		public function render_admin_page() {
			if (!current_user_can($this->required_capability())) {
				wp_die(esc_html__('You do not have permission to access this page.', 'woo-json-metadata-importer'));
			}

			$status = isset($_GET['wjmi_status']) ? sanitize_key(wp_unslash($_GET['wjmi_status'])) : '';
			$message = isset($_GET['wjmi_message']) ? sanitize_text_field(wp_unslash($_GET['wjmi_message'])) : '';
			$details = isset($_GET['wjmi_details']) ? sanitize_text_field(wp_unslash($_GET['wjmi_details'])) : '';
			?>
			<div class="wrap">
				<h1>Import JSON Metadata</h1>
				<p>Faça upload de <code>metadata.json</code> gerado pelo scraper para criar/atualizar produtos WooCommerce.</p>
				<?php if (!class_exists('WooCommerce')) : ?>
					<div class="notice notice-error"><p>WooCommerce nao esta ativo.</p></div>
				<?php endif; ?>
				<?php if (!empty($message)) : ?>
					<?php
					$class = 'notice-error';
					if ('success' === $status) {
						$class = 'notice-success';
					} elseif ('warning' === $status) {
						$class = 'notice-warning';
					}
					?>
					<div class="notice <?php echo esc_attr($class); ?>">
						<p><strong><?php echo esc_html($message); ?></strong></p>
						<?php if (!empty($details)) : ?>
							<p><?php echo esc_html($details); ?></p>
						<?php endif; ?>
					</div>
				<?php endif; ?>

				<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
					<input type="hidden" name="action" value="wjmi_import_json" />
					<?php wp_nonce_field(self::NONCE_ACTION); ?>
					<table class="form-table" role="presentation">
						<tbody>
							<tr>
								<th scope="row"><label for="metadata_file">Ficheiro JSON</label></th>
								<td>
									<input type="file" id="metadata_file" name="metadata_file" accept=".json,application/json" required />
									<p class="description">Formato esperado: objeto com chave <code>products</code> (array) ou array direto de produtos.</p>
								</td>
							</tr>
						</tbody>
					</table>
					<?php submit_button('Importar JSON para WooCommerce'); ?>
				</form>
			</div>
			<?php
		}

		public function handle_import() {
			if (!current_user_can($this->required_capability())) {
				wp_die(esc_html__('You do not have permission to perform this action.', 'woo-json-metadata-importer'));
			}

			check_admin_referer(self::NONCE_ACTION);

			if (!class_exists('WooCommerce')) {
				$this->redirect_with_notice('error', 'WooCommerce nao esta ativo.');
			}

			if (
				empty($_FILES['metadata_file']) ||
				!is_array($_FILES['metadata_file']) ||
				empty($_FILES['metadata_file']['tmp_name'])
			) {
				$this->redirect_with_notice('error', 'Nenhum ficheiro foi enviado.');
			}

			$file = $_FILES['metadata_file'];
			if (!empty($file['error'])) {
				$this->redirect_with_notice('error', 'Falha no upload do ficheiro JSON.');
			}

			$rawJson = file_get_contents($file['tmp_name']); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			if (false === $rawJson || '' === trim($rawJson)) {
				$this->redirect_with_notice('error', 'Nao foi possivel ler o ficheiro enviado.');
			}

			$payload = json_decode($rawJson, true);
			if (JSON_ERROR_NONE !== json_last_error()) {
				$this->redirect_with_notice('error', 'JSON invalido: ' . json_last_error_msg());
			}

			try {
				$products = $this->extract_products($payload);
			} catch (Exception $exception) {
				$this->redirect_with_notice('error', $exception->getMessage());
			}

			$summary = array(
				'created' => 0,
				'updated' => 0,
				'failed' => 0,
			);
			$errors = array();

			foreach ($products as $index => $productData) {
				try {
					$result = $this->import_product($productData);
					if ('created' === $result) {
						$summary['created']++;
					} else {
						$summary['updated']++;
					}
				} catch (Throwable $exception) {
					$summary['failed']++;
					$errors[] = sprintf('Produto #%d: %s', $index + 1, $exception->getMessage());
				}
			}

			$message = sprintf(
				'Importacao concluida. Criados: %d | Atualizados: %d | Falhas: %d',
				$summary['created'],
				$summary['updated'],
				$summary['failed']
			);

			$details = '';
			if (!empty($errors)) {
				$details = implode(' || ', array_slice($errors, 0, 5));
			}

			$status = $summary['failed'] > 0 ? 'warning' : 'success';
			$this->redirect_with_notice($status, $message, $details);
		}

		private function extract_products($payload) {
			if (is_array($payload) && isset($payload['products']) && is_array($payload['products'])) {
				return $payload['products'];
			}

			if ($this->is_list_array($payload)) {
				return $payload;
			}

			if (is_array($payload) && isset($payload['id'])) {
				return array($payload);
			}

			throw new Exception('Estrutura JSON invalida. Esperado: { "products": [...] }.');
		}

		private function is_list_array($value) {
			if (!is_array($value)) {
				return false;
			}

			$index = 0;
			foreach ($value as $key => $_item) {
				if ($key !== $index) {
					return false;
				}
				$index++;
			}

			return true;
		}

		private function import_product($productData) {
			if (!is_array($productData)) {
				throw new Exception('Produto invalido no JSON.');
			}

			$isVariable = $this->is_variable_product_payload($productData);
			$sku = isset($productData['sku']) ? wc_clean((string) $productData['sku']) : '';
			$productId = $sku ? (int) wc_get_product_id_by_sku($sku) : 0;
			$sourceProductId = isset($productData['id']) ? (int) $productData['id'] : 0;

			if ($productId <= 0 && $sourceProductId > 0) {
				$productId = $this->find_product_by_source_id($sourceProductId);
			}

			if ($productId <= 0 && !empty($productData['slug'])) {
				$existingBySlug = get_page_by_path(sanitize_title((string) $productData['slug']), OBJECT, 'product');
				if ($existingBySlug instanceof WP_Post) {
					$productId = (int) $existingBySlug->ID;
				}
			}

			if ($productId > 0) {
				wp_set_object_terms($productId, $isVariable ? 'variable' : 'simple', 'product_type');
			}

			if ($isVariable) {
				$product = $productId > 0 ? new WC_Product_Variable($productId) : new WC_Product_Variable();
			} else {
				$product = $productId > 0 ? new WC_Product_Simple($productId) : new WC_Product_Simple();
			}

			$isCreated = $productId <= 0;

			$this->hydrate_common_product($product, $productData);
			$this->apply_pricing($product, $productData['prices'] ?? array());
			$product->set_attributes($this->build_parent_attributes($productData, $isVariable));
			$product->set_category_ids($this->resolve_term_ids($productData['categories'] ?? array(), 'product_cat'));
			$product->set_tag_ids($this->resolve_term_ids($productData['tags'] ?? array(), 'product_tag'));
			$product->save();

			$parentId = $product->get_id();
			if ($sourceProductId > 0) {
				update_post_meta($parentId, '_wjmi_source_product_id', $sourceProductId);
			}
			$this->attach_images_to_product($parentId, $productData['images'] ?? array());

			if ($isVariable) {
				$this->import_variations($parentId, $productData);
				WC_Product_Variable::sync($parentId);
			}

			return $isCreated ? 'created' : 'updated';
		}

		private function hydrate_common_product($product, $productData) {
			$name = isset($productData['name']) ? sanitize_text_field((string) $productData['name']) : '';
			if ('' === $name) {
				$name = 'Produto sem nome';
			}
			$product->set_name($name);

			if (!empty($productData['slug'])) {
				$product->set_slug(sanitize_title($productData['slug']));
			}

			$product->set_description(isset($productData['description']) ? wp_kses_post((string) $productData['description']) : '');
			$product->set_short_description(isset($productData['short_description']) ? wp_kses_post((string) $productData['short_description']) : '');
			$product->set_status('publish');
			$product->set_featured(!empty($productData['is_featured']));
			$product->set_manage_stock(false);

			if (!empty($productData['sku'])) {
				$product->set_sku(wc_clean((string) $productData['sku']));
			}

			$visibility = isset($productData['catalog_visibility']) ? sanitize_key((string) $productData['catalog_visibility']) : 'visible';
			$allowedVisibility = array('visible', 'catalog', 'search', 'hidden');
			if (!in_array($visibility, $allowedVisibility, true)) {
				$visibility = 'visible';
			}
			$product->set_catalog_visibility($visibility);

			$product->set_stock_status($this->resolve_stock_status($productData));

			$taxStatus = isset($productData['tax_status']) ? sanitize_key((string) $productData['tax_status']) : 'taxable';
			$allowedTaxStatus = array('taxable', 'shipping', 'none');
			if (!in_array($taxStatus, $allowedTaxStatus, true)) {
				$taxStatus = 'taxable';
			}
			$product->set_tax_status($taxStatus);
		}

		private function apply_pricing($product, $prices) {
			if (!is_array($prices)) {
				$product->set_regular_price('');
				$product->set_sale_price('');
				return;
			}

			$minor = isset($prices['currency_minor_unit']) ? (int) $prices['currency_minor_unit'] : 2;
			$regular = $this->minor_to_decimal($prices['regular_price'] ?? ($prices['price'] ?? ''), $minor);
			$sale = $this->minor_to_decimal($prices['sale_price'] ?? '', $minor);

			$product->set_regular_price($regular);
			$product->set_sale_price($sale);
		}

		private function minor_to_decimal($value, $minorUnit) {
			if (null === $value || '' === $value) {
				return '';
			}

			$raw = str_replace(',', '.', trim((string) $value));
			if ('' === $raw || !is_numeric($raw)) {
				return '';
			}

			$minor = is_numeric($minorUnit) ? (int) $minorUnit : 2;
			$number = (float) $raw;

			if ($minor < 0) {
				$minor = 0;
			}

			// If the input already carries decimal notation, keep it as decimal.
			if (false !== strpos($raw, '.')) {
				return number_format($number, $minor, '.', '');
			}

			$decimal = $number / pow(10, $minor);
			if ($minor > 0) {
				return number_format($decimal, $minor, '.', '');
			}

			return (string) $decimal;
		}

		private function first_non_empty_price($candidates) {
			if (!is_array($candidates)) {
				return '';
			}

			foreach ($candidates as $candidate) {
				if (null === $candidate) {
					continue;
				}
				if ('' === trim((string) $candidate)) {
					continue;
				}
				return $candidate;
			}

			return '';
		}

		private function resolve_minor_unit($variationData, $parentMinor) {
			$minorCandidates = array(
				$variationData['prices']['currency_minor_unit'] ?? null,
				$variationData['currency_minor_unit'] ?? null,
				$variationData['raw']['prices']['currency_minor_unit'] ?? null,
				$variationData['raw']['currency_minor_unit'] ?? null,
				$parentMinor,
			);

			foreach ($minorCandidates as $minor) {
				if (is_numeric($minor)) {
					return (int) $minor;
				}
			}

			return 2;
		}

		private function resolve_term_ids($termItems, $taxonomy) {
			if (!is_array($termItems)) {
				return array();
			}

			$ids = array();
			foreach ($termItems as $termItem) {
				$name = '';
				if (is_array($termItem) && !empty($termItem['name'])) {
					$name = sanitize_text_field((string) $termItem['name']);
				} elseif (is_string($termItem)) {
					$name = sanitize_text_field($termItem);
				}

				if ('' === $name) {
					continue;
				}

				$term = term_exists($name, $taxonomy);
				if (0 === $term || null === $term) {
					$term = wp_insert_term($name, $taxonomy);
				}

				if (is_wp_error($term)) {
					continue;
				}

				if (is_array($term) && isset($term['term_id'])) {
					$ids[] = (int) $term['term_id'];
				} elseif (is_numeric($term)) {
					$ids[] = (int) $term;
				}
			}

			return array_values(array_unique(array_filter($ids)));
		}

		private function build_parent_attributes($productData, $isVariable) {
			if (empty($productData['attributes']) || !is_array($productData['attributes'])) {
				return array();
			}

			$attributes = array();
			$position = 0;

			foreach ($productData['attributes'] as $rawAttribute) {
				if (!is_array($rawAttribute)) {
					continue;
				}

				$name = $this->pick_attribute_name($rawAttribute);
				if ('' === $name) {
					continue;
				}

				$options = $this->extract_attribute_options($rawAttribute);
				if (empty($options)) {
					continue;
				}

				$productAttribute = new WC_Product_Attribute();
				$productAttribute->set_id(0);
				$productAttribute->set_name($name);
				$productAttribute->set_options($options);
				$productAttribute->set_visible(!isset($rawAttribute['visible']) || (bool) $rawAttribute['visible']);
				$productAttribute->set_variation($isVariable);
				$productAttribute->set_position($position);

				$attributes[] = $productAttribute;
				$position++;
			}

			return $attributes;
		}

		private function pick_attribute_name($rawAttribute) {
			$candidates = array(
				$rawAttribute['name'] ?? '',
				$rawAttribute['label'] ?? '',
				$rawAttribute['slug'] ?? '',
				$rawAttribute['taxonomy'] ?? '',
			);

			foreach ($candidates as $value) {
				$text = trim((string) $value);
				if ('' !== $text) {
					return wc_clean(str_replace('pa_', '', $text));
				}
			}

			return '';
		}

		private function extract_attribute_options($rawAttribute) {
			$options = array();

			if (!empty($rawAttribute['terms']) && is_array($rawAttribute['terms'])) {
				foreach ($rawAttribute['terms'] as $term) {
					if (is_array($term)) {
						if (!empty($term['name'])) {
							$options[] = wc_clean((string) $term['name']);
						} elseif (!empty($term['slug'])) {
							$options[] = wc_clean((string) $term['slug']);
						}
					} elseif (is_string($term)) {
						$options[] = wc_clean($term);
					}
				}
			}

			if (!empty($rawAttribute['options']) && is_array($rawAttribute['options'])) {
				foreach ($rawAttribute['options'] as $option) {
					if (is_string($option) || is_numeric($option)) {
						$options[] = wc_clean((string) $option);
					}
				}
			}

			if (!empty($rawAttribute['option'])) {
				$options[] = wc_clean((string) $rawAttribute['option']);
			}

			if (!empty($rawAttribute['value']) && (is_string($rawAttribute['value']) || is_numeric($rawAttribute['value']))) {
				$options[] = wc_clean((string) $rawAttribute['value']);
			}

			if (!empty($rawAttribute['values']) && is_array($rawAttribute['values'])) {
				foreach ($rawAttribute['values'] as $value) {
					if (is_string($value) || is_numeric($value)) {
						$options[] = wc_clean((string) $value);
					}
				}
			}

			$options = array_map('trim', $options);
			$options = array_filter($options, static function ($value) {
				return '' !== $value;
			});

			return array_values(array_unique($options));
		}

		private function is_variable_product_payload($productData) {
			if (!empty($productData['type']) && 'variable' === strtolower((string) $productData['type'])) {
				return true;
			}

			if (!empty($productData['variationDetails']) && is_array($productData['variationDetails'])) {
				return true;
			}

			if (!empty($productData['raw']['has_options'])) {
				return true;
			}

			if (!empty($productData['raw']['variations']) && is_array($productData['raw']['variations'])) {
				return true;
			}

			return false;
		}

		private function resolve_stock_status($payload) {
			if (is_array($payload) && !empty($payload['stock_status'])) {
				$status = sanitize_key((string) $payload['stock_status']);
				if (in_array($status, array('instock', 'outofstock', 'onbackorder'), true)) {
					return $status;
				}
			}

			if (is_array($payload) && isset($payload['is_in_stock'])) {
				return !empty($payload['is_in_stock']) ? 'instock' : 'outofstock';
			}

			return 'instock';
		}

		private function import_variations($parentId, $productData) {
			if (empty($productData['variationDetails']) || !is_array($productData['variationDetails'])) {
				return;
			}

			$parentAttributeOptions = $this->build_parent_attribute_options_map($productData['attributes'] ?? array());
			$attributeKeyMap = $this->build_attribute_key_map($productData['attributes'] ?? array());
			$parentMinor = isset($productData['prices']['currency_minor_unit']) ? (int) $productData['prices']['currency_minor_unit'] : 2;

			foreach ($productData['variationDetails'] as $variationData) {
				if (!is_array($variationData)) {
					continue;
				}

				$variationSku = !empty($variationData['sku']) ? wc_clean((string) $variationData['sku']) : '';
				$sourceVariationId = isset($variationData['id']) ? (int) $variationData['id'] : 0;
				$variationId = 0;

				if ($variationSku) {
					$existingId = (int) wc_get_product_id_by_sku($variationSku);
					if ($existingId > 0) {
						$postType = get_post_type($existingId);
						$existingParent = (int) wp_get_post_parent_id($existingId);
						if ('product_variation' !== $postType || ($existingParent > 0 && $existingParent !== (int) $parentId)) {
							throw new Exception(sprintf('SKU de variacao em conflito: %s', $variationSku));
						}
						$variationId = $existingId;
					}
				}

				if ($variationId <= 0 && $sourceVariationId > 0) {
					$variationId = $this->find_variation_by_source_id($parentId, $sourceVariationId);
				}

				$variation = $variationId > 0 ? new WC_Product_Variation($variationId) : new WC_Product_Variation();
				$variation->set_parent_id($parentId);
				$variation->set_status('publish');

				if ($variationSku) {
					$variation->set_sku($variationSku);
				}

				$variation->set_description(isset($variationData['description']) ? wp_kses_post((string) $variationData['description']) : '');
				$variation->set_manage_stock(false);
				$variation->set_stock_status($this->resolve_stock_status($variationData));

				$taxStatus = isset($variationData['tax_status']) ? sanitize_key((string) $variationData['tax_status']) : '';
				if (!in_array($taxStatus, array('taxable', 'shipping', 'none'), true)) {
					$taxStatus = 'taxable';
				}
				$variation->set_tax_status($taxStatus);

				$minor = $this->resolve_minor_unit($variationData, $parentMinor);
				$rawRegular = $this->first_non_empty_price(
					array(
						$variationData['prices']['regular_price'] ?? null,
						$variationData['prices']['price'] ?? null,
						$variationData['regular_price'] ?? null,
						$variationData['price'] ?? null,
						$variationData['raw']['prices']['regular_price'] ?? null,
						$variationData['raw']['prices']['price'] ?? null,
						$variationData['raw']['regular_price'] ?? null,
						$variationData['raw']['price'] ?? null
					)
				);
				$rawSale = $this->first_non_empty_price(
					array(
						$variationData['prices']['sale_price'] ?? null,
						$variationData['sale_price'] ?? null,
						$variationData['raw']['prices']['sale_price'] ?? null,
						$variationData['raw']['sale_price'] ?? null
					)
				);
				$variationRegular = $this->minor_to_decimal($rawRegular, $minor);
				$variationSale = $this->minor_to_decimal($rawSale, $minor);
				$variation->set_regular_price($variationRegular);
				$variation->set_sale_price($variationSale);

				$variationAttrs = $this->extract_variation_attributes(
					$variationData['attributes'] ?? array(),
					$attributeKeyMap,
					$parentAttributeOptions
				);
				if (!empty($variationAttrs)) {
					$variation->set_attributes($variationAttrs);
				}

				$variation->save();
				if ($sourceVariationId > 0) {
					update_post_meta($variation->get_id(), '_wjmi_source_variation_id', $sourceVariationId);
				}

				$variationImageUrl = $this->resolve_variation_image_url($variationData);
				if ('' !== $variationImageUrl) {
					$imageId = $this->sideload_image_attachment($variationImageUrl, $variation->get_id());
					if ($imageId > 0) {
						$variation->set_image_id($imageId);
						$variation->save();
					}
				}
			}
		}

		private function build_attribute_key_map($attributes) {
			$map = array();
			if (!is_array($attributes)) {
				return $map;
			}

			foreach ($attributes as $attribute) {
				if (!is_array($attribute)) {
					continue;
				}

				$name = $this->pick_attribute_name($attribute);
				if ('' === $name) {
					continue;
				}

				$canonicalKey = sanitize_title($name);
				$map[$canonicalKey] = $canonicalKey;

				$candidates = array(
					$attribute['name'] ?? '',
					$attribute['label'] ?? '',
					$attribute['slug'] ?? '',
					$attribute['taxonomy'] ?? '',
				);

				foreach ($candidates as $candidate) {
					$candidateKey = sanitize_title(str_replace('pa_', '', (string) $candidate));
					if ('' !== $candidateKey) {
						$map[$candidateKey] = $canonicalKey;
					}
				}
			}

			return $map;
		}

		private function build_parent_attribute_options_map($attributes) {
			$map = array();
			if (!is_array($attributes)) {
				return $map;
			}

			foreach ($attributes as $attribute) {
				if (!is_array($attribute)) {
					continue;
				}

				$name = $this->pick_attribute_name($attribute);
				if ('' === $name) {
					continue;
				}

				$key = sanitize_title($name);
				$options = $this->extract_attribute_options($attribute);
				if (!empty($options)) {
					$map[$key] = $options;
				}
			}

			return $map;
		}

		private function extract_variation_attributes($attributes, $attributeKeyMap, $parentAttributeOptions) {
			$result = array();

			if (!is_array($attributes)) {
				return $result;
			}

			$fallbackParentKeys = array_keys($parentAttributeOptions);
			$fallbackIndex = 0;

			foreach ($attributes as $attribute) {
				if (!is_array($attribute)) {
					$fallbackIndex++;
					continue;
				}

				$rawCandidates = array(
					$attribute['name'] ?? '',
					$attribute['label'] ?? '',
					$attribute['slug'] ?? '',
					$attribute['taxonomy'] ?? '',
				);

				$key = '';
				foreach ($rawCandidates as $candidate) {
					$candidateKey = sanitize_title(str_replace('pa_', '', (string) $candidate));
					if ('' !== $candidateKey && isset($attributeKeyMap[$candidateKey])) {
						$key = $attributeKeyMap[$candidateKey];
						break;
					}
				}

				if ('' === $key && isset($fallbackParentKeys[$fallbackIndex])) {
					$key = $fallbackParentKeys[$fallbackIndex];
				}

				if ('' === $key) {
					$fallbackIndex++;
					continue;
				}

				$options = $this->extract_attribute_options($attribute);
				$value = !empty($options) ? (string) $options[0] : '';
				if ('' !== $value) {
					$result[$key] = $this->match_value_to_parent_options($value, $parentAttributeOptions[$key] ?? array());
				}

				$fallbackIndex++;
			}

			return $result;
		}

		private function match_value_to_parent_options($value, $parentOptions) {
			$cleanValue = wc_clean((string) $value);
			if ('' === $cleanValue || !is_array($parentOptions) || empty($parentOptions)) {
				return $cleanValue;
			}

			$needle = $this->normalize_attribute_match($cleanValue);
			foreach ($parentOptions as $parentOption) {
				$candidate = wc_clean((string) $parentOption);
				if ($this->normalize_attribute_match($candidate) === $needle) {
					return $candidate;
				}
			}

			foreach ($parentOptions as $parentOption) {
				$candidate = wc_clean((string) $parentOption);
				$normalizedCandidate = $this->normalize_attribute_match($candidate);
				if ('' !== $needle && (false !== strpos($normalizedCandidate, $needle) || false !== strpos($needle, $normalizedCandidate))) {
					return $candidate;
				}
			}

			return $cleanValue;
		}

		private function normalize_attribute_match($value) {
			return sanitize_title(remove_accents((string) $value));
		}

		private function resolve_variation_image_url($variationData) {
			if (!is_array($variationData)) {
				return '';
			}

			$candidates = array();

			if (!empty($variationData['image'])) {
				$candidates = array_merge($candidates, $this->extract_image_candidates($variationData['image']));
			}
			if (!empty($variationData['images'])) {
				$candidates = array_merge($candidates, $this->extract_image_candidates($variationData['images']));
			}

			if (!empty($variationData['raw']) && is_array($variationData['raw'])) {
				if (!empty($variationData['raw']['image'])) {
					$candidates = array_merge($candidates, $this->extract_image_candidates($variationData['raw']['image']));
				}
				if (!empty($variationData['raw']['images'])) {
					$candidates = array_merge($candidates, $this->extract_image_candidates($variationData['raw']['images']));
				}
			}

			foreach ($candidates as $candidate) {
				$url = esc_url_raw((string) $candidate);
				if ('' !== $url) {
					return $url;
				}
			}

			return '';
		}

		private function extract_image_candidates($imageData) {
			$urls = array();

			if (is_string($imageData)) {
				$urls[] = $imageData;
				return $urls;
			}

			if (!is_array($imageData)) {
				return $urls;
			}

			$isList = array_keys($imageData) === range(0, count($imageData) - 1);
			if ($isList) {
				foreach ($imageData as $item) {
					$urls = array_merge($urls, $this->extract_image_candidates($item));
				}
				return $urls;
			}

			$keys = array('src', 'thumbnail', 'url', 'full', 'original', 'srcset');
			foreach ($keys as $key) {
				if (!empty($imageData[$key]) && is_string($imageData[$key])) {
					$urls[] = $imageData[$key];
				}
			}

			return $urls;
		}

		private function attach_images_to_product($productId, $images) {
			if (!is_array($images) || empty($images)) {
				return;
			}

			$ids = array();
			foreach ($images as $image) {
				$url = '';
				if (is_array($image) && !empty($image['src'])) {
					$url = esc_url_raw((string) $image['src']);
				} elseif (is_string($image)) {
					$url = esc_url_raw($image);
				}

				if ('' === $url) {
					continue;
				}

				$attachmentId = $this->sideload_image_attachment($url, $productId);
				if ($attachmentId > 0) {
					$ids[] = $attachmentId;
				}
			}

			if (empty($ids)) {
				return;
			}

			$ids = array_values(array_unique($ids));
			$product = wc_get_product($productId);
			if (!$product) {
				return;
			}

			$product->set_image_id($ids[0]);
			$product->set_gallery_image_ids(array_slice($ids, 1));
			$product->save();
		}

		private function sideload_image_attachment($url, $parentId) {
			$existingId = $this->find_attachment_by_source_url($url);
			if ($existingId > 0) {
				return $existingId;
			}

			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';

			$attachmentId = media_sideload_image($url, $parentId, null, 'id');
			if (is_wp_error($attachmentId)) {
				return 0;
			}

			update_post_meta((int) $attachmentId, '_wjmi_source_url', esc_url_raw($url));
			return (int) $attachmentId;
		}

		private function find_attachment_by_source_url($url) {
			$ids = get_posts(
				array(
					'post_type' => 'attachment',
					'post_status' => 'inherit',
					'numberposts' => 1,
					'fields' => 'ids',
					'meta_key' => '_wjmi_source_url',
					'meta_value' => esc_url_raw($url),
				)
			);

			if (!empty($ids)) {
				return (int) $ids[0];
			}

			return 0;
		}

		private function find_product_by_source_id($sourceProductId) {
			$ids = get_posts(
				array(
					'post_type' => 'product',
					'post_status' => array('publish', 'draft', 'pending', 'private'),
					'numberposts' => 1,
					'fields' => 'ids',
					'meta_key' => '_wjmi_source_product_id',
					'meta_value' => (string) $sourceProductId,
				)
			);

			if (!empty($ids)) {
				return (int) $ids[0];
			}

			return 0;
		}

		private function find_variation_by_source_id($parentId, $sourceVariationId) {
			$ids = get_posts(
				array(
					'post_type' => 'product_variation',
					'post_parent' => (int) $parentId,
					'post_status' => array('publish', 'private'),
					'numberposts' => 1,
					'fields' => 'ids',
					'meta_key' => '_wjmi_source_variation_id',
					'meta_value' => (string) $sourceVariationId,
				)
			);

			if (!empty($ids)) {
				return (int) $ids[0];
			}

			return 0;
		}

		private function redirect_with_notice($status, $message, $details = '') {
			$args = array(
				'page' => self::MENU_SLUG,
				'wjmi_status' => sanitize_key($status),
				'wjmi_message' => sanitize_text_field((string) $message),
			);

			if ('' !== $details) {
				$args['wjmi_details'] = sanitize_text_field((string) $details);
			}

			$url = add_query_arg($args, admin_url('admin.php'));
			wp_safe_redirect($url);
			exit;
		}
	}
}

add_action(
	'plugins_loaded',
	static function () {
		new WJMI_Plugin();
	}
);
