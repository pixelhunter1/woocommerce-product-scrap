const form = document.getElementById('scrape-form');
const startBtn = document.getElementById('start-btn');
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');
const resultEl = document.getElementById('result');
const outputDirInput = document.getElementById('output-dir');

const metrics = {
  productsFound: document.getElementById('m-products-found'),
  productsProcessed: document.getElementById('m-products-processed'),
  imagesDownloaded: document.getElementById('m-images-downloaded'),
  csv: document.getElementById('m-csv')
};

let pollTimer = null;
let knownLogCount = 0;

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

function setStatus(text, mode) {
  statusEl.textContent = text;
  statusEl.className = `status status--${mode}`;
}

function renderMetrics(job) {
  metrics.productsFound.textContent = job.progress?.productsDiscovered ?? 0;
  metrics.productsProcessed.textContent = job.progress?.productsProcessed ?? 0;
  metrics.imagesDownloaded.textContent = job.progress?.imagesDownloaded ?? 0;
  metrics.csv.textContent = job.progress?.csvGenerated ? 'SIM' : 'NAO';
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
  metrics.csv.textContent = 'NAO';
}

async function fetchJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error('Nao foi possivel ler o estado do job.');
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

      if (job.status === 'finished') {
        setStatus('Concluido com sucesso.', 'success');
        startBtn.disabled = false;

        const outputDir = job.result?.outputDir || 'n/a';
        const importCsv = job.result?.files?.importCsv || 'n/a';
        const metadataJson = job.result?.files?.metadataJson || 'n/a';
        const sum = job.result?.summary || {};

        resultEl.innerHTML = `
          <strong>Pasta de saida:</strong> ${outputDir}<br>
          <strong>Produtos:</strong> ${sum.productsProcessed || 0}<br>
          <strong>Imagens baixadas:</strong> ${sum.imagesDownloaded || 0}<br>
          <strong>CSV para import:</strong> ${importCsv}<br>
          <strong>JSON metadata:</strong> ${metadataJson}
        `;

        stopPolling();
      }

      if (job.status === 'failed') {
        setStatus(`Falhou: ${job.error || 'erro desconhecido'}`, 'failed');
        startBtn.disabled = false;
        stopPolling();
      }
    } catch (error) {
      setStatus(`Erro de atualizacao: ${error.message}`, 'failed');
      startBtn.disabled = false;
      stopPolling();
    }
  }, 1500);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  clearUI();
  startBtn.disabled = true;
  setStatus('A iniciar export WooCommerce...', 'running');

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
      throw new Error(payload.error || 'Nao foi possivel iniciar o job.');
    }

    setStatus(`Job ${payload.jobId} em execucao...`, 'running');
    startPolling(payload.jobId);
  } catch (error) {
    setStatus(error.message, 'failed');
    startBtn.disabled = false;
  }
});

loadConfig();
