import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

/* -------------------------------------------------------
   OPTIONAL LOCAL .env LOADER
------------------------------------------------------- */

function loadEnv() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
    );

    if (!match) continue;

    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, "");

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnv();

/* -------------------------------------------------------
   RESPONSE HELPERS
------------------------------------------------------- */

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");

  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=()"
  );
}

/* -------------------------------------------------------
   REQUEST BODY
------------------------------------------------------- */

function readBody(req, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    req.on("data", (chunk) => {
      if (finished) return;

      size += chunk.length;

      if (size > max) {
        finished = true;
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (finished) return;

      finished = true;
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (error) => {
      if (finished) return;

      finished = true;
      reject(error);
    });
  });
}

/* -------------------------------------------------------
   SIMPLE MATH ENGINE
------------------------------------------------------- */

function safeMath(input) {
  if (typeof input !== "string") return null;

  const expression = input.replace(/,/g, "").trim();

  if (expression.length > 120) return null;

  if (!/^[0-9+\-*/%().\s^]+$/.test(expression)) {
    return null;
  }

  if (!/[0-9]/.test(expression)) {
    return null;
  }

  try {
    const result = Function(
      `"use strict"; return (${expression.replace(/\^/g, "**")})`
    )();

    if (
      typeof result === "number" &&
      Number.isFinite(result)
    ) {
      return String(result);
    }

    return null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------
   AI CONFIGURATION
------------------------------------------------------- */

function aiConfigured() {
  return Boolean(
    process.env.OPENAI_API_KEY &&
    process.env.AI_MODEL
  );
}

/* -------------------------------------------------------
   FRED SYSTEM PROMPT
------------------------------------------------------- */

function systemPrompt(memory = []) {
  const memories =
    Array.isArray(memory) && memory.length
      ? `

Useful memories supplied by the user:
- ${memory.slice(-30).join("\n- ")}`
      : "";

  return `You are FRED, a helpful personal AI assistant.

The owner may be addressed naturally as "Master Crownstarlin" when appropriate.

Be accurate, concise, friendly and transparent.

Do not claim that a phone action happened unless the application confirms that it happened.

You can help with:
- conversation
- writing
- reasoning
- mathematics
- coding
- translation
- explanations
- research when available
- supported image and document analysis

If you do not know something, say so instead of inventing information.

${memories}`;
}

/* -------------------------------------------------------
   OPENAI RESPONSES API
------------------------------------------------------- */

async function callAI(messages) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured in Render."
    );
  }

  if (!process.env.AI_MODEL) {
    throw new Error(
      "AI_MODEL is not configured in Render."
    );
  }

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },

      body: JSON.stringify({
        model: process.env.AI_MODEL,
        input: messages
      })
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `OpenAI returned an invalid response (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `OpenAI API returned HTTP ${response.status}.`;

    throw new Error(message);
  }

  if (data?.output_text) {
    return data.output_text;
  }

  const output = Array.isArray(data?.output)
    ? data.output
    : [];

  for (const item of output) {
    const content = Array.isArray(item?.content)
      ? item.content
      : [];

    for (const part of content) {
      if (
        typeof part?.text === "string" &&
        part.text.trim()
      ) {
        return part.text;
      }
    }
  }

  return "I received an empty response from the AI service.";
}

/* -------------------------------------------------------
   JSON BODY PARSER
------------------------------------------------------- */

async function readJson(req) {
  const body = (await readBody(req)).toString("utf8");

  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON request.");
  }
}

/* -------------------------------------------------------
   CHAT HANDLER
------------------------------------------------------- */

async function handleChat(req, res) {
  let body;

  try {
    body = await readJson(req);
  } catch (error) {
    return json(res, 400, {
      ok: false,
      error: error.message
    });
  }

  const message =
    typeof body.message === "string"
      ? body.message.trim()
      : "";

  const history =
    Array.isArray(body.history)
      ? body.history
      : [];

  const memory =
    Array.isArray(body.memory)
      ? body.memory
      : [];

  if (!message) {
    return json(res, 400, {
      ok: false,
      error: "Message is required."
    });
  }

  /* Local math shortcut */

  const mathResult = safeMath(message);

  if (
    mathResult !== null &&
    /^[0-9+\-*/%().\s^,]+$/.test(message)
  ) {
    return json(res, 200, {
      ok: true,
      reply: mathResult,
      source: "local-math"
    });
  }

  if (!aiConfigured()) {
    return json(res, 503, {
      ok: false,
      error:
        "FRED AI is not configured. Add OPENAI_API_KEY and AI_MODEL to the Render environment variables."
    });
  }

  const messages = [
    {
      role: "developer",
      content: systemPrompt(memory)
    }
  ];

  for (const item of history.slice(-20)) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const role =
      item.role === "assistant"
        ? "assistant"
        : "user";

    const content =
      typeof item.content === "string"
        ? item.content
        : "";

    if (!content.trim()) continue;

    messages.push({
      role,
      content
    });
  }

  messages.push({
    role: "user",
    content: message
  });

  try {
    const reply = await callAI(messages);

    return json(res, 200, {
      ok: true,
      reply,
      source: "openai"
    });
  } catch (error) {
    console.error("FRED AI ERROR:", error);

    return json(res, 502, {
      ok: false,
      error:
        error?.message ||
        "The AI service could not be reached."
    });
  }
}

/* -------------------------------------------------------
   API ROUTES
------------------------------------------------------- */

async function handleApi(req, res, pathname) {
  if (pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      service: "FRED V4",
      status: "online",
      aiConfigured: aiConfigured()
    });
  }

  if (pathname === "/api/healthz") {
    return json(res, 200, {
      ok: true
    });
  }

  if (pathname === "/api/ready") {
    return json(res, 200, {
      ok: true,
      ready: aiConfigured()
    });
  }

  if (pathname === "/api/config") {
    return json(res, 200, {
      ok: true,
      aiConfigured: aiConfigured(),
      modelConfigured: Boolean(process.env.AI_MODEL)
    });
  }

  if (
    pathname === "/api/chat" &&
    req.method === "POST"
  ) {
    return handleChat(req, res);
  }

  if (
    pathname === "/api/upload" &&
    req.method === "POST"
  ) {
    return json(res, 200, {
      ok: true,
      message:
        "Upload endpoint is ready. Advanced file processing will be connected here."
    });
  }

  if (
    pathname === "/api/action" &&
    req.method === "POST"
  ) {
    let body;

    try {
      body = await readJson(req);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: error.message
      });
    }

    return json(res, 200, {
      ok: true,
      action: body?.action || null,
      message:
        "Action received. The Android app must confirm the device action."
    });
  }

  return json(res, 404, {
    ok: false,
    error: "API route not found."
  });
}

/* -------------------------------------------------------
   STATIC FILE SERVER
------------------------------------------------------- */

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"
  };

  return types[ext] || "application/octet-stream";
}

function serveStatic(req, res, pathname) {
  let requested = pathname;

  if (requested === "/") {
    requested = "/index.html";
  }

  let filePath = path.normalize(
    path.join(PUBLIC, requested)
  );

  /* Prevent path traversal */

  if (!filePath.startsWith(PUBLIC)) {
    return json(res, 403, {
      ok: false,
      error: "Forbidden."
    });
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    return json(res, 500, {
      ok: false,
      error: "FRED frontend index.html was not found."
    });
  }

  try {
    const stat = fs.statSync(filePath);

    if (!stat.isFile()) {
      return json(res, 404, {
        ok: false,
        error: "File not found."
      });
    }

    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control":
        pathname === "/"
          ? "no-cache"
          : "public, max-age=3600"
    });

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("STATIC FILE ERROR:", error);

    json(res, 500, {
      ok: false,
      error: "Unable to serve the requested file."
    });
  }
}

/* -------------------------------------------------------
   MAIN SERVER
------------------------------------------------------- */

const server = http.createServer(
  async (req, res) => {
    securityHeaders(res);

    try {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );

      const pathname = url.pathname;

      if (pathname.startsWith("/api/")) {
        await handleApi(req, res, pathname);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return json(res, 405, {
          ok: false,
          error: "Method not allowed."
        });
      }

      serveStatic(req, res, pathname);
    } catch (error) {
      console.error("SERVER ERROR:", error);

      if (!res.headersSent) {
        json(res, 500, {
          ok: false,
          error:
            error?.message ||
            "Internal server error."
        });
      }
    }
  }
);

/* -------------------------------------------------------
   START FRED
------------------------------------------------------- */

server.listen(PORT, HOST, () => {
  console.log(
    `FRED V4 running on http://${HOST}:${PORT}`
  );

  console.log(
    `Frontend directory: ${PUBLIC}`
  );

  console.log(
    `AI configured: ${aiConfigured()}`
  );

  if (process.env.AI_MODEL) {
    console.log(
      `AI model configured: ${process.env.AI_MODEL}`
    );
  }
});

/* -------------------------------------------------------
   GRACEFUL SHUTDOWN
------------------------------------------------------- */

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down FRED...`);

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
