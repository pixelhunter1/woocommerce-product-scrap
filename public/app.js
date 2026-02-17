const form = document.getElementById('scrape-form');
const startBtn = document.getElementById('start-btn');
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');
const resultEl = document.getElementById('result');
const outputDirInput = document.getElementById('output-dir');
const languageSelect = document.getElementById('language-select');
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
    'result.products': 'Products',
    'result.imagesDownloaded': 'Images downloaded',
    'result.importCsv': 'Import CSV',
    'result.metadataJson': 'Metadata JSON',
    'feedback.running.title': 'Export in progress',
    'feedback.running.body':
      'Processing {processed}/{discovered} products. Images downloaded: {images}.',
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
    'result.products': 'Produits',
    'result.imagesDownloaded': 'Images telechargees',
    'result.importCsv': "CSV d'import",
    'result.metadataJson': 'JSON metadata',
    'feedback.running.title': 'Export en cours',
    'feedback.running.body':
      'Traitement {processed}/{discovered} produits. Images telechargees: {images}.',
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
    'result.products': 'Productos',
    'result.imagesDownloaded': 'Imagenes descargadas',
    'result.importCsv': 'CSV de importacion',
    'result.metadataJson': 'JSON metadata',
    'feedback.running.title': 'Exportacion en progreso',
    'feedback.running.body':
      'Procesando {processed}/{discovered} productos. Imagenes descargadas: {images}.',
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
    runFeedbackEl.className = 'run-feedback run-feedback--running';
    runFeedbackEl.innerHTML = `
      <strong>${escapeHtml(t('feedback.running.title'))}</strong>
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
        discovered: job.progress?.productsDiscovered ?? 0,
        processed: job.progress?.productsProcessed ?? 0,
        images: job.progress?.imagesDownloaded ?? 0
      });

      if (job.status === 'finished') {
        setStatusKey('status.success', 'success');
        setStartButtonRunningState(false);

        const outputDir = job.result?.outputDir || 'n/a';
        const importCsv = job.result?.files?.importCsv || 'n/a';
        const metadataJson = job.result?.files?.metadataJson || 'n/a';
        const sum = job.result?.summary || {};
        const productsProcessed = sum.productsProcessed || 0;
        const imagesDownloaded = sum.imagesDownloaded || 0;

        resultEl.innerHTML = `
          <strong>${t('result.outputDir')}:</strong> ${outputDir}<br>
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
    discovered: 0,
    processed: 0,
    images: 0
  });

  const body = {
    url: document.getElementById('target-url').value.trim(),
    maxProducts: Number(document.getElementById('max-products').value || 0),
    outputDir: outputDirInput.value.trim()
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
