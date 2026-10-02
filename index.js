import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

function loadEnv() {
  const p = path.join(__dirname, '.env');

  if (!fs.existsSync(p)) return;

  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;

    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnv();

const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
};

const securityHeaders = (res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'camera=(),geolocation=(),payment=()'
  );
};

const readBody = (req, max = 2 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > max) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));

    req.on('error', reject);
  });

function safeMath(input) {
  const s = input.replace(/,/g, '').trim();

  if (
    s.length > 120 ||
    !/^[0-9+\-*/%().\s^]+$/.test(s) ||
    !/[0-9]/.test(s)
  ) {
    return null;
  }

  try {
    const result = Function(
      `"use strict";return (${s.replace(/\^/g, '**')})`
    )();

    return typeof result === 'number' && Number.isFinite(result)
      ? String(result)
      : null;
  } catch {
    return null;
  }
}

function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.AI_MODEL);
}

function systemPrompt(memory = []) {
  const memories = memory.length
    ? `\nUseful memories supplied by the user:\n- ${memory
        .slice(-30)
        .join('\n- ')}`
    : '';

  return `You are FRED, a helpful personal AI assistant.

Address the owner naturally as "Master Crownstarlin" when appropriate.

Be accurate, concise, friendly and transparent.

Never claim an Android action happened unless the app confirms it.

You can help with conversation, writing, reasoning, mathematics, coding, translation and supported image/document analysis.${memories}`;
}

async function callAI(messages) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured in Render.');
  }

  if (!process.env.AI_MODEL) {
    throw new Error('AI_MODEL is not configured in Render.');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },

    body: JSON.stringify({
      model: process.env.AI_MODEL,
      input: messages
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `OpenAI API returned HTTP ${response.status}`;

    throw new Error(message);
  }

  return (
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    'I received an empty response.'
  );
}

async function api(req, res, url) {
  securityHeaders(res);

  if (
    req.method === 'GET' &&
    (url.pathname === '/api/health' ||
      url.pathname === '/api/healthz')
  ) {
    return json(res, 200, {
      ok: true,
      status: 'healthy',
      version: '4.0.0',
      aiConfigured: aiConfigured(),
      time: new Date().toISOString()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/ready') {
    return json(res, aiConfigured() ? 200 : 503, {
      ok: aiConfigured(),
      status: aiConfigured() ? 'ready' : 'not_ready',
      aiConfigured: aiConfigured()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return json(res, 200, {
      version: '4.0.0',
      features: {
        chat: true,
        memory: true,
        math: true,
        voice: true,
        imageUpload: true,
        androidActions: true,
        agentTasks: true,
        visionReady: true,
        webReady: true,
        pwa: true
      },
      aiConfigured: aiConfigured()
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = JSON.parse(
        (await readBody(req)).toString
