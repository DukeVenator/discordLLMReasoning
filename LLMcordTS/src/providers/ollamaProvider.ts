/**
 * @fileoverview Implements the BaseProvider interface for Ollama's API.
 * Handles mapping chat messages to the Ollama /api/chat format (text-only),
 * making streaming API calls, parsing the newline-delimited JSON stream,
 * and yielding response chunks.
 */
// LLMcordTS/src/providers/ollamaProvider.ts
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { AbortController } from 'abort-controller'; // Use standard AbortController
import {
    BaseProvider,
    ChatMessage,
    StreamChunk,
    FinishReason,
    // ChatMessageContentPartText, // Removed unused import
} from './baseProvider';
import { logger } from '@/core/logger'; // Import shared logger instance
import { Config } from '@/types/config'; // Import Config type

// Interface for the expected structure of a single JSON object in the Ollama stream
interface OllamaStreamChunk {
    model: string;
    created_at: string;
    message?: { // Compatibility with /api/chat (older)
        role: 'assistant';
        content: string;
    };
    response?: string; // Field used by /api/generate and newer /api/chat
    done: boolean;
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
    context?: number[];
}

// Interface for Ollama /api/chat message structure (supports optional images)
interface OllamaChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: string[]; // Array of base64 encoded image strings
}

// Interface for Ollama /api/chat request body
interface OllamaChatRequestBody {
    model: string;
    messages: OllamaChatMessage[]; // Use the updated message structure
    stream: boolean;
    options?: Record<string, any>;
    keep_alive?: string | number;
}


/**
 * Implements the BaseProvider interface for interacting with a local Ollama instance.
 * Uses the Ollama `/api/chat` endpoint for streaming responses.
 * Note: This implementation currently only supports text content, ignoring images.
 */
export class OllamaProvider implements BaseProvider {
    /** Axios instance configured for the Ollama base URL. */
    private httpClient: AxiosInstance;
    /** The default Ollama model to use. */
    private model: string;
    /** Optional keep_alive parameter for the Ollama API. */
    private keepAlive: string | number | undefined;
    /** Optional provider-specific parameters from config. */
    private extraParams: Record<string, unknown> | undefined;
    /** The application configuration object. */
    private config: Config | undefined;

    /**
     * Creates an instance of OllamaProvider.
     * @param {string} baseURL - The base URL of the Ollama API (e.g., 'http://localhost:11434').
     * @param {string} defaultModel - The default Ollama model to use.
     * @param {Config} [config] - The application configuration object.
     * @param {string | number} [keepAlive] - Optional keep_alive duration for the model.
     * @param {Record<string, unknown>} [extraParams] - Optional provider-specific parameters from config.
     */
    constructor(
        baseURL: string,
        defaultModel: string,
        config?: Config, // Add config parameter
        keepAlive?: string | number,
        extraParams?: Record<string, unknown>
    ) {
        this.httpClient = axios.create({
            baseURL: baseURL,
            headers: { 'Content-Type': 'application/json' },
            // responseType: 'stream' // Set per-request for better control
        });
        this.model = defaultModel;
        this.config = config; // Store config
        this.keepAlive = keepAlive;
        this.extraParams = extraParams; // Store extra parameters
        logger.info(
            `OllamaProvider initialized for model: ${this.model}, BaseURL: ${baseURL}, KeepAlive: ${this.keepAlive || 'Default'}, Extra Params: ${extraParams ? JSON.stringify(extraParams) : 'None'}`
        );
    }

    /**
     * Generates a chat response stream from the Ollama API (`/api/chat`).
     *
     * Maps the internal `ChatMessage` array to the format expected by Ollama (text-only).
     * It concatenates text parts from multimodal messages and warns if images are ignored.
     * Makes a POST request to the `/api/chat` endpoint with `stream: true`.
     * Parses the newline-delimited JSON stream response from Ollama.
     * Yields `StreamChunk` objects containing the content delta.
     * Handles stream errors and closure, attempting to determine the finish reason.
     *
     * @param {ChatMessage[]} messages - The conversation history.
     * @param {string} [systemPrompt] - An optional system prompt.
     * @param {object} [options] - Optional parameters (currently not implemented).
     * @returns {AsyncGenerator<StreamChunk, void, undefined>} An async generator yielding response chunks.
     */
    async *generateStream(
        messages: ChatMessage[],
        systemPrompt?: string,
        options?: import('./baseProvider').GenerationOptions // Add the options parameter
    ): AsyncGenerator<StreamChunk, void, undefined> {
        logger.debug(`[OllamaProvider] generateStream received systemPrompt: ${systemPrompt ? `'${systemPrompt.substring(0, 50)}...'` : 'undefined'}`);

        const modelToUse = options?.model ?? this.model; // Use override model from options if provided
        const apiMessages: OllamaChatMessage[] = []; // Use the new interface

        if (systemPrompt) {
            // System prompt is just another message for Ollama
            apiMessages.push({ role: 'system', content: systemPrompt });
        }

        // Import necessary types from baseProvider
        // import { ChatMessageContentPart, ChatMessageContentPartText, ChatMessageContentPartImageBase64 } from './baseProvider';

        for (const msg of messages) {
            if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
                let contentString = '';
                let imageBase64Data: string[] = [];

                if (typeof msg.content === 'string') {
                    contentString = msg.content;
                } else {
                    // Handle array content: extract text and base64 images
                    for (const part of msg.content) {
                        if (part.type === 'text') {
                            contentString += (contentString ? '\n' : '') + part.text; // Append text parts
                        } else if (part.type === 'image') {
                            // Ollama expects an array of base64 strings *without* the data URI prefix
                            imageBase64Data.push(part.source.data);
                        } else if (part.type === 'image_url') {
                            logger.warn(`OllamaProvider received an 'image_url' part type, which should have been converted to base64. Ignoring part: ${part.image_url.url}`);
                        } else {
                            logger.warn(`Unsupported content part type encountered for Ollama: ${(part as any).type}. Skipping part.`);
                        }
                    }
                }

                // Skip message if it has no text content (Ollama requires content)
                if (!contentString.trim() && imageBase64Data.length === 0) {
                    logger.warn(`OllamaProvider: Message for role ${msg.role} resulted in empty content and no images. Skipping message.`);
                    continue; // Skip this message
                }

                // Construct the Ollama message object
                const ollamaMsg: OllamaChatMessage = {
                    role: msg.role,
                    content: contentString,
                };
                if (imageBase64Data.length > 0) {
                    ollamaMsg.images = imageBase64Data; // Add images if present
                }
                apiMessages.push(ollamaMsg);

            } else {
                logger.warn(`Unsupported message role encountered for Ollama: ${msg.role}. Skipping message.`);
            }
        } // End for...of loop

        // Build request body using the updated structure
        const requestBody: OllamaChatRequestBody = { // Use the full type now
            model: modelToUse,
            messages: apiMessages,
            stream: true,
        };

        // --- Prepare Ollama Options ---
        // Start with extraParams, then override with specific options
        const ollamaOptions: Record<string, any> = {
            ...(this.extraParams || {}),
        };
        // Override with specific options if provided
        if (options?.temperature !== undefined) {
            ollamaOptions['temperature'] = options.temperature;
        }
        if (options?.maxOutputTokens !== undefined) {
            // Ollama uses num_predict for max tokens
            // Ensure we don't overwrite num_predict if it was in extraParams unless maxOutputTokens is explicitly passed
            ollamaOptions['num_predict'] = options.maxOutputTokens;
        }
        // Add other Ollama-specific options here if needed

        // Assign the merged options to the request body if any options exist
        if (Object.keys(ollamaOptions).length > 0) {
            requestBody.options = ollamaOptions;
        }

        if (this.keepAlive !== undefined) {
            requestBody.keep_alive = this.keepAlive;
        }

        let accumulatedContent = '';
        let finalFinishReason: FinishReason = 'unknown';
        let streamClosedNaturally = false;
        const controller = new AbortController(); // Create AbortController

        try {

            // Log the system prompt and the final request body payload
            logger.debug(`[OllamaProvider] System Prompt: ${systemPrompt}`);
            logger.debug(`[OllamaProvider] Request Body Payload: ${JSON.stringify(requestBody, null, 2)}`);


            const response: AxiosResponse<NodeJS.ReadableStream> = await this.httpClient.post(
                '/api/chat',
                requestBody, // Pass the correctly typed object
                {
                    responseType: 'stream',
                    signal: controller.signal, // Pass the signal
                }
            );

            const responseStream = response.data;
            let buffer = '';

            // Handle stream closure/errors more robustly
            responseStream.on('error', (err: any) => {
                if (err.name === 'AbortError') {
                    logger.info('Ollama stream request aborted.');
                } else {
                    logger.error('Error on Ollama response stream:', err);
                }
                streamClosedNaturally = false;
            });

             responseStream.on('end', () => {
                 if (!streamClosedNaturally) {
                     logger.warn('Ollama stream ended unexpectedly (before done:true or after error).');
                 }
             });


            for await (const chunk of responseStream) {
                buffer += chunk.toString();
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.substring(0, newlineIndex).trim();
                    buffer = buffer.substring(newlineIndex + 1);

                    if (line) {
                        try {
                            const ollamaChunk: OllamaStreamChunk = JSON.parse(line);
                            let contentDelta = ollamaChunk.message?.content ?? ollamaChunk.response ?? '';

                            if (contentDelta) {
                                accumulatedContent += contentDelta;
                                yield { content: contentDelta, isFinal: false };
                            }

                            if (ollamaChunk.done) {
                                finalFinishReason = 'stop';
                                streamClosedNaturally = true;
                                yield { content: '', isFinal: true, finishReason: finalFinishReason };
                                controller.abort();
                                return;
                            }
                        } catch (parseError: any) {
                            logger.error(`Error parsing Ollama stream chunk: ${parseError.message}. Line: "${line}"`);
                        }
                    }
                }
            } // End for await...of stream

             if (!streamClosedNaturally) {
                 logger.warn('Ollama stream finished without a "done: true" marker.');
                 finalFinishReason = 'unknown';
             }

        } catch (error: any) {
             if (axios.isCancel(error)) {
                 logger.info('Ollama request cancelled/aborted successfully.');
                 if (!streamClosedNaturally) finalFinishReason = 'error';
             } else {
                 logger.error('Error during Ollama stream request:', { status: error.response?.status, message: error.message });
                 finalFinishReason = 'error';
                 yield { content: `Error: ${error.message || 'Unknown Ollama error'}`, isFinal: true, finishReason: 'error' };
             }
             if (!controller.signal.aborted) {
                 controller.abort();
             }
             if (finalFinishReason === 'error') return;

        } finally {
            if (!streamClosedNaturally && !controller.signal.aborted) {
                logger.info('Aborting Ollama request in finally block.');
                controller.abort();
            }
        }

        if (!streamClosedNaturally) {
            yield { content: '', isFinal: true, finishReason: finalFinishReason };
        }
    }

    /**
     * Checks if the currently configured Ollama model supports vision (image) inputs.
     * Checks the config flag `llm.ollama.supportsVision` first.
     * If the flag is undefined, it falls back to checking if the model name includes 'llava'.
     * @returns {boolean} True if vision is supported, false otherwise.
     */
    supportsVision(): boolean {
        const configFlag = this.config?.llm?.ollama?.supportsVision;
        if (configFlag !== undefined) {
            return configFlag;
        }
        // Fallback: Check if the model name includes known vision identifiers
        const visionKeywords = ['llava', 'bakllava']; // Add other known Ollama vision model names if needed
        return visionKeywords.some(keyword => this.model.toLowerCase().includes(keyword));
    }

    /**
     * Checks if the Ollama provider natively supports a separate system prompt.
     * Ollama's /api/chat endpoint supports the 'system' role message.
     * @returns {boolean} Always true for Ollama /api/chat.
     */
    supportsSystemPrompt(): boolean {
        return true;
    }

    /**
     * Checks if the Ollama provider supports tool/function calling.
     * Ollama itself doesn't standardize this; it depends on the specific model being served.
     * Some models might support it via specific prompting techniques, but there's no API-level support.
     * @returns {boolean} Always false for this generic Ollama provider.
     */
    supportsTools(): boolean {
        // Ollama API itself doesn't have native tool support like OpenAI/Gemini.
        // While some models *might* be fine-tuned for tool use via prompting,
        // we consider it unsupported at the provider level for now.
        // Future enhancement: Could potentially check this.model against a list of known tool-supporting models
        // served via Ollama and implement specific prompting strategies if needed.
        return false;
    }



    /**
     * Gets information about the configured Ollama provider.
     * @returns {Record<string, any>} An object containing provider details like name, model, and base URL.
     */
    getProviderInfo(): Record<string, any> {
        return {
            provider: 'ollama',
            model: this.model,
            baseURL: this.httpClient.defaults.baseURL,
        };
    }

    /**
     * Checks if the provider supports including usernames in the message history.
     * Ollama does not natively support this.
     * @returns {boolean} Always false.
     */
    supportsUsernames(): boolean {
        return false;
    }

    /**
     * Checks if the provider supports streaming responses.
     * Ollama supports streaming via the /api/chat endpoint.
     * @returns {boolean} Always true.
     */
    supportsStreaming(): boolean {
        return true;
    }

}