/**
 * Anthropic Service - Translation layer between Claude Code and GitHub Copilot
 * 
 * Handles conversion of Anthropic Messages API format to/from Copilot format
 */

import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import {
  AnthropicMessage,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  AnthropicUsage,
  AnthropicError,
  AnthropicTool,
} from '../types/anthropic.js';
import { CopilotCompletionResponse } from '../types/github.js';
import { mapClaudeModelToCopilot } from '../utils/model-mapper.js';
import { getMachineId } from '../utils/machine-id.js';
import { logger } from '../utils/logger.js';

/**
 * Convert Anthropic messages to a single prompt string for Copilot
 */
export function convertAnthropicMessagesToCopilotPrompt(
  messages: AnthropicMessage[],
  systemPrompt?: string
): string {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return systemPrompt ? systemPrompt + '\n\n' : '';
  }

  let prompt = '';
  if (systemPrompt) {
    prompt += systemPrompt + '\n\n';
  }

  for (const message of messages) {
    const role = message.role === 'user' ? 'Human' : 'Assistant';
    const content = extractTextContent(message.content);
    if (content) {
      prompt += `${role}: ${content}\n\n`;
    }
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === 'user') {
    prompt += 'Assistant: ';
  }

  return prompt;
}

/**
 * Extract text content from Anthropic content (string or content blocks)
 */
export function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Convert Anthropic messages to OpenAI-compatible messages array,
 * handling tool_use and tool_result content blocks for multi-turn tool use.
 */
function convertMessagesToOpenAI(
  messages: AnthropicMessage[],
  system?: string | Array<{ type: string; text: string }>
): Array<Record<string, unknown>> {
  const openaiMessages: Array<Record<string, unknown>> = [];

  // Add system prompt
  if (system) {
    const systemText = typeof system === 'string'
      ? system
      : system.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    openaiMessages.push({ role: 'system', content: systemText });
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      openaiMessages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      openaiMessages.push({ role: msg.role, content: '' });
      continue;
    }

    const blocks = msg.content as ContentBlock[];

    // Check if this message contains tool_use blocks (assistant calling tools)
    const toolUseBlocks = blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const toolResultBlocks = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
    const textBlocks = blocks.filter((b): b is TextBlock => b.type === 'text');

    if (toolResultBlocks.length > 0) {
      // User message with tool results — emit one tool message per result
      // First emit any text content as a user message
      if (textBlocks.length > 0) {
        openaiMessages.push({ role: 'user', content: textBlocks.map((b) => b.text).join('\n') });
      }
      for (const tr of toolResultBlocks) {
        const resultContent = typeof tr.content === 'string'
          ? tr.content
          : extractTextContent(tr.content as ContentBlock[]);
        openaiMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: resultContent,
        });
      }
    } else if (toolUseBlocks.length > 0) {
      // Assistant message with tool_use — map to OpenAI tool_calls
      const openaiToolCalls = toolUseBlocks.map((tu) => ({
        id: tu.id,
        type: 'function',
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        },
      }));
      const textContent = textBlocks.map((b) => b.text).join('\n');
      openaiMessages.push({
        role: 'assistant',
        content: textContent || null,
        tool_calls: openaiToolCalls,
      });
    } else {
      // Plain text content
      const text = textBlocks.map((b) => b.text).join('\n');
      openaiMessages.push({ role: msg.role, content: text });
    }
  }

  return openaiMessages;
}

/**
 * Convert Anthropic tools to OpenAI function format
 */
function convertToolsToOpenAI(tools: AnthropicTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema,
    },
  }));
}

/**
 * Convert Copilot response to Anthropic message response format
 */
export function convertCopilotToAnthropicResponse(
  copilotResponse: CopilotCompletionResponse,
  model: string
): AnthropicMessageResponse {
  const text = copilotResponse.choices.map((choice) => choice.text).join('');
  const content: ContentBlock[] = [];
  if (text) {
    content.push({ type: 'text', text: text.trim() });
  }

  const usage: AnthropicUsage = {
    input_tokens: copilotResponse.usage?.prompt_tokens || 0,
    output_tokens: copilotResponse.usage?.completion_tokens || 0,
  };

  let stopReason: AnthropicMessageResponse['stop_reason'] = 'end_turn';
  const finishReason = copilotResponse.choices[0]?.finish_reason;
  if (finishReason === 'length') stopReason = 'max_tokens';
  else if (finishReason === 'stop') stopReason = 'stop_sequence';

  return {
    id: `msg_${copilotResponse.id || uuidv4()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  };
}

/**
 * Make a completion request to GitHub Copilot using Anthropic format
 */
export async function makeAnthropicCompletionRequest(
  request: AnthropicMessageRequest,
  copilotToken: string
): Promise<AnthropicMessageResponse> {
  const { messages, system, temperature, max_tokens, model, tools, tool_choice } = request;

  const copilotModel = mapClaudeModelToCopilot(model);
  logger.info(`Model mapping: "${model}" -> "${copilotModel}"`);

  const machineId = getMachineId();
  const chatEndpoint = config.github.copilot.anthropicEndpoints.COPILOT_ANTHROPIC_CHAT;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${copilotToken}`,
    'X-Request-Id': uuidv4(),
    'Machine-Id': machineId,
    'User-Agent': 'GitHubCopilotChat/0.12.0',
    'Editor-Version': 'vscode/1.90.0',
    'Editor-Plugin-Version': 'copilot-chat/0.12.0',
    'Openai-Organization': 'github-copilot',
    'Openai-Intent': 'conversation-agent',
  };

  // Convert messages (handles tool_use / tool_result blocks)
  const openaiMessages = convertMessagesToOpenAI(messages, system);

  const body: Record<string, unknown> = {
    model: copilotModel,
    messages: openaiMessages,
    max_tokens: max_tokens || 4096,
    temperature: temperature ?? 0.7,
    stream: false,
  };

  // Pass tools through as OpenAI function definitions
  if (tools && tools.length > 0) {
    body.tools = convertToolsToOpenAI(tools);
    // Map Anthropic tool_choice to OpenAI format
    if (tool_choice) {
      if (tool_choice === 'auto') body.tool_choice = 'auto';
      else if (tool_choice === 'any') body.tool_choice = 'required';
      else if (tool_choice === 'none') body.tool_choice = 'none';
      else if (typeof tool_choice === 'object' && tool_choice.type === 'tool') {
        body.tool_choice = { type: 'function', function: { name: tool_choice.name } };
      }
    }
    logger.info(`Forwarding ${tools.length} tool(s) to Copilot: ${tools.map((t) => t.name).join(', ')}`);
  }

  try {
    logger.debug('Making chat completion request to Copilot', { endpoint: chatEndpoint, model: copilotModel });

    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Copilot chat API error', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`Copilot API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return convertOpenAIToAnthropicResponse(data, model);
  } catch (error) {
    logger.error('Error making chat completion request', { error });
    throw error;
  }
}

/**
 * Convert OpenAI chat completion response to Anthropic format,
 * including tool_calls → tool_use content blocks.
 */
function convertOpenAIToAnthropicResponse(
  data: Record<string, unknown>,
  model: string
): AnthropicMessageResponse {
  type OpenAIMessage = {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  type OpenAIChoice = { message?: OpenAIMessage; finish_reason?: string };

  const choices = (data.choices as OpenAIChoice[]) || [];
  const firstChoice = choices[0] || {};
  const message = firstChoice.message || {};
  const usage = (data.usage as { prompt_tokens?: number; completion_tokens?: number }) || {};

  const content: ContentBlock[] = [];

  // Add text content if present
  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  // Convert tool_calls to Anthropic tool_use blocks
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = { _raw: tc.function.arguments };
      }
      const toolUse: ToolUseBlock = {
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      };
      content.push(toolUse);
    }
  }

  const finishReason = firstChoice.finish_reason;
  let stopReason: AnthropicMessageResponse['stop_reason'] = 'end_turn';
  if (finishReason === 'length') stopReason = 'max_tokens';
  else if (finishReason === 'tool_calls' && content.some((b) => b.type === 'tool_use')) stopReason = 'tool_use';

  return {
    id: `msg_${uuidv4().replace(/-/g, '').substring(0, 24)}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
  };
}

export function createAnthropicError(
  type: AnthropicError['error']['type'],
  message: string
): AnthropicError {
  return { type: 'error', error: { type, message } };
}

export function generateMessageId(): string {
  return `msg_${uuidv4().replace(/-/g, '').substring(0, 24)}`;
}
