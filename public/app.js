const form = document.getElementById('scrape-form');
const startBtn = document.getElementById('start-btn');
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');
const resultEl = document.getElementById('result');
const outputDirInput = document.getElementById('output-dir');
const languageSelect = document.getElementById('language-select');
const engineSelect = document.getElementById('engine-select');
const runFeedbackEl = document.getElementById('run-feedback');

const metrics = {
  productsFound: document.getElementById('m-products-found'),
  productsProcessed: document.getElementById('m-products-processed'),
  imagesDownloaded: document.getElementById('m-images-downloaded'),
  csv: document.getElementById('m-csv')
};

let pollTimer = null;
let knownLogCount = 0;
let currentLanguage = localStorage.getItem('wooExportLanguage') || 'en';
let currentStatus = { mode: 'idle', key: 'status.idle', params: null, raw: null };
let csvGenerated = false;
let isJobRunning = false;
let feedbackModel = null;

const translations = {
  en: {
    'page.title': 'WooCommerce Export Operations Console',
    'hero.eyebrow': 'WOOCOMMERCE EXPORT OPS',
    'hero.title': 'Professional Data Export Console',
    'hero.copy':
      'Connect any WooCommerce storefront, capture structured catalog data, and generate migration-ready outputs with operational visibility.',
    'language.label': 'Language',
    'panel.target.title': 'Target Configuration',
    'panel.report.title': 'Transfer Report',
    'panel.metrics.title': 'Runtime Metrics',
    'panel.logs.title': 'Live Logs',
    'chip.live': 'LIVE LINK',
    'chip.output': 'OUTPUT',
    'chip.telemetry': 'TELEMETRY',
    'chip.stream': 'STREAM',
    'form.storeUrl.label': 'Store URL',
    'form.storeUrl.placeholder': 'https://example.com',
    'form.limit.label': 'Product limit (0 = all)',
    'form.engine.label': 'Extraction engine',
    'form.engine.node': 'Node.js (current)',
    'form.engine.python': 'Python (experimental)',
    'form.engine.help':
      'Use Python mode for large stores when you want to test a separate extraction worker.',
    'form.outputDir.label': 'Output folder',
    'form.outputDir.placeholder': '/Users/your-user/Downloads/woo-exports',
    'form.outputDir.help': 'If empty, default output folder is used.',
    'form.submit': 'Start WooCommerce Export',
    'form.submitRunning': 'Export Running...',
    'metrics.productsFound': 'Products discovered',
    'metrics.productsProcessed': 'Products processed',
    'metrics.imagesDownloaded': 'Images downloaded',
    'metrics.csvGenerated': 'CSV generated',
    'flag.yes': 'YES',
    'flag.no': 'NO',
    'status.idle': 'Waiting for URL...',
    'status.starting': 'Starting WooCommerce export...',
    'status.jobRunning': 'Job {jobId} is running...',
    'status.success': 'Completed successfully.',
    'status.failedPrefix': 'Failed',
    'status.updateErrorPrefix': 'Update error',
    'status.unknownError': 'unknown error',
    'error.readJob': 'Could not read job status.',
    'error.startJob': 'Could not start job.',
    'result.outputDir': 'Output folder',
    'result.engine': 'Engine',
    'result.products': 'Products',
    'result.imagesDownloaded': 'Images downloaded',
    'result.importCsv': 'Import CSV',
    'result.metadataJson': 'Metadata JSON',
    'feedback.running.title': 'Export in progress',
    'feedback.running.body':
      'Processing {processed}/{discovered} products. Images downloaded: {images}.',
    'feedback.running.stage.scan': 'Stage: scanning product catalog...',
    'feedback.running.stage.variations': 'Stage: resolving variation data ({done}/{total}).',
    'feedback.running.stage.images': 'Stage: downloading product images...',
    'feedback.running.stage.default': 'Stage: running export pipeline...',
    'feedback.success.title': 'Export completed',
    'feedback.success.body': 'All files were generated successfully and are ready for import.',
    'feedback.failed.title': 'Export failed',
    'feedback.failed.body': 'The job stopped with an error. Check logs for details.'
  },
  fr: {
    'page.title': "Console d'export WooCommerce",
    'hero.eyebrow': 'OPERATIONS EXPORT WOOCOMMERCE',
    'hero.title': "Console professionnelle d'export de donnees",
    'hero.copy':
      'Connectez une boutique WooCommerce, capturez un catalogue structure et generez des sorties pretes pour migration avec visibilite operationnelle.',
    'language.label': 'Langue',
    'panel.target.title': 'Configuration cible',
    'panel.report.title': 'Rapport de transfert',
    'panel.metrics.title': 'Metriques runtime',
    'panel.logs.title': 'Logs en direct',
    'chip.live': 'LIEN ACTIF',
    'chip.output': 'SORTIE',
    'chip.telemetry': 'TELEMETRIE',
    'chip.stream': 'FLUX',
    'form.storeUrl.label': 'URL de la boutique',
    'form.storeUrl.placeholder': 'https://exemple.com',
    'form.limit.label': 'Limite produits (0 = tous)',
    'form.engine.label': "Moteur d'extraction",
    'form.engine.node': 'Node.js (actuel)',
    'form.engine.python': 'Python (experimental)',
    'form.engine.help':
      'Utilisez le mode Python pour les grandes boutiques si vous voulez tester un worker separe.',
    'form.outputDir.label': 'Dossier de sortie',
    'form.outputDir.placeholder': '/Users/votre-user/Downloads/woo-exports',
    'form.outputDir.help': 'Si vide, le dossier par defaut est utilise.',
    'form.submit': "Demarrer l'export WooCommerce",
    'form.submitRunning': 'Export en cours...',
    'metrics.productsFound': 'Produits detectes',
    'metrics.productsProcessed': 'Produits traites',
    'metrics.imagesDownloaded': 'Images telechargees',
    'metrics.csvGenerated': 'CSV genere',
    'flag.yes': 'OUI',
    'flag.no': 'NON',
    'status.idle': "En attente d'une URL...",
    'status.starting': "Demarrage de l'export WooCommerce...",
    'status.jobRunning': 'Job {jobId} en cours...',
    'status.success': 'Termine avec succes.',
    'status.failedPrefix': 'Echec',
    'status.updateErrorPrefix': 'Erreur de mise a jour',
    'status.unknownError': 'erreur inconnue',
    'error.readJob': "Impossible de lire l'etat du job.",
    'error.startJob': "Impossible de demarrer le job.",
    'result.outputDir': 'Dossier de sortie',
    'result.engine': 'Moteur',
    'result.products': 'Produits',
    'result.imagesDownloaded': 'Images telechargees',
    'result.importCsv': "CSV d'import",
    'result.metadataJson': 'JSON metadata',
    'feedback.running.title': 'Export en cours',
    'feedback.running.body':
      'Traitement {processed}/{discovered} produits. Images telechargees: {images}.',
    'feedback.running.stage.scan': 'Etape: analyse du catalogue produits...',
    'feedback.running.stage.variations': 'Etape: resolution des variations ({done}/{total}).',
    'feedback.running.stage.images': 'Etape: telechargement des images produits...',
    'feedback.running.stage.default': "Etape: execution du pipeline d'export...",
    'feedback.success.title': 'Export termine',
    'feedback.success.body': 'Tous les fichiers ont ete generes avec succes et sont prets a importer.',
    'feedback.failed.title': "Echec de l'export",
    'feedback.failed.body': "Le job s'est arrete avec une erreur. Consultez les logs pour les details."
  },
  es: {
    'page.title': 'Consola de exportacion WooCommerce',
    'hero.eyebrow': 'OPERACIONES EXPORT WOOCOMMERCE',
    'hero.title': 'Consola profesional de exportacion de datos',
    'hero.copy':
      'Conecta cualquier tienda WooCommerce, captura catalogo estructurado y genera salidas listas para migracion con visibilidad operativa.',
    'language.label': 'Idioma',
    'panel.target.title': 'Configuracion objetivo',
    'panel.report.title': 'Reporte de transferencia',
    'panel.metrics.title': 'Metricas runtime',
    'panel.logs.title': 'Logs en vivo',
    'chip.live': 'ENLACE ACTIVO',
    'chip.output': 'SALIDA',
    'chip.telemetry': 'TELEMETRIA',
    'chip.stream': 'FLUJO',
    'form.storeUrl.label': 'URL de la tienda',
    'form.storeUrl.placeholder': 'https://ejemplo.com',
    'form.limit.label': 'Limite de productos (0 = todos)',
    'form.engine.label': 'Motor de extraccion',
    'form.engine.node': 'Node.js (actual)',
    'form.engine.python': 'Python (experimental)',
    'form.engine.help':
      'Usa el modo Python para tiendas grandes si quieres probar un worker de extraccion separado.',
    'form.outputDir.label': 'Carpeta de salida',
    'form.outputDir.placeholder': '/Users/tu-user/Downloads/woo-exports',
    'form.outputDir.help': 'Si se deja vacio, se usa la carpeta por defecto.',
    'form.submit': 'Iniciar exportacion WooCommerce',
    'form.submitRunning': 'Exportacion en curso...',
    'metrics.productsFound': 'Productos detectados',
    'metrics.productsProcessed': 'Productos procesados',
    'metrics.imagesDownloaded': 'Imagenes descargadas',
    'metrics.csvGenerated': 'CSV generado',
    'flag.yes': 'SI',
    'flag.no': 'NO',
    'status.idle': 'Esperando URL...',
    'status.starting': 'Iniciando exportacion WooCommerce...',
    'status.jobRunning': 'Job {jobId} en ejecucion...',
    'status.success': 'Completado correctamente.',
    'status.failedPrefix': 'Fallo',
    'status.updateErrorPrefix': 'Error de actualizacion',
    'status.unknownError': 'error desconocido',
    'error.readJob': 'No fue posible leer el estado del job.',
    'error.startJob': 'No fue posible iniciar el job.',
    'result.outputDir': 'Carpeta de salida',
    'result.engine': 'Motor',
    'result.products': 'Productos',
    'result.imagesDownloaded': 'Imagenes descargadas',
    'result.importCsv': 'CSV de importacion',
    'result.metadataJson': 'JSON metadata',
    'feedback.running.title': 'Exportacion en progreso',
    'feedback.running.body':
      'Procesando {processed}/{discovered} productos. Imagenes descargadas: {images}.',
    'feedback.running.stage.scan': 'Etapa: escaneando catalogo de productos...',
    'feedback.running.stage.variations': 'Etapa: resolviendo variaciones ({done}/{total}).',
    'feedback.running.stage.images': 'Etapa: descargando imagenes de productos...',
    'feedback.running.stage.default': 'Etapa: ejecutando pipeline de exportacion...',
    'feedback.success.title': 'Exportacion completada',
    'feedback.success.body': 'Todos los archivos se generaron correctamente y estan listos para importar.',
    'feedback.failed.title': 'Exportacion fallida',
    'feedback.failed.body': 'El job se detuvo con un error. Revisa los logs para detalles.'
  }
};

function t(key, params = null) {
  const langTable = translations[currentLanguage] || translations.en;
  const base = langTable[key] || translations.en[key] || key;
  if (!params) {
    return base;
  }

  return Object.entries(params).reduce(
    (output, [paramKey, paramValue]) => output.replaceAll(`{${paramKey}}`, String(paramValue)),
    base
  );
}

function setStatusKey(key, mode, params = null) {
  currentStatus = { mode, key, params, raw: null };
  statusEl.textContent = t(key, params);
  statusEl.className = `status status--${mode}`;
}

function setStatusRaw(text, mode) {
  currentStatus = { mode, key: null, params: null, raw: text };
  statusEl.textContent = text;
  statusEl.className = `status status--${mode}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setStartButtonRunningState(running) {
  isJobRunning = running;
  startBtn.disabled = running;
  startBtn.textContent = running ? t('form.submitRunning') : t('form.submit');
}

function setFeedbackModel(model) {
  feedbackModel = model;
  renderFeedback();
}

function renderFeedback() {
  if (!runFeedbackEl) {
    return;
  }

  if (!feedbackModel) {
    runFeedbackEl.hidden = true;
    runFeedbackEl.className = 'run-feedback';
    runFeedbackEl.innerHTML = '';
    return;
  }

  if (feedbackModel.type === 'running') {
    const discovered = feedbackModel.discovered ?? 0;
    const processed = feedbackModel.processed ?? 0;
    const images = feedbackModel.images ?? 0;
    const variationDone = feedbackModel.variationDone ?? 0;
    const variationTotal = feedbackModel.variationTotal ?? 0;
    const stage = feedbackModel.stage || '';
    let stageText = t('feedback.running.stage.default');

    if (stage === 'scanning_products') {
      stageText = t('feedback.running.stage.scan');
    } else if (stage === 'processing_variations') {
      stageText = t('feedback.running.stage.variations', {
        done: variationDone,
        total: variationTotal
      });
    } else if (stage === 'downloading_images') {
      stageText = t('feedback.running.stage.images');
    }

    runFeedbackEl.className = 'run-feedback run-feedback--running';
    runFeedbackEl.innerHTML = `
      <strong>${escapeHtml(t('feedback.running.title'))}</strong>
      <p>${escapeHtml(stageText)}</p>
      <p>${escapeHtml(t('feedback.running.body', { discovered, processed, images }))}</p>
    `;
    runFeedbackEl.hidden = false;
    return;
  }

  if (feedbackModel.type === 'success') {
    const details = [
      `${t('result.products')}: ${feedbackModel.products || 0}`,
      `${t('result.imagesDownloaded')}: ${feedbackModel.images || 0}`,
      `${t('result.importCsv')}: ${feedbackModel.importCsv || 'n/a'}`,
      `${t('result.metadataJson')}: ${feedbackModel.metadataJson || 'n/a'}`
    ];

    runFeedbackEl.className = 'run-feedback run-feedback--success';
    runFeedbackEl.innerHTML = `
      <strong>${escapeHtml(t('feedback.success.title'))}</strong>
      <p>${escapeHtml(t('feedback.success.body'))}</p>
      <ul>${details.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    `;
    runFeedbackEl.hidden = false;
    return;
  }

  if (feedbackModel.type === 'failed') {
    const message = feedbackModel.error || t('status.unknownError');
    runFeedbackEl.className = 'run-feedback run-feedback--failed';
    runFeedbackEl.innerHTML = `
      <strong>${escapeHtml(t('feedback.failed.title'))}</strong>
      <p>${escapeHtml(`${t('feedback.failed.body')} ${message}`)}</p>
    `;
    runFeedbackEl.hidden = false;
  }
}

function rerenderStatus() {
  if (currentStatus.raw) {
    statusEl.textContent = currentStatus.raw;
    statusEl.className = `status status--${currentStatus.mode}`;
    return;
  }

  setStatusKey(currentStatus.key || 'status.idle', currentStatus.mode || 'idle', currentStatus.params);
}

function applyTranslations() {
  document.documentElement.lang = currentLanguage;
  document.title = t('page.title');

  const textNodes = document.querySelectorAll('[data-i18n]');
  for (const node of textNodes) {
    node.textContent = t(node.dataset.i18n);
  }

  const placeholderNodes = document.querySelectorAll('[data-i18n-placeholder]');
  for (const node of placeholderNodes) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }

  startBtn.textContent = isJobRunning ? t('form.submitRunning') : t('form.submit');
  metrics.csv.textContent = csvGenerated ? t('flag.yes') : t('flag.no');

  rerenderStatus();
  renderFeedback();
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!outputDirInput.value && payload?.defaultOutputDir) {
      outputDirInput.value = payload.defaultOutputDir;
    }

    if (engineSelect && payload?.supportedEngines && Array.isArray(payload.supportedEngines)) {
      const supported = new Set(payload.supportedEngines.map((item) => String(item)));
      for (const option of [...engineSelect.options]) {
        option.hidden = !supported.has(option.value);
      }
    }

    if (engineSelect && payload?.defaultEngine && !engineSelect.value) {
      engineSelect.value = payload.defaultEngine;
    }
  } catch {
    // Ignore config load issues.
  }
}

function renderMetrics(job) {
  metrics.productsFound.textContent = job.progress?.productsDiscovered ?? 0;
  metrics.productsProcessed.textContent = job.progress?.productsProcessed ?? 0;
  metrics.imagesDownloaded.textContent = job.progress?.imagesDownloaded ?? 0;
  csvGenerated = Boolean(job.progress?.csvGenerated);
  metrics.csv.textContent = csvGenerated ? t('flag.yes') : t('flag.no');
}

function appendLogs(logs) {
  if (!Array.isArray(logs)) {
    return;
  }

  const nextLogs = logs.slice(knownLogCount);
  if (nextLogs.length === 0) {
    return;
  }

  const text = nextLogs.map((entry) => `[${entry.at}] ${entry.message}`).join('\n');
  logsEl.textContent = logsEl.textContent ? `${logsEl.textContent}\n${text}` : text;
  logsEl.scrollTop = logsEl.scrollHeight;
  knownLogCount = logs.length;
}

function clearUI() {
  knownLogCount = 0;
  logsEl.textContent = '';
  resultEl.textContent = '';
  metrics.productsFound.textContent = '0';
  metrics.productsProcessed.textContent = '0';
  metrics.imagesDownloaded.textContent = '0';
  csvGenerated = false;
  metrics.csv.textContent = t('flag.no');
  setFeedbackModel(null);
}

async function fetchJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(t('error.readJob'));
  }

  return response.json();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(jobId) {
  stopPolling();

  pollTimer = setInterval(async () => {
    try {
      const job = await fetchJob(jobId);
      renderMetrics(job);
      appendLogs(job.logs);
      setFeedbackModel({
        type: 'running',
        stage: job.progress?.stage || 'running',
        discovered: job.progress?.productsDiscovered ?? 0,
        processed: job.progress?.productsProcessed ?? 0,
        images: job.progress?.imagesDownloaded ?? 0,
        variationDone: job.progress?.variationProductsProcessed ?? 0,
        variationTotal: job.progress?.variationProductsTotal ?? 0
      });

      if (job.status === 'finished') {
        setStatusKey('status.success', 'success');
        setStartButtonRunningState(false);

        const outputDir = job.result?.outputDir || 'n/a';
        const importCsv = job.result?.files?.importCsv || 'n/a';
        const metadataJson = job.result?.files?.metadataJson || 'n/a';
        const sum = job.result?.summary || {};
        const engine = job.input?.engine || 'node';
        const productsProcessed = sum.productsProcessed || 0;
        const imagesDownloaded = sum.imagesDownloaded || 0;

        resultEl.innerHTML = `
          <strong>${t('result.outputDir')}:</strong> ${outputDir}<br>
          <strong>${t('result.engine')}:</strong> ${engine}<br>
          <strong>${t('result.products')}:</strong> ${productsProcessed}<br>
          <strong>${t('result.imagesDownloaded')}:</strong> ${imagesDownloaded}<br>
          <strong>${t('result.importCsv')}:</strong> ${importCsv}<br>
          <strong>${t('result.metadataJson')}:</strong> ${metadataJson}
        `;
        setFeedbackModel({
          type: 'success',
          products: productsProcessed,
          images: imagesDownloaded,
          importCsv,
          metadataJson
        });
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        stopPolling();
      }

      if (job.status === 'failed') {
        const errorMessage = job.error || t('status.unknownError');
        setStatusRaw(
          `${t('status.failedPrefix')}: ${errorMessage}`,
          'failed'
        );
        setStartButtonRunningState(false);
        setFeedbackModel({
          type: 'failed',
          error: errorMessage
        });
        stopPolling();
      }
    } catch (error) {
      setStatusRaw(`${t('status.updateErrorPrefix')}: ${error.message}`, 'failed');
      setStartButtonRunningState(false);
      setFeedbackModel({
        type: 'failed',
        error: error.message
      });
      stopPolling();
    }
  }, 1500);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  clearUI();
  setStartButtonRunningState(true);
  setStatusKey('status.starting', 'running');
  setFeedbackModel({
    type: 'running',
    stage: 'scanning_products',
    discovered: 0,
    processed: 0,
    images: 0,
    variationDone: 0,
    variationTotal: 0
  });

  const body = {
    url: document.getElementById('target-url').value.trim(),
    maxProducts: Number(document.getElementById('max-products').value || 0),
    outputDir: outputDirInput.value.trim(),
    engine: engineSelect?.value || 'node'
  };

  try {
    const response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || t('error.startJob'));
    }

    setStatusKey('status.jobRunning', 'running', { jobId: payload.jobId });
    startPolling(payload.jobId);
  } catch (error) {
    setStatusRaw(error.message, 'failed');
    setStartButtonRunningState(false);
    setFeedbackModel({
      type: 'failed',
      error: error.message
    });
  }
});

if (!translations[currentLanguage]) {
  currentLanguage = 'en';
}

if (languageSelect) {
  languageSelect.value = currentLanguage;
  languageSelect.addEventListener('change', (event) => {
    currentLanguage = event.target.value;
    localStorage.setItem('wooExportLanguage', currentLanguage);
    applyTranslations();
  });
}

applyTranslations();
loadConfig();
