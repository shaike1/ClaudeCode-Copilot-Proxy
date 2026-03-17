/**
 * Claude Max API Direct Client
 *
 * Replaces the subprocess-per-request approach with direct Anthropic SDK calls
 * using the OAuth token from Claude Code's credentials file.
 * This reduces latency from ~25s to ~1s per request.
 */
import { createRequire } from "module";
import { EventEmitter } from "events";
import { readFileSync, writeFileSync } from "fs";
import { spawn } from "child_process";

const require = createRequire(import.meta.url);

const CREDENTIALS_PATH = (process.env.HOME || "/root") + "/.claude/.credentials.json";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_REFRESH_MARGIN_MS = 30 * 60 * 1000; // Refresh 30 min before expiry

// Model name mapping: short/display name -> full API model ID
const MODEL_ID_MAP = {
    // Short aliases (legacy CLI mode)
    "opus": "claude-opus-4-20250514",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-haiku-4-5-20251001",
    // Base model names -> API IDs (dash variants)
    "claude-opus-4": "claude-opus-4-20250514",
    "claude-opus-4-5": "claude-opus-4-5-20251101",
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-sonnet-4": "claude-sonnet-4-20250514",
    "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-haiku-4": "claude-haiku-4-5-20251001",
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    // Dot variants (Openclaw sends these)
    "claude-opus-4.5": "claude-opus-4-5-20251101",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-haiku-4.5": "claude-haiku-4-5-20251001",
};

// Cached Anthropic client
let _client = null;
let _cachedToken = null;
let _tokenExpiresAt = 0;

// Track refresh state to prevent concurrent refreshes
let _refreshPromise = null;

/**
 * Load OAuth credentials from Claude Code's credentials file
 */
function loadCredentials() {
    const data = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
    const oauth = data.claudeAiOauth;
    if (!oauth || !oauth.accessToken) {
        throw new Error("No OAuth credentials found. Run: claude auth login");
    }
    return oauth;
}

/**
 * Refresh the OAuth token using the refresh_token grant and persist to credentials file.
 * Returns the new access token.
 */
async function refreshOAuthToken(refreshToken) {
    console.log("[TokenRefresh] Refreshing OAuth token...");
    const params = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
    });

    const resp = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Token refresh failed (${resp.status}): ${body}`);
    }

    const data = await resp.json();
    if (!data.access_token) {
        throw new Error("Token refresh returned no access_token");
    }

    // Update credentials file so Claude Code and other consumers see the new token
    try {
        const credsFile = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
        credsFile.claudeAiOauth.accessToken = data.access_token;
        credsFile.claudeAiOauth.expiresAt = Date.now() + (data.expires_in * 1000);
        if (data.refresh_token) {
            credsFile.claudeAiOauth.refreshToken = data.refresh_token;
        }
        writeFileSync(CREDENTIALS_PATH, JSON.stringify(credsFile));
        console.log(`[TokenRefresh] Token refreshed, expires in ${Math.round(data.expires_in / 3600)}h`);
    } catch (err) {
        console.error("[TokenRefresh] Warning: could not persist token to credentials file:", err.message);
    }

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: Date.now() + (data.expires_in * 1000),
    };
}

/**
 * Ensure the token is fresh. Refresh proactively if within margin of expiry.
 */
async function ensureFreshToken() {
    const creds = loadCredentials();
    const now = Date.now();

    // If token is still fresh (more than margin before expiry), use as-is
    if (creds.expiresAt && now < creds.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return creds;
    }

    console.log(`[TokenRefresh] Token expires in ${Math.round((creds.expiresAt - now) / 60000)} min, refreshing...`);

    // Deduplicate concurrent refresh calls
    if (!_refreshPromise) {
        _refreshPromise = refreshOAuthToken(creds.refreshToken)
            .finally(() => { _refreshPromise = null; });
    }

    const newTokens = await _refreshPromise;
    return {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
        scopes: creds.scopes,
    };
}

/**
 * Find the Anthropic SDK module
 */
let _AnthropicClass = null;
function getAnthropicClass() {
    if (_AnthropicClass) return _AnthropicClass;
    const sdkPaths = [
        "/root/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/node_modules/@anthropic-ai/sdk",
        "/root/.nvm/versions/node/v22.22.0/lib/node_modules/@anthropic-ai/sdk",
    ];
    for (const p of sdkPaths) {
        try {
            const mod = require(p);
            _AnthropicClass = mod.Anthropic || mod.default;
            if (_AnthropicClass) return _AnthropicClass;
        } catch { /* try next */ }
    }
    throw new Error("@anthropic-ai/sdk not found. Install it or ensure openclaw is installed.");
}

/**
 * Get or create an Anthropic SDK client with valid OAuth token.
 * Automatically refreshes the token if nearing expiry.
 */
async function getClient() {
    const creds = await ensureFreshToken();
    const now = Date.now();

    // Rebuild client if token changed or doesn't exist
    if (!_client || _cachedToken !== creds.accessToken) {
        _cachedToken = creds.accessToken;
        _tokenExpiresAt = creds.expiresAt || (now + 3600000);

        const Anthropic = getAnthropicClass();
        _client = new Anthropic({
            authToken: _cachedToken,
            defaultHeaders: {
                "anthropic-beta": OAUTH_BETA_HEADER,
            },
        });
        console.log(`[DirectAPI] Client initialized (token expires: ${new Date(_tokenExpiresAt).toISOString()})`);
    }
    return _client;
}

// Proactive background refresh: check every 10 minutes
setInterval(() => {
    ensureFreshToken().catch(err => {
        console.error("[TokenRefresh] Background refresh failed:", err.message);
    });
}, 10 * 60 * 1000);

/**
 * Resolve model alias to full API model ID
 */
function resolveModel(model) {
    return MODEL_ID_MAP[model] || model;
}

/**
 * Drop-in replacement for ClaudeSubprocess that uses the Anthropic SDK directly.
 * Emits the same events (content_delta, assistant, result, error, close) so
 * routes.js works without changes.
 */
export class ClaudeSubprocess extends EventEmitter {
    _aborted = false;
    _abortController = null;

    /**
     * Start a direct API call (replaces subprocess spawning)
     */
    async start(prompt, options) {
        const model = resolveModel(options.model);
        const maxTokens = options.maxTokens || 8192;
        this._abortController = new AbortController();

        console.error(`[DirectAPI] Request: model=${model}, prompt=${prompt.length} chars`);
        const startTime = Date.now();

        // Run the API call asynchronously (non-blocking like the old subprocess)
        this._run(prompt, model, maxTokens, startTime).catch((err) => {
            if (!this._aborted) {
                console.error(`[DirectAPI] Error: ${err.message}`);
                this.emit("error", err);
                this.emit("close", 1);
            }
        });
    }

    async _run(prompt, model, maxTokens, startTime) {
        const client = await getClient();

        try {
            const response = await client.messages.create({
                model,
                max_tokens: maxTokens,
                messages: [{ role: "user", content: prompt }],
            }, {
                signal: this._abortController.signal,
            });

            if (this._aborted) return;

            const elapsed = Date.now() - startTime;
            console.error(`[DirectAPI] Response: ${elapsed}ms, model=${response.model}`);

            // Emit assistant message (for model tracking)
            this.emit("assistant", {
                message: {
                    model: response.model,
                    content: response.content,
                    stop_reason: response.stop_reason,
                },
            });

            // Emit content deltas for each text block
            for (const block of response.content) {
                if (block.type === "text" && block.text) {
                    this.emit("content_delta", {
                        event: {
                            delta: { text: block.text },
                        },
                    });
                }
            }

            // Emit result (final response)
            const text = response.content
                .filter(c => c.type === "text")
                .map(c => c.text)
                .join("");

            this.emit("result", {
                result: text,
                modelUsage: { [response.model]: true },
                usage: {
                    input_tokens: response.usage?.input_tokens || 0,
                    output_tokens: response.usage?.output_tokens || 0,
                },
            });

            this.emit("close", 0);
        } catch (err) {
            if (this._aborted) return;

            // If auth error, invalidate client for next request
            if (err.status === 401 || err.status === 403) {
                console.error("[DirectAPI] Auth error, invalidating client for next request");
                _client = null;
            }

            throw err;
        }
    }

    /**
     * Kill/abort the request
     */
    kill() {
        this._aborted = true;
        this._abortController?.abort();
    }

    /**
     * Check if still running
     */
    isRunning() {
        return !this._aborted;
    }
}

/**
 * Verify that Claude CLI is installed and accessible
 */
export async function verifyClaude() {
    return new Promise((resolve) => {
        const proc = spawn("claude", ["--version"], { stdio: "pipe" });
        let output = "";
        proc.stdout?.on("data", (chunk) => {
            output += chunk.toString();
        });
        proc.on("error", () => {
            resolve({
                ok: false,
                error: "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
            });
        });
        proc.on("close", (code) => {
            if (code === 0) {
                resolve({ ok: true, version: output.trim() });
            }
            else {
                resolve({
                    ok: false,
                    error: "Claude CLI returned non-zero exit code",
                });
            }
        });
    });
}

/**
 * Check authentication by verifying credentials file exists and token can be refreshed
 */
export async function verifyAuth() {
    try {
        const creds = await ensureFreshToken();
        if (!creds.accessToken) {
            return { ok: false, error: "No access token available" };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Exported wrappers for Messages API passthrough
 */
export async function getTokenForMessages() {
    const creds = await ensureFreshToken();
    return creds.accessToken;
}

export async function getClientForMessages() {
    return getClient();
}

export function resolveModelForMessages(model) {
    return resolveModel(model);
}

//# sourceMappingURL=manager.js.map
