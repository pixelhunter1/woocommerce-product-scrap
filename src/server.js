const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const express = require('express');
const { runScrapeJob } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3100;
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'woo-exports');
const PYTHON_COMMAND = process.env.PYTHON_SCRAPER_CMD || 'python3';
const PYTHON_SCRIPT = path.join(__dirname, 'python_scraper.py');
const SUPPORTED_ENGINES = ['node', 'python'];

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
    input: { url, maxProducts, outputDir, engine: resolveEngine(null) },
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    logs: [],
    progress: {
      stage: 'queued',
      productsDiscovered: 0,
      productsProcessed: 0,
      imagesDownloaded: 0,
      imagesSkipped: 0,
      csvGenerated: 0,
      variationProductsTotal: 0,
      variationProductsProcessed: 0
    },
    result: null,
    error: null
  };

  jobs.set(id, job);
  return job;
}

function resolveEngine(engine) {
  if (typeof engine !== 'string') {
    return 'node';
  }

  const normalized = engine.trim().toLowerCase();
  return SUPPORTED_ENGINES.includes(normalized) ? normalized : 'node';
}

function parsePythonEvent(line, onEvent) {
  const raw = String(line || '').trim();
  if (!raw) {
    return null;
  }

  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    onEvent({ type: 'log', message: `[python] ${raw}` });
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.type === 'log' && payload.message) {
    onEvent({ type: 'log', message: `[python] ${payload.message}` });
    return null;
  }

  if (payload.type === 'progress' && payload.patch && typeof payload.patch === 'object') {
    onEvent({ type: 'progress', patch: payload.patch });
    return null;
  }

  if (payload.type === 'error' && payload.message) {
    onEvent({ type: 'log', message: `[python] ERROR: ${payload.message}` });
    return null;
  }

  if (payload.type === 'result' && payload.result && typeof payload.result === 'object') {
    return payload.result;
  }

  return null;
}

function runPythonScrapeJob(input, onEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_COMMAND, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let result = null;
    let stderrText = '';

    const stdoutReader = readline.createInterface({ input: child.stdout });
    const stderrReader = readline.createInterface({ input: child.stderr });

    stdoutReader.on('line', (line) => {
      const parsedResult = parsePythonEvent(line, onEvent);
      if (parsedResult) {
        result = parsedResult;
      }
    });

    stderrReader.on('line', (line) => {
      const text = String(line || '').trim();
      if (!text) {
        return;
      }

      stderrText += `${text}\n`;
      onEvent({ type: 'log', message: `[python:stderr] ${text}` });
    });

    child.on('error', (error) => {
      reject(
        new Error(`Unable to start Python scraper using "${PYTHON_COMMAND}": ${error.message}`)
      );
    });

    child.on('close', (code) => {
      stdoutReader.close();
      stderrReader.close();

      if (code === 0 && result) {
        resolve(result);
        return;
      }

      if (code === 0) {
        reject(new Error('Python scraper finished without returning a result payload.'));
        return;
      }

      const trimmed = stderrText.trim();
      const details = trimmed ? ` ${trimmed}` : '';
      reject(new Error(`Python scraper failed with exit code ${code}.${details}`));
    });

    try {
      child.stdin.write(
        JSON.stringify({
          url: input.url,
          maxProducts: input.maxProducts,
          outputDir: input.outputDir
        })
      );
      child.stdin.end();
    } catch (error) {
      reject(new Error(`Failed to send input to Python scraper: ${error.message}`));
    }
  });
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

  const runner = job.input.engine === 'python' ? runPythonScrapeJob : runScrapeJob;

  runner(job.input, (event) => {
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
  const { url, maxProducts, outputDir, engine } = req.body || {};

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
  const selectedEngine = resolveEngine(engine);

  const job = createJob(parsed.href, productLimit, finalOutputDir);
  job.input.engine = selectedEngine;
  appendLog(job, `Job WooCommerce criado para ${parsed.href}`);
  appendLog(job, `Engine: ${selectedEngine}`);
  appendLog(job, `Pasta de saída: ${finalOutputDir}`);

  setTimeout(() => runJob(job), 0);

  return res.status(202).json({
    message: 'Job iniciado.',
    jobId: job.id
  });
});

app.get('/api/config', (_req, res) => {
  return res.json({
    defaultOutputDir: DEFAULT_OUTPUT_DIR,
    defaultEngine: 'node',
    supportedEngines: SUPPORTED_ENGINES
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
