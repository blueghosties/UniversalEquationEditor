const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 4321);
const envSources = {};

loadEnv(path.join(root, '.env'));

const providerDefaults = {
  openai: process.env.OPENAI_MODEL || 'gpt-5-mini',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  gemini: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  deepseek: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
};

const providerKeys = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY'
};

const coachSystemPrompt = [
  'You are Equation Coach, a patient maths and physics tutor embedded in a LaTeX equation editor.',
  'Help the learner understand the current equation, spot LaTeX mistakes, and learn the concepts.',
  'Prefer hints and explanations before final answers. Keep the tone warm, clear, and encouraging.',
  'Wrap inline equations in \\(...\\) and display equations in \\[...\\] so the editor can render them visually.',
  'When checking LaTeX, give corrected LaTeX in a fenced latex block when useful.',
  'When solving, show steps compactly and mention assumptions.'
].join(' ');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    envSources[key] = '.env';
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const safePath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function buildCoachInput(body) {
  const mode = body.mode || 'explain';
  const equation = body.equation || '';
  const question = body.question || '';
  const output = body.output || '';

  return [
    `Mode: ${mode}`,
    `Current LaTeX equation:\n${equation || '(empty)'}`,
    `Current formatted output:\n${output || '(not provided)'}`,
    `Learner request:\n${question || '(no extra question)'}`,
    'Respond as a helpful tutor. Use Markdown. Do not mention API details.'
  ].join('\n\n');
}

function getApiKey(provider) {
  const envName = providerKeys[provider];
  return envName ? process.env[envName] : '';
}

function providerStatus() {
  return Object.fromEntries(
    Object.entries(providerKeys).map(([provider, envName]) => [
      provider,
      {
        configured: Boolean(process.env[envName]),
        envName,
        source: process.env[envName] ? envSources[envName] || 'environment' : '',
        defaultModel: providerDefaults[provider]
      }
    ])
  );
}

function providerError(provider, message) {
  const lower = String(message || '').toLowerCase();
  const envName = providerKeys[provider];
  const source = process.env[envName] ? envSources[envName] || 'environment' : '';

  if (lower.includes('invalid') && lower.includes('x-api-key')) {
    return `Claude rejected ANTHROPIC_API_KEY from ${source}. Add a fresh key to this project's .env file, then restart node server.js.`;
  }

  if (lower.includes('invalid') && lower.includes('api key')) {
    return `${providerLabel(provider)} rejected ${envName} from ${source}. Add a fresh key to this project's .env file, then restart node server.js.`;
  }

  if (lower.includes('unauthorized') || lower.includes('authentication') || lower.includes('auth')) {
    return `${providerLabel(provider)} could not authenticate ${envName} from ${source}. Check the key in .env, then restart node server.js.`;
  }

  return message || `${providerLabel(provider)} request failed`;
}

function providerLabel(provider) {
  return {
    openai: 'GPT',
    anthropic: 'Claude',
    gemini: 'Gemini',
    deepseek: 'DeepSeek'
  }[provider] || provider;
}

async function callOpenAI({ model, input }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: coachSystemPrompt },
        { role: 'user', content: input }
      ],
      max_output_tokens: 1200
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI request failed');
  return data.output_text || extractResponseText(data.output) || '';
}

async function callAnthropic({ model, input }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: coachSystemPrompt,
      messages: [{ role: 'user', content: input }]
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Anthropic request failed');
  return (data.content || []).map(part => part.text || '').join('\n').trim();
}

async function callGemini({ model, input }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: coachSystemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: input }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 1200
      }
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini request failed');
  return (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('\n').trim();
}

async function callDeepSeek({ model, input }) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: coachSystemPrompt },
        { role: 'user', content: input }
      ],
      max_tokens: 1200,
      temperature: 0.3
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'DeepSeek request failed');
  return data.choices?.[0]?.message?.content || '';
}

function extractResponseText(output) {
  if (!Array.isArray(output)) return '';
  return output.flatMap(item => item.content || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
}

async function handleCoach(req, res) {
  try {
    const body = await readJson(req);
    const provider = String(body.provider || 'openai').toLowerCase();
    const model = String(body.model || providerDefaults[provider] || '').trim();
    const key = getApiKey(provider);

    if (!providerDefaults[provider]) {
      sendJson(res, 400, { error: 'Unknown provider' });
      return;
    }

    if (!key) {
      sendJson(res, 400, {
        error: `Missing ${providerKeys[provider]}. Add it to .env and restart the local server.`
      });
      return;
    }

    if (!model) {
      sendJson(res, 400, { error: 'Missing model name' });
      return;
    }

    const input = buildCoachInput(body);
    const callers = {
      openai: callOpenAI,
      anthropic: callAnthropic,
      gemini: callGemini,
      deepseek: callDeepSeek
    };
    try {
      const answer = await callers[provider]({ model, input });
      sendJson(res, 200, { answer, provider, model });
    } catch (error) {
      sendJson(res, 502, { error: providerError(provider, error.message) });
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'AI coach request failed' });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/status')) {
    sendJson(res, 200, {
      ok: true,
      providers: providerStatus()
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/coach')) {
    handleCoach(req, res);
    return;
  }

  serveStatic(req, res);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. The editor may already be running at http://localhost:${port}`);
    console.error(`Stop the old server or run this one on another port, for example: PORT=4322 node server.js`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`Universal Equation Editor running at http://localhost:${port}`);
});
