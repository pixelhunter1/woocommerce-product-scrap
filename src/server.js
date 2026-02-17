const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { runScrapeJob } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3100;
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'woo-exports');

const jobs = new Map();

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

function createJob(url, maxProducts, outputDir) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const job = {
    id,
    input: { url, maxProducts, outputDir },
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    logs: [],
    progress: {
      productsDiscovered: 0,
      productsProcessed: 0,
      imagesDownloaded: 0,
      imagesSkipped: 0,
      csvGenerated: 0
    },
    result: null,
    error: null
  };

  jobs.set(id, job);
  return job;
}

function appendLog(job, message) {
  job.logs.push({ at: new Date().toISOString(), message });
  if (job.logs.length > 400) {
    job.logs.shift();
  }
}

function runJob(job) {
  job.status = 'running';
  job.updatedAt = new Date().toISOString();

  runScrapeJob(job.input, (event) => {
    if (event.type === 'log') {
      appendLog(job, event.message);
    }

    if (event.type === 'progress' && event.patch) {
      job.progress = { ...job.progress, ...event.patch };
    }

    job.updatedAt = new Date().toISOString();
  })
    .then((result) => {
      job.status = 'finished';
      job.result = result;
      job.updatedAt = new Date().toISOString();
      appendLog(job, 'Job finalizado com sucesso.');
    })
    .catch((error) => {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      appendLog(job, `Erro fatal: ${error.message}`);
    });
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.post('/api/scrape', (req, res) => {
  const { url, maxProducts, outputDir } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Informe uma URL válida.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'URL inválida.' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'A URL deve usar http:// ou https://.' });
  }

  const productLimit = Number.isFinite(Number(maxProducts))
    ? Math.min(10000, Math.max(0, Number(maxProducts)))
    : 0;
  const finalOutputDir = normalizeOutputDir(outputDir);

  const job = createJob(parsed.href, productLimit, finalOutputDir);
  appendLog(job, `Job WooCommerce criado para ${parsed.href}`);
  appendLog(job, `Pasta de saída: ${finalOutputDir}`);

  setTimeout(() => runJob(job), 0);

  return res.status(202).json({
    message: 'Job iniciado.',
    jobId: job.id
  });
});

app.get('/api/config', (_req, res) => {
  return res.json({
    defaultOutputDir: DEFAULT_OUTPUT_DIR
  });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado.' });
  }

  return res.json(job);
});

app.get('/api/jobs', (_req, res) => {
  const list = [...jobs.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 25)
    .map((job) => ({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      input: job.input,
      progress: job.progress
    }));

  return res.json({ jobs: list });
});

app.use((_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor pronto em http://localhost:${PORT}`);
});
