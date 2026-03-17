/**
 * Converts OpenAI chat request format to Claude CLI input
 */
/**
 * Extract and normalize model name from request.
 * Strips provider prefixes and passes through the model ID directly
 * so the API client can resolve it to the correct full model ID.
 */
export function extractModel(model) {
    // Strip any provider prefix (e.g., "claude-max/claude-sonnet-4-6" -> "claude-sonnet-4-6")
    const stripped = model.replace(/^[a-z0-9_-]+\//, "");
    return stripped || "claude-sonnet-4-6";
}
/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 *
 * IMPORTANT: OpenClaw sends huge system context (workspace, skills, SOUL.md,
 * MEMORY.md etc.) as system messages. Passing all of this to the CLI creates
 * a double-context problem (CLI adds its own context on top), causing timeouts.
 *
 * Strategy: Keep system context compact, preserve recent conversation turns,
 * and enforce a max prompt size to prevent timeouts.
 */
const MAX_SYSTEM_CHARS = 2000;   // Max chars for combined system messages
const MAX_PROMPT_CHARS = 30000;  // Max total prompt size (~7.5k tokens)
const MAX_HISTORY_TURNS = 4;     // Max recent user+assistant pairs to keep

function extractText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .filter(p => p.type === "text")
            .map(p => p.text)
            .join("");
    }
    return String(content);
}

function truncateText(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "\n... [truncated]";
}

export function messagesToPrompt(messages) {
    // Separate system messages from conversation
    const systemMsgs = [];
    const conversationMsgs = [];

    for (const msg of messages) {
        if (msg.role === "system") {
            systemMsgs.push(msg);
        } else {
            conversationMsgs.push(msg);
        }
    }

    // Build compact system context (truncate if too large)
    let systemText = "";
    if (systemMsgs.length > 0) {
        const combined = systemMsgs.map(m => extractText(m.content)).join("\n");
        if (combined.length > MAX_SYSTEM_CHARS) {
            // Extract just the essential instruction, skip workspace dumps
            systemText = truncateText(combined, MAX_SYSTEM_CHARS);
            console.log(`[Adapter] System context truncated: ${combined.length} → ${MAX_SYSTEM_CHARS} chars`);
        } else {
            systemText = combined;
        }
    }

    // Keep only recent conversation turns (last N user+assistant pairs + final user)
    let recentMsgs = conversationMsgs;
    if (conversationMsgs.length > MAX_HISTORY_TURNS * 2 + 1) {
        recentMsgs = conversationMsgs.slice(-(MAX_HISTORY_TURNS * 2 + 1));
        console.log(`[Adapter] Conversation trimmed: ${conversationMsgs.length} → ${recentMsgs.length} messages`);
    }

    // Build prompt
    const parts = [];
    if (systemText) {
        parts.push(`<system>\n${systemText}\n</system>\n`);
    }

    for (const msg of recentMsgs) {
        const text = extractText(msg.content);
        switch (msg.role) {
            case "user":
                parts.push(text);
                break;
            case "assistant":
                parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
                break;
        }
    }

    let prompt = parts.join("\n").trim();

    // Final safety: hard-truncate if still too large
    if (prompt.length > MAX_PROMPT_CHARS) {
        console.log(`[Adapter] Final prompt truncated: ${prompt.length} → ${MAX_PROMPT_CHARS} chars`);
        prompt = truncateText(prompt, MAX_PROMPT_CHARS);
    }

    return prompt;
}
/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request) {
    return {
        prompt: messagesToPrompt(request.messages),
        model: extractModel(request.model),
        sessionId: request.user, // Use OpenAI's user field for session mapping
    };
}
//# sourceMappingURL=openai-to-cli.js.map