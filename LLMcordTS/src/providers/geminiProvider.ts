/**
 * @fileoverview Implements the BaseProvider interface for Google's Gemini API.
 * Handles mapping chat messages to the Gemini API format (text-only currently),
 * making streaming API calls via the `@google/genai` SDK, processing the stream,
 * and mapping finish reasons.
 */
// LLMcordTS/src/providers/geminiProvider.ts
import {
    GoogleGenAI,
    Content,
    Part,
    FinishReason as GeminiInternalFinishReason,
    // GenerateContentResponse, // Removed unused import
    // Import SendMessageParameters if needed for explicit typing
    // SendMessageParameters, // No longer needed here as params are set earlier
    FunctionDeclaration,
    Tool,
    Type as GeminiType,
    FunctionCall,
    // GenerateContentRequest, // Removed - rely on type inference
    // GenerateContentStreamResult, // Removed - rely on type inference
} from '@google/genai';
import {
    BaseProvider,
    ChatMessage,
    StreamChunk,
    FinishReason,
    ChatMessageContentPart,
    ChatMessageContentPartFunctionCall, // Import the new type
    // ChatMessageContentPartText, // Removed unused import
} from './baseProvider';
import { logger } from '@/core/logger'; // Import shared logger instance
import { ToolDefinition, ToolCallRequest } from '../types/tools';

// Removed unused interface GeminiSystemInstruction

/**
 * Implements the BaseProvider interface for interacting with Google's Gemini models
 * using the `@google/genai` SDK.
 * Note: This implementation currently only supports text content and ignores images.
 * System prompts are also currently ignored as they are handled differently by the Gemini API.
 */
export class GeminiProvider implements BaseProvider {
    /** The initialized GoogleGenAI client instance. */
    private genAI: GoogleGenAI;
    /** The default Gemini model name to use (e.g., 'gemini-pro', 'gemini-pro-vision'). */
    private defaultModelName: string;
    /** Optional provider-specific parameters from config. */
    private extraParams: Record<string, unknown> | undefined;
    // Removed hardcoded supportsVision property

    /**
     * Creates an instance of GeminiProvider.
     * @param {string} apiKey - The API key for the Google AI service.
     * @param {string} defaultModel - The default Gemini model name.
     * @param {Record<string, unknown>} [extraParams] - Optional provider-specific parameters from config.
     */
    constructor(
        apiKey: string,
        defaultModel: string,
        extraParams?: Record<string, unknown>
    ) {
        this.genAI = new GoogleGenAI({ apiKey }); // Correct constructor
        this.defaultModelName = defaultModel;
        this.extraParams = extraParams; // Store extra parameters
        logger.info(
            `GeminiProvider initialized for model: ${this.defaultModelName}, Extra Params: ${extraParams ? JSON.stringify(extraParams) : 'None'}`
        );
    }

    /**
     * Generates a chat response stream from the Gemini API.
     *
     * Maps the internal `ChatMessage` array to the Gemini `Content` format (text-only).
     * It filters out non-text parts and unsupported roles, logging warnings.
     * Uses the `@google/genai` SDK's `sendMessageStream` method.
     * Yields `StreamChunk` objects as data is received.
     * Maps Gemini finish reasons to the internal `FinishReason` type.
     *
     * @param {ChatMessage[]} messages - The conversation history.
     * @param {string} [systemPrompt] - Currently ignored by this provider.
     * @param {object} [options] - Optional parameters (currently not implemented).
     * @returns {AsyncGenerator<StreamChunk, void, undefined>} An async generator yielding response chunks.
     */
    async *generateStream(
        messages: ChatMessage[],
        systemPrompt?: string, // Use the system prompt
        options?: import('./baseProvider').GenerationOptions // Add the options parameter
    ): AsyncGenerator<StreamChunk, void, undefined> {

        const modelToUse = options?.model ?? this.defaultModelName; // Use override model from options if provided

        // Import necessary types from baseProvider
        // import { ChatMessageContentPart, ChatMessageContentPartText } from './baseProvider';

        const history: Content[] = messages
            .map((msg: ChatMessage): Content | null => {
                let parts: Part[];

                // --- Handle Tool Role ---
                // Map tool results to a Content object *without* a role, containing a functionResponse part.
                // For tool responses
                if (msg.role === 'tool') {
                    if (!msg.tool_call_id) {
                        logger.warn(`GeminiProvider: Skipping tool message without tool_call_id.`);
                        return null;
                    }

                    // Parse the content if it's a string but represents JSON
                    let parsedResponse = msg.content;
                    if (typeof msg.content === 'string') {
                        try {
                            // Try to parse if it's a JSON string
                            parsedResponse = JSON.parse(msg.content);
                        } catch {
                            // Keep as string if not valid JSON
                            parsedResponse = msg.content;
                        }
                    }

                    const toolResponsePart: Part = {
                        functionResponse: {
                            id: msg.tool_call_id,
                            name: msg.tool_name!,
                            response: {
                                output: parsedResponse // Use the "output" key as recommended
                            }
                        }
                    };

                    // Use user role instead of tool role, as suggested by feedback and common patterns
                    return { role: 'user', parts: [toolResponsePart] };
                }

                // --- Handle User/Assistant/System Roles ---
                if (typeof msg.content === 'string') {
                    parts = [{ text: msg.content }];
                } else if (Array.isArray(msg.content)) {
                    parts = msg.content
                        .map((part: ChatMessageContentPart): Part | null => {
                            if (part.type === 'text') {
                                return { text: part.text };
                            } else if (part.type === 'image') {
                                return { inlineData: { mimeType: part.source.media_type, data: part.source.data } };
                            } else if (part.type === 'image_url') {
                                logger.warn(`GeminiProvider received an 'image_url' part type, which should have been converted to base64. Ignoring part: ${part.image_url.url}`);
                                return null;
                            } else if (part.type === 'functionCall') {
                                // Handle functionCall parts during the initial array mapping
                                return {
                                    functionCall: {
                                        name: part.functionCall.name,
                                        args: part.functionCall.args,
                                    }
                                };
                            } else {
                                // Log for any truly unexpected part types
                                logger.warn(`Unsupported content part type encountered during array mapping for Gemini: ${(part as any).type}. Skipping part.`);
                                return null;
                            }
                        })
                        .filter((part): part is Part => part !== null);
                } else {
                     logger.warn(`Unsupported content type for role ${msg.role}: ${typeof msg.content}. Skipping message.`);
                     return null;
                }

                // If no valid parts remain after processing (excluding tool role handled above)
                if (parts.length === 0) {
                    logger.warn(`Message for role ${msg.role} resulted in no valid parts after processing. Skipping message.`);
                    return null;
                }

                // Map remaining roles ('user', 'assistant', 'system')
                if (msg.role === 'user') {
                    return { role: 'user', parts: parts };
                } else if (msg.role === 'assistant') {
                    // Handle assistant's turn. Check content parts for functionCall.
                    const functionCallPart = (Array.isArray(msg.content)
                        ? msg.content.find(part => part.type === 'functionCall')
                        : null) as ChatMessageContentPartFunctionCall | undefined; // Type assertion

                    if (functionCallPart) {
                        // Found a function call request part
                        const geminiFunctionCallPart: Part = {
                            functionCall: {
                                name: functionCallPart.functionCall.name,
                                args: functionCallPart.functionCall.args,
                            }
                        };
                        // Include text content if it exists alongside the tool call request
                        const textPart = (Array.isArray(msg.content)
                            ? msg.content.find(part => part.type === 'text')
                            : (typeof msg.content === 'string' ? { text: msg.content } : null)) as Part | null; // Find or create text part

                        const finalParts = textPart ? [textPart, geminiFunctionCallPart] : [geminiFunctionCallPart];
                        logger.debug(`Mapping assistant message with functionCall request: ${functionCallPart.functionCall.name}`);
                        return { role: 'model', parts: finalParts };
                    } else {
                        // No functionCall part found, map regular content (text/images)
                        // Ensure 'parts' is correctly derived from string or array content
                        if (typeof msg.content === 'string') {
                             parts = [{ text: msg.content }];
                        } else if (Array.isArray(msg.content)) {
                             // Filter out any potential (but unexpected) functionCall parts if mapping regular content
                             parts = msg.content
                                 .filter(part => part.type !== 'functionCall')
                                 .map((part: ChatMessageContentPart): Part | null => { // Map remaining parts
                                     if (part.type === 'text') return { text: part.text };
                                     if (part.type === 'image') return { inlineData: { mimeType: part.source.media_type, data: part.source.data } };
                                     // Handle image_url or other types if necessary, or return null
                                     return null;
                                 })
                                 .filter((p): p is Part => p !== null);
                        } else {
                             parts = []; // Should not happen if previous checks passed, but safety first
                        }

                        if (parts.length === 0) {
                             logger.warn(`Assistant message resulted in no valid parts after processing.`);
                             return null;
                        }
                        return { role: 'model', parts: parts };
                    }
                } else if (msg.role === 'system') {
                    logger.warn("System messages in history are ignored by GeminiProvider; use the systemPrompt parameter instead.");
                    return null;
                } else {
                     // This case should ideally not be reached if all roles are handled above
                     logger.warn(`Unsupported message role encountered during mapping: ${msg.role}. Skipping message.`);
                     return null;
                }
            })
            .filter((msg): msg is Content => msg !== null);

        // Removed the system prompt prepending workaround. We will use the config.systemInstruction field.

        if (history.length === 0) {
            logger.error("Cannot generate response with empty message history.");
            yield { content: "Error: Message history is empty.", isFinal: true, finishReason: 'error' };
            return;
        }

        // System prompt will be handled within the config object below.

        // const chatHistory = history.slice(0, -1); // Removed unused variable
        const lastMessageContent = history[history.length - 1];

        if (!lastMessageContent || lastMessageContent.role !== 'user') {
             logger.error("The last message in the history must be from the 'user'.");
             yield { content: "Error: Invalid final message role.", isFinal: true, finishReason: 'error' };
             return;
        }
        const lastMessageParts = lastMessageContent.parts;
        if (!lastMessageParts || lastMessageParts.length === 0) {
             logger.error("The last message has no parts.");
             yield { content: "Error: Invalid final message content.", isFinal: true, finishReason: 'error' };
             return;
         }

         let accumulatedContent = '';
         let finalFinishReason: FinishReason = 'unknown';
         let streamClosedNaturally = false;

         // --- Prepare Generation Config ---
         // Start with extraParams, then override with specific options
         const generationConfig: Record<string, any> = { // Use Record<string, any> for flexibility
             ...(this.extraParams || {}),
         };
         // Override with specific options if provided
         if (options?.temperature !== undefined) {
             generationConfig['temperature'] = options.temperature;
         }
         if (options?.maxOutputTokens !== undefined) {
             generationConfig['maxOutputTokens'] = options.maxOutputTokens;
         }
         // Note: Other potential options from GenerateContentConfig could be added here if needed

         // --- Prepare Tools ---
         let toolsForApi: Tool[] | undefined = undefined; // Expects Tool[]
         let toolConfig: { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE' } } | undefined = undefined;
         if (options?.tools && options.tools.length > 0) {
             toolsForApi = [{ functionDeclarations: options.tools.map(this.mapToolToGeminiDeclaration) }]; // Wrap in array
             // Defaulting to AUTO mode. Could be made configurable later.
             toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
             if (toolsForApi[0]?.functionDeclarations) {
                logger.info(`GeminiProvider: Preparing ${toolsForApi[0].functionDeclarations.length} tools for API call.`);
             }
         }

         let functionCallsYielded = false; // Track if any function calls were yielded
         // Log received prompt *after* history mapping, before try block
         logger.debug(`[GeminiProvider] generateStream received systemPrompt: ${systemPrompt ? `'${systemPrompt.substring(0, 50)}...'` : 'undefined'}`);

         try {
            // --- Prepare Request for generateContentStream ---
            // Let TypeScript infer the type for the request object
            const request = {
                model: modelToUse,
                contents: history, // Pass the full mapped history here
            };

            // Conditionally add optional properties
            if (Object.keys(generationConfig).length > 0) {
                (request as any).generationConfig = generationConfig;
            }
            if (systemPrompt) {
                (request as any).systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };
            }
            if (toolsForApi) {
                (request as any).tools = toolsForApi;
            }
            if (toolConfig) {
                (request as any).toolConfig = toolConfig;
            }


            // Log the complete request being sent
            // Log the system instruction separately for clarity
            if ((request as any).systemInstruction) {
                 logger.debug(`[GeminiProvider] Sending systemInstruction: ${JSON.stringify((request as any).systemInstruction)}`);
            } else {
                 logger.debug(`[GeminiProvider] No systemInstruction being sent.`);
            }
            logger.debug(`[GeminiProvider] Calling generateContentStream with full request: ${JSON.stringify(request, null, 2)}`);


            // --- Call generateContentStream ---
            // Let TypeScript infer the return type
            const streamResult = await this.genAI.models.generateContentStream(request as any); // Use 'as any' to bypass strict type check if needed


            // --- Process Stream ---
            // Iterate directly over the streamResult, as it's the async generator
            for await (const responseChunk of streamResult) {
                const candidate = responseChunk.candidates?.[0];
                const chunkFinishReason = candidate?.finishReason;
                const textContent = responseChunk.text; // Use getter
                const functionCalls = responseChunk.functionCalls; // Check for function calls

                let validFunctionCalls: FunctionCall[] = []; // Declare variable in outer scope

                // Yield text content if present
                if (textContent) {
                    accumulatedContent += textContent;
                    yield { content: textContent, isFinal: false };
                 }

                 // Yield tool calls if present
                 if (functionCalls && functionCalls.length > 0) {
                     validFunctionCalls = functionCalls.filter((fc: FunctionCall) => { // Add type annotation
                         if (!fc.name) {
                             logger.warn('GeminiProvider: Received function call without a name. Skipping.');
                             return false;
                         }
                         return true;
                     });

                     if (validFunctionCalls.length > 0) {
                         functionCallsYielded = true; // Set the flag
                         const toolCallRequests: ToolCallRequest[] = validFunctionCalls.map((fc: FunctionCall, index: number): ToolCallRequest => ({
                             // Gemini doesn't seem to provide a unique ID per call in the stream,
                             // so we generate a simple one. This might need refinement if
                             // multiple calls to the *same* function are possible in one chunk.
                             id: `gemini-tool-call-${Date.now()}-${index}`,
                             toolName: fc.name!, // Use non-null assertion now safe after filter
                             args: fc.args, // Gemini SDK already parses args into an object
                         }));
                         yield { toolCalls: toolCallRequests, isFinal: false };
                         // Note: If a chunk contains *both* text and function calls, they are yielded separately.
                     }
                 }

                 // Handle finish reason
                 if (chunkFinishReason) {
                     let mappedReason = this.mapFinishReason(chunkFinishReason);
                     streamClosedNaturally = true;

                     // Determine the final reason, prioritizing 'tool_calls' if applicable
                     // Use the functionCallsYielded flag which tracks if any calls were yielded across chunks
                     const isToolCallFinish = mappedReason === 'stop' && functionCallsYielded;
                     finalFinishReason = isToolCallFinish ? 'tool_calls' : mappedReason;

                     // Yield the final chunk.
                     // We always yield a final chunk when a finishReason is received.
                     // It might be empty if content/tool calls were already yielded, but it signals the end.
                     yield { content: '', toolCalls: [], isFinal: true, finishReason: finalFinishReason };

                     break; // Exit loop once finish reason is received
                 }
            }

        } catch (error: any) {
            // Enhanced error logging
            logger.error('Caught error in Gemini stream.');
            if (error instanceof Error) {
                logger.error(`Error Message: ${error.message}`);
                logger.error(`Error Stack: ${error.stack}`);
            }
            // Attempt to log the full error object structure if possible
            try {
                // Use JSON.stringify with a basic replacer to handle potential circular references
                const errorString = JSON.stringify(error, (key, value) => {
                     if (typeof value === 'object' && value !== null) {
                         // Basic check to avoid overly deep or complex objects in logs
                         if (key === 'response' || key === 'request') return '[omitted]';
                     }
                     return value;
                 }, 2);
                logger.error(`Full Error Object (stringified): ${errorString}`);
            } catch (stringifyError) {
                logger.error('Could not stringify the full error object:', stringifyError);
                // Fallback to logging the basic error object if stringify fails
                logger.error('Basic Error Object:', error);
            }
            logger.info('Yielding error chunk...'); // Add log before yield
            yield { content: `Error: ${error?.message || 'Unknown error'}`, isFinal: true, finishReason: 'error' };
            logger.info('Returned after yielding error chunk.'); // Add log after return (though likely won't be reached if crash happens)
            return;
        }

        if (!streamClosedNaturally) {
            logger.warn('Gemini stream finished without providing a finish reason.');
            yield { content: '', isFinal: true, finishReason: 'unknown' };
        }
    }

    // mapFinishReason remains the same
    /**
     * Checks if the currently configured Gemini model supports vision (image) inputs.
     * This is based on the common naming convention for Gemini vision models.
     * @returns {boolean} True if the model name includes 'vision', false otherwise.
     */
    supportsVision(): boolean {
        return this.defaultModelName.includes('vision');
    }

    /**
     * Checks if the Gemini provider natively supports a separate system prompt.
     * Gemini handles system instructions differently (e.g., via generationConfig or merged content),
     * so it doesn't support a separate 'system' role message in the same way as OpenAI.
     * @returns {boolean} Always false for this implementation.
     */
    supportsSystemPrompt(): boolean {
        // Gemini API supports system instructions via the 'systemInstruction' field
        // during chat creation.
        return true;
    }

    /**
     * Checks if the Gemini provider supports tool/function calling.
     * Currently not implemented for Gemini via the Google AI SDK in this way.
     * @returns {boolean} Always false for now.
     */
    supportsTools(): boolean {
        // Gemini supports function calling.
        return true;
    }
    /**
     * Maps an LLMcord ToolDefinition to a Gemini FunctionDeclaration.
     * @param tool The ToolDefinition to map.
     * @returns A FunctionDeclaration object for the Gemini API.
     * @private
     */
    private mapToolToGeminiDeclaration(tool: ToolDefinition): FunctionDeclaration {
        const mapJsonSchemaTypeToGemini = (type: string | undefined): GeminiType => {
            switch (type) {
                case 'string': return GeminiType.STRING;
                case 'number': return GeminiType.NUMBER;
                case 'integer': return GeminiType.INTEGER; // Map integer as well
                case 'boolean': return GeminiType.BOOLEAN;
                case 'array': return GeminiType.ARRAY;
                case 'object': return GeminiType.OBJECT;
                default:
                    logger.warn(`Unsupported JSON Schema type "${type}" in tool "${tool.name}". Defaulting to STRING.`);
                    return GeminiType.STRING; // Default or throw error?
            }
        };

        const properties: { [k: string]: { type: GeminiType; description?: string } } = {};
        if (tool.parameters && tool.parameters['properties']) {
            for (const [key, schema] of Object.entries(tool.parameters['properties'])) {
                if (typeof schema === 'object' && schema !== null && 'type' in schema) {
                    properties[key] = {
                        type: mapJsonSchemaTypeToGemini(schema.type as string | undefined),
                        description: schema.description,
                        // Note: Gemini's FunctionDeclaration schema doesn't explicitly support nested properties,
                        // 'items' for arrays, or complex object structures directly in the same way
                        // JSON schema does within the 'properties' definition here.
                        // We might need more complex mapping for nested structures if required later.
                    };
                }
            }
        }

        return {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: GeminiType.OBJECT,
                properties: properties,
                required: (tool.parameters?.['required'] as string[] | undefined) ?? [],
            },
        };
    }






    /**
     * Maps Gemini's internal finish reason strings to the internal `FinishReason` enum.
     * @param {GeminiInternalFinishReason} [reason] - The finish reason from the Gemini API response.
     * @returns {FinishReason} The corresponding internal finish reason.
     * @private
     */
    private mapFinishReason(reason?: GeminiInternalFinishReason): FinishReason {
        if (!reason) return 'unknown';
        switch (reason) {
            case GeminiInternalFinishReason.STOP: return 'stop';
            case GeminiInternalFinishReason.MAX_TOKENS: return 'length';
            case GeminiInternalFinishReason.SAFETY:
            case GeminiInternalFinishReason.RECITATION: return 'content_filter';
            case GeminiInternalFinishReason.OTHER:
            case GeminiInternalFinishReason.FINISH_REASON_UNSPECIFIED:
            default:
                 logger.warn(`Unhandled Gemini finish reason encountered: ${reason}. Mapping to 'unknown'.`);
                 return 'unknown';
        }
    }

    /**
     * Gets information about the configured Gemini provider.
     * @returns {Record<string, any>} An object containing provider details (name and model).
     */
     getProviderInfo(): Record<string, any> {
        return { provider: 'gemini', model: this.defaultModelName };
    }

    /**
     * Checks if the provider supports including usernames in the message history.
     * Gemini does not natively support this.
     * @returns {boolean} Always false.
     */
    supportsUsernames(): boolean {
        return false;
    }

    /**
     * Checks if the provider supports streaming responses.
     * Gemini supports streaming.
     * @returns {boolean} Always true.
     */
    supportsStreaming(): boolean {
        return true;
    }

}