# GitHub Copilot Proxy for Claude Code & Cursor IDE

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18.0+-green.svg)](https://nodejs.org/)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

> ⚠️ **Disclaimer**: This project is for **educational purposes only**. It is intended to demonstrate API proxy patterns and OAuth device flow authentication. Use at your own risk and ensure compliance with GitHub Copilot's Terms of Service.

A proxy server that enables **Claude Code** and **Cursor IDE** to use GitHub Copilot's AI models instead of direct API access. Use your GitHub Copilot subscription to access Claude models (Opus 4.5, Sonnet 4.5, Haiku 4.5) in Claude Code, or GPT models in Cursor IDE.

## 🚀 Features

- **Anthropic API Compatibility**: Implements the Anthropic Messages API for Claude Code
- **OpenAI API Compatibility**: Implements the OpenAI API format for Cursor IDE
- **Claude Model Support**: Access Claude Opus 4.5, Sonnet 4.5, and Haiku 4.5 via Copilot
- **GitHub Copilot Integration**: Connects to GitHub Copilot's backend services
- **Seamless Authentication**: Handles GitHub OAuth device flow authentication
- **Token Management**: Automatically refreshes Copilot tokens
- **Streaming Support**: Supports both streaming and non-streaming completions
- **Tool Use / Function Calling**: Full support for Anthropic tool_use ↔ OpenAI function_calls conversion
- **Docker Support**: Run as a container with `docker compose up -d`
- **Easy Configuration**: Simple setup with Claude Code or Cursor IDE

## 📋 Prerequisites

- Node.js 18.0 or higher
- GitHub Copilot subscription (with access to Claude models)
- Claude Code or Cursor IDE

## 🔧 Installation

### Option A: Quick Install (Recommended)

```bash
npm install -g claudecode-copilot-proxy
claudecode-copilot-proxy
```

That's it! The server will start at http://localhost:3000

### Option B: From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/shyamsridhar123/ClaudeCode-Copilot-Proxy.git
   cd ClaudeCode-Copilot-Proxy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the proxy server:
   ```bash
   npm start
   ```


### Option C: Docker (Self-Hosted / Server)

1. Clone the repository:
   ```bash
   git clone https://github.com/shaike1/ClaudeCode-Copilot-Proxy.git
   cd ClaudeCode-Copilot-Proxy
   ```

2. Build and start with Docker Compose:
   ```bash
   docker compose up -d --build
   ```

   The proxy will be available at **http://localhost:3002** (host port 3002 → container port 3000).

3. Authenticate by opening http://localhost:3002 in your browser and completing the GitHub OAuth flow.

4. Auth tokens are persisted in the `copilot-tokens` Docker volume — they survive container restarts.

**Rebuild after code changes:**
```bash
docker compose build --no-cache && docker compose up -d --force-recreate
```

**Other useful commands:**
```bash
docker compose logs -f          # tail logs
docker compose restart proxy    # restart without rebuild
docker compose down             # stop
```

> **Tip for remote servers**: If the proxy runs on a remote host (e.g. `100.64.0.7:3002`), set
> `ANTHROPIC_BASE_URL=http://100.64.0.7:3002` in your Claude Code settings.


## ⚡ Quick Launch

### Claude Code (one command)

```bash
ANTHROPIC_BASE_URL=http://localhost:3002 ANTHROPIC_API_KEY=sk-dummy claude --model claude-sonnet-4-5
```

> Replace `localhost` with your server IP/hostname if the proxy runs remotely.

Or set it permanently in `~/.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3002",
    "ANTHROPIC_API_KEY": "sk-dummy"
  }
}
```
Then just run `claude`.

---

### OpenClaw

**1. Register the provider in `~/.openclaw/agents/main/agent/models.json`:**

```json
{
  "providers": {
    "copilot-proxy": {
      "api": "anthropic-messages",
      "baseUrl": "http://localhost:3002",
      "authProfileKey": "copilot-proxy:default"
    }
  },
  "models": {
    "copilot-proxy/claude-sonnet-4-5": {
      "provider": "copilot-proxy",
      "model": "claude-sonnet-4-5",
      "contextWindow": 200000
    }
  }
}
```

**2. Add a dummy auth profile in `~/.openclaw/agents/main/agent/auth-profiles.json`:**

```json
{
  "profiles": {
    "copilot-proxy:default": {
      "type": "api_key",
      "provider": "copilot-proxy",
      "key": "sk-dummy"
    }
  }
}
```

**3. Set as default model in `~/.openclaw/openclaw.json`:**

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "copilot-proxy/claude-sonnet-4-5"
      }
    }
  }
}
```

## 🤖 Configuration with Claude Code

1. Start the proxy server:
   ```bash
   npm start
   ```
   You should see the authentication portal at http://localhost:3000

2. Complete GitHub authentication by pasting your auth code in the browser

3. Configure Claude Code to use the proxy by adding environment variables to your settings file:

   **Option A: Project-specific configuration** (recommended)
   
   Add to `.claude/settings.local.json` in your project:
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "http://localhost:3000",
       "ANTHROPIC_AUTH_TOKEN": "sk-dummy",
       "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
       "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
     }
   }
   ```

   **Option B: Global configuration**
   
   Add to `~/.claude/settings.json`:
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "http://localhost:3000",
       "ANTHROPIC_AUTH_TOKEN": "sk-dummy",
       "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
       "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
     }
   }
   ```

4. Enter `claude` in your terminal to start Claude Code with the proxy

### How to Verify It's Working

✅ **Server logs show 200 responses**: Look for `POST /v1/messages - 200` in the server output

✅ **Token usage is tracked**: You'll see `Tracked request for session ... +XX tokens`

✅ **Model being used**: Shows `"model": "claude-opus-4.5"` or `"claude-sonnet-4.5"`

✅ **Claude Code gets responses**: Your commands should complete without errors

✅ **Usage stats**: Check http://localhost:3000/usage.html in your browser to see how many tokens you've used

### Supported Models

| Model | Description |
|-------|-------------|
| `claude-opus-4.5` | Claude Opus 4.5 (Default) |
| `claude-sonnet-4.5` | Claude Sonnet 4.5 |
| `claude-haiku-4.5` | Claude Haiku 4.5 |

### Optional: Use Other Models

The proxy also supports GPT and Gemini models available in GitHub Copilot. To use them, add `ANTHROPIC_MODEL` to your settings:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3000",
    "ANTHROPIC_AUTH_TOKEN": "sk-dummy",
    "ANTHROPIC_MODEL": "gpt-5.2",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-3-pro-preview",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

| Model | Description |
|-------|-------------|
| `gpt-5.2` | GPT 5.2 |
| `gemini-3-pro-preview` | Gemini 3 Pro Preview |

## 🔌 Configuration with Cursor IDE

1. Open Cursor IDE
2. Go to Settings > API Keys
3. In the "Override OpenAI Base URL" section, enter:
   ```
   http://localhost:3000
   ```
4. Go to http://localhost:3000 in your browser
5. Follow the authentication steps to connect to GitHub

## 💡 Usage

Once configured, you can use Cursor IDE as normal. All AI-powered features will now use your GitHub Copilot subscription instead of Cursor's API.

To switch back to Cursor's API:
1. Go to Settings > API Keys
2. Remove the Override OpenAI Base URL


## 🔧 Tool Use / Function Calling

This fork adds full **tool use support** — the original proxy stripped `tools` from requests before forwarding to GitHub Copilot.

GitHub Copilot's Chat API (`api.githubcopilot.com/chat/completions`) is OpenAI-compatible and supports function calling. The proxy now converts between formats automatically:

| Direction | Conversion |
|-----------|-----------|
| Request | Anthropic `tools` → OpenAI `{type: "function", function: {name, description, parameters}}` |
| Request | Anthropic `tool_use` content blocks → OpenAI `tool_calls` in assistant message |
| Request | Anthropic `tool_result` content blocks → OpenAI `tool` role messages |
| Response | OpenAI `tool_calls` → Anthropic `tool_use` content blocks |
| Response | `finish_reason: "tool_calls"` → `stop_reason: "tool_use"` |

**`tool_choice` mapping:**

| Anthropic | OpenAI |
|-----------|--------|
| `"auto"` | `"auto"` |
| `"any"` | `"required"` |
| `"none"` | `"none"` |
| `{type: "tool", name: "X"}` | `{type: "function", function: {name: "X"}}` |

This makes the proxy fully compatible with agents that rely on tools (e.g. OpenClaw `exec` tool, Claude Code built-in tools).

## 🤔 How It Works

### For Claude Code (Anthropic API)

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
│   Claude Code   │────▶│   Copilot Proxy Server   │────▶│  GitHub Copilot API │
│  (Anthropic API │     │                          │     │  (Anthropic Models) │
│     format)     │     │  - Auth (OAuth device)   │     │  - claude-opus-4.5   │
└─────────────────┘     │  - Request translation   │     │  - claude-sonnet-4.5 │
                        │  - Response translation  │     │  - claude-haiku-4.5  │
                        │  - Streaming support     │     └─────────────────────┘
                        └──────────────────────────┘
```

1. The proxy authenticates with GitHub using the OAuth device flow
2. GitHub provides a token that the proxy uses to obtain a Copilot token
3. Claude Code sends requests to the proxy in Anthropic format (`/v1/messages`)
4. The proxy forwards requests to GitHub Copilot's Anthropic model endpoints
5. Responses are returned in Anthropic format with streaming support

### For Cursor IDE (OpenAI API)

1. The proxy authenticates with GitHub using the OAuth device flow
2. GitHub provides a token that the proxy uses to obtain a Copilot token
3. Cursor sends requests to the proxy in OpenAI format
4. The proxy converts these requests to GitHub Copilot's format
5. The proxy forwards responses back to Cursor in OpenAI format

## 🛠️ Development

### Running in development mode:
```bash
npm run dev
```

### Testing:
```bash
npm test
```

### Linting:
```bash
npm run lint
```

## 📄 License

MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

See the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using conventional commits (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
