/**
 * @fileoverview Implements the BaseProvider interface for OpenAI and compatible APIs.
 * Handles mapping chat messages to the OpenAI API format, making API calls,
 * processing streamed responses, and mapping finish reasons.
 */
// LLMcordTS/src/providers/openaiProvider.ts
import OpenAI from 'openai';
import {
    ChatCompletionMessageParam,
    ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import {
    BaseProvider,
    ChatMessage,
    StreamChunk,
    FinishReason,
    ChatMessageContentPart,
} from './baseProvider';
import type { ToolCallRequest } from '../types/tools'; // Remove unused ToolDefinition
import { logger } from '@/core/logger'; // Import shared logger instance
// Removed unused Config import

/**
 * Implements the BaseProvider interface for interacting with OpenAI's Chat Completions API
 * or any OpenAI-compatible API (like Ollama, Groq, Mistral etc. when configured with a baseURL).
 */
export class OpenAIProvider implements BaseProvider {
    /** The OpenAI client instance. */
    private client: OpenAI;
    /** The default model to use for chat completions. */
    private model: string;
    /** Optional provider-specific parameters from config. */
    private extraParams: Record<string, unknown> | undefined; // Explicitly allow undefined
    // Removed hardcoded supportsVision property

    /**
     * Creates an instance of OpenAIProvider.
     * @param {string} apiKey - The API key for the OpenAI-compatible service.
     * @param {string} defaultModel - The default model identifier to use for requests.
     * @param {string} [baseURL] - Optional custom base URL for compatible APIs (e.g., Ollama, Groq).
     * @param {Record<string, unknown>} [extraParams] - Optional provider-specific parameters from config.
     */
    constructor(
        apiKey: string,
        defaultModel: string,
        baseURL?: string,
        extraParams?: Record<string, unknown>
    ) {
        this.client = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL, // Pass baseURL if provided, otherwise uses OpenAI default
        });
        this.model = defaultModel; // Store the default model
        this.extraParams = extraParams; // Store extra parameters
        logger.info(
            `OpenAIProvider initialized for model: ${this.model}, BaseURL: ${baseURL || 'Default'}, Extra Params: ${extraParams ? JSON.stringify(extraParams) : 'None'}`
        );
    }

    /**
     * Generates a chat response stream from the OpenAI API.
     *
     * Maps the internal `ChatMessage` array to the format expected by the OpenAI API,
     * including handling multimodal content (text and images) for the 'user' role.
     * It filters out unsupported content parts and handles role-specific content formatting.
     * Calls the `client.chat.completions.create` method with `stream: true`.
     * Yields `StreamChunk` objects as data is received from the API.
     * Maps the OpenAI finish reasons to the internal `FinishReason` type.
     *
     * @param {ChatMessage[]} messages - The conversation history.
     * @param {string} [systemPrompt] - An optional system prompt to guide the model.
     * @param {object} [options] - Optional parameters (e.g., temperature, maxTokens, model override - currently not implemented).
     * @returns {AsyncGenerator<StreamChunk, void, undefined>} An async generator yielding response chunks.
     * @throws {Error} If the API call fails.
     */
    async *generateStream(
        messages: ChatMessage[],
        systemPrompt?: string,
        options?: import('./baseProvider').GenerationOptions // Add the options parameter
    ): AsyncGenerator<StreamChunk, void, undefined> {
        logger.debug(`[OpenAIProvider] generateStream received systemPrompt: ${systemPrompt ? `'${systemPrompt.substring(0, 50)}...'` : 'undefined'}`);

        const modelToUse = options?.model ?? this.model; // Use override model from options if provided
        const apiMessages: ChatCompletionMessageParam[] = [];

        if (systemPrompt) {
            apiMessages.push({ role: 'system', content: systemPrompt });
        }

        // Use a for...of loop to allow 'continue'
        for (const msg of messages) {
            // Map internal ChatMessage to OpenAI's ChatCompletionMessageParam
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                let messageParam: ChatCompletionMessageParam;

                if (typeof msg.content === 'string') {
                    // Simple string content
                    messageParam = {
                        role: msg.role,
                        content: msg.content,
                        ...(msg.name && { name: msg.name }),
                    };
                } else {
                    // Array content (multimodal)
                    const apiContentParts = msg.content
                        .map((part: ChatMessageContentPart): OpenAI.ChatCompletionContentPart | null => { // Explicitly type 'part'
                            if (part.type === 'text') {
                                return { type: 'text', text: part.text };
                            } else if (part.type === 'image_url') {
                                // Handle direct image URLs (less common now but supported)
                                return { type: 'image_url', image_url: { url: part.image_url.url } };
                            } else if (part.type === 'image') {
                                // Handle base64 encoded images
                                // OpenAI expects the URL format: "data:{media_type};base64,{data}"
                                return {
                                    type: 'image_url', // OpenAI uses 'image_url' type even for base64
                                    image_url: {
                                        url: `data:${part.source.media_type};base64,${part.source.data}`,
                                        // detail: 'auto' // Optional: control image detail level
                                    },
                                };
                            } else {
                                // Log and skip any other unsupported part types
                                logger.warn(`Unsupported content part type encountered: ${(part as any).type}. Skipping part.`);
                                return null;
                            }
                        })
                        .filter((part): part is OpenAI.ChatCompletionContentPart => part !== null); // Filter out nulls and assert type

                    // OpenAI requires multimodal content (images) only for the 'user' role.
                    // If it's assistant/system, we might need to handle this differently
                    // (e.g., stringify, take first text part, or throw error).
                    // For now, let's assume multimodal is primarily for user input.
                    // The OpenAI library types might enforce this anyway.
                    if (apiContentParts.length === 0 && msg.content.length > 0) {
                         logger.warn(`Message content parts were all unsupported or filtered out for role ${msg.role}.`);
                         // Decide how to handle this: skip message, send empty string, etc.
                         // Let's skip for now to avoid sending potentially invalid messages.
                         continue; // Skip this message
                    }

                    // Construct the message param based on the role
                    // We need to satisfy the specific types within ChatCompletionMessageParam union
                    switch (msg.role) {
                        case 'user':
                            messageParam = {
                                role: 'user',
                                content: apiContentParts, // Array is valid for user role
                                ...(msg.name && { name: msg.name }),
                            };
                            break;
                        case 'assistant':
                             // Assistant role typically expects string content or tool calls, not multimodal arrays.
                             // Let's concatenate text parts for simplicity, or handle based on specific needs.
                             // This might need adjustment based on how assistant multimodal responses are handled.
                             const assistantTextContent = apiContentParts
                                 .filter(part => part.type === 'text')
                                 .map(part => part.text)
                                 .join('\n');
                             messageParam = {
                                 role: 'assistant',
                                 content: assistantTextContent || null, // Send null if no text content
                                 // tool_calls: ... // Add if handling tool calls
                                 ...(msg.name && { name: msg.name }),
                             };
                             break;
                        case 'system':
                            // System role expects string content.
                             const systemTextContent = apiContentParts
                                 .filter(part => part.type === 'text')
                                 .map(part => part.text)
                                 .join('\n');
                            messageParam = {
                                role: 'system',
                                content: systemTextContent,
                                ...(msg.name && { name: msg.name }),
                            };
                            break;
                        // No default needed as roles are checked above
                    }
                }

                apiMessages.push(messageParam);

            } else {
                logger.warn(`Unsupported message role encountered: ${msg.role}. Skipping message.`);
            }
        } // End of for...of loop

        let accumulatedContent = '';
        let finalFinishReason: FinishReason = 'unknown';
        let streamClosedNaturally = false;
            // Accumulator for tool calls, mapping call ID to the request details
            const toolCallAccumulator: Map<string, { id: string; name: string; arguments: string }> = new Map();


        try {
            // Define base parameters for the API call
            const apiParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
                // Spread extra parameters from config first
                ...(this.extraParams || {}),
                // Core parameters
                model: modelToUse,
                messages: apiMessages,
                stream: true,
                // Explicit parameters from options override extraParams if present
                temperature: options?.temperature ?? (this.extraParams?.['temperature'] as number | null) ?? null,
                max_tokens: options?.maxOutputTokens ?? (this.extraParams?.['max_tokens'] as number | null) ?? null,
            };

            // Conditionally add tools if they are provided and valid
            if (options?.tools && options.tools.length > 0) {
                apiParams.tools = options.tools.map(tool => ({ type: 'function', function: tool }));
                // apiParams.tool_choice = 'auto'; // Explicitly set tool_choice if needed, defaults to 'auto'
            }


            // Log the system prompt and the final API messages payload
            logger.debug(`[OpenAIProvider] System Prompt: ${systemPrompt}`);
            logger.debug(`[OpenAIProvider] API Messages Payload: ${JSON.stringify(apiMessages, null, 2)}`);

            const stream = await this.client.chat.completions.create(apiParams);

            for await (const chunk of stream) {
                const choice = chunk.choices[0];
                if (!choice) continue; // Skip if no choice in chunk

                const delta = choice.delta;
                const chunkFinishReason = choice.finish_reason;

                // Handle content delta
                if (delta?.content) {
                    accumulatedContent += delta.content;
                    yield {
                        content: delta.content,
                        isFinal: false,
                    };
                }

                // Handle tool call deltas (arguments stream incrementally)
                if (delta?.tool_calls) {
                    for (const toolCallDelta of delta.tool_calls) {
                        // We need the ID to accumulate arguments correctly.
                        // The ID should be present from the first chunk containing the tool call.
                        if (toolCallDelta.index !== undefined && toolCallDelta.id) {
                            const callId = toolCallDelta.id;
                            let accumulatedCall = toolCallAccumulator.get(callId);

                            // If this is the first chunk for this call ID, initialize it
                            if (!accumulatedCall) {
                                if (!toolCallDelta.function?.name) {
                                    // Should not happen if ID is present, but good to guard
                                    logger.warn(`Tool call delta received with ID ${callId} but no function name.`);
                                    continue;
                                }
                                accumulatedCall = {
                                    id: callId,
                                    name: toolCallDelta.function.name,
                                    arguments: '', // Initialize arguments string
                                };
                                toolCallAccumulator.set(callId, accumulatedCall);
                            }

                            // Append argument chunks
                            if (toolCallDelta.function?.arguments) {
                                accumulatedCall.arguments += toolCallDelta.function.arguments;
                            }
                        } else {
                             logger.warn('Received tool call delta without index or ID, cannot process reliably.', toolCallDelta);
                        }
                    }
                }


                // Handle finish reason
                if (chunkFinishReason) {
                    finalFinishReason = this.mapFinishReason(chunkFinishReason);
                    streamClosedNaturally = true; // Mark that the stream provided a reason

                    // If finished due to tool calls, yield the accumulated calls
                    if (finalFinishReason === 'tool_calls') {
                        const finalToolCalls: ToolCallRequest[] = Array.from(toolCallAccumulator.values()).map(tc => ({
                            id: tc.id,
                            toolName: tc.name, // Map 'name' to 'toolName'
                            args: tc.arguments // Map 'arguments' to 'args'
                        }));
                        // Optional: Validate finalToolCalls structure here if needed
                        logger.info(`OpenAI stream finished with tool calls: ${JSON.stringify(finalToolCalls)}`);
                        yield {
                            toolCalls: finalToolCalls,
                            isFinal: true,
                            finishReason: 'tool_calls',
                        };
                    } else {
                        // Otherwise, yield the standard final chunk marker
                        yield {
                            content: '', // No more content in this final marker chunk
                            isFinal: true,
                            finishReason: finalFinishReason,
                        };
                    }
                    break; // Exit loop once finish reason is received
                }
            }
        } catch (error: any) {
            logger.error('Error during OpenAI stream generation:', error);
            finalFinishReason = 'error';
            // Yield an error chunk
            yield {
                content: `Error: ${error.message || 'Unknown error'}`,
                isFinal: true,
                finishReason: 'error',
            };
            return; // Stop generation on error
        }

        // If the loop finished without OpenAI providing a finish_reason (unlikely but possible)
        if (!streamClosedNaturally) {
             logger.warn('OpenAI stream finished without providing a finish reason.');
             yield {
                 content: '',
                 isFinal: true,
                 finishReason: 'unknown', // Or potentially 'length' if applicable?
             };
        }

        // Optional: Log total generated content for debugging
        logger.debug(`OpenAI generation finished. Reason: ${finalFinishReason}. Total Content Length: ${accumulatedContent.length}`);
    }

    /**
     * Checks if the currently configured OpenAI model supports vision (image) inputs.
     * This is based on common naming conventions for OpenAI vision models.
     * @returns {boolean} Always true, assuming modern OpenAI models support vision.
     */
    supportsVision(): boolean {
        // Assume true for modern OpenAI models.
        // Specific model checks could be added if needed for older/non-standard models.
        return true;
    }

    /**
     * Checks if the OpenAI provider natively supports a separate system prompt.
     * OpenAI's API directly supports the 'system' role.
     * @returns {boolean} Always true for OpenAI.
     */
    supportsSystemPrompt(): boolean {
        return true;
    }

    /**
     * Checks if the OpenAI provider supports tool/function calling.
     * @returns {boolean} Always true for current OpenAI models that support it.
     */
    supportsTools(): boolean {
        // Assume true for modern OpenAI models; could add model-specific checks if needed.
        return true;
    }



    /**
     * Maps OpenAI's finish reason strings to the internal `FinishReason` enum.
     * @param {ChatCompletionChunk.Choice['finish_reason']} reason - The finish reason from the OpenAI API chunk.
     * @returns {FinishReason} The corresponding internal finish reason.
     * @private
     */
    private mapFinishReason(reason: ChatCompletionChunk.Choice['finish_reason']): FinishReason {
        switch (reason) {
            case 'stop':
                return 'stop';
            case 'length':
                return 'length';
            case 'content_filter':
                return 'content_filter';
            case 'tool_calls':
                return 'tool_calls';
            default:
                return 'unknown';
        }
    }

    /**
     * Gets information about the configured provider.
     * @returns {Record<string, any>} An object containing provider details like name, model, and base URL.
     */
    getProviderInfo(): Record<string, any> {
        return {
            provider: 'openai',
            model: this.model,
            baseURL: this.client.baseURL,
        };
    }

    /**
     * Checks if the provider supports including usernames (via the 'name' property) in the message history.
     * OpenAI supports the 'name' property on messages.
     * @returns {boolean} Always true.
     */
    supportsUsernames(): boolean {
        return true;
    }

    /**
     * Checks if the provider supports streaming responses.
     * OpenAI supports streaming.
     * @returns {boolean} Always true.
     */
    supportsStreaming(): boolean {
        return true;
    }

}