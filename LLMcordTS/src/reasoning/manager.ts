/**
 * @fileoverview Manages the multi-model reasoning process.
 * Detects signals for reasoning, handles rate limiting, and orchestrates calls
 * to a secondary (potentially more powerful) LLM provider.
 */
import { Config } from '@/types/config';
import { LLMCordBot } from '@/core/LLMCordBot';
import { logger } from '@/core/logger'; // Import shared logger instance
import { RateLimiter } from '@/utils/rateLimiter';
import { ProviderFactory } from '@/providers/providerFactory'; // Added
import { ChatMessage } from '@/providers/baseProvider'; // Added
import { BaseProvider } from '@/providers/baseProvider'; // Removed ProviderError import

// Placeholder for the actual reasoning response structure
interface ReasoningResult {
    shouldProcess: boolean;
    reasoningText?: string; // Optional: The raw text from the reasoning model
    finalResponse?: string; // The final response to send to the user
    error?: string; // Optional error message
}

/**
 * Manages the optional multi-model reasoning feature.
 * If enabled, it can detect signals in a primary LLM's response to trigger
 * a call to a secondary, potentially more powerful, reasoning LLM.
 */
export class ReasoningManager {
    private config: Config['reasoning'];
    private botConfig: Config; // Store the full bot config
    private rateLimiter: RateLimiter | null = null;
    private providerFactory: ProviderFactory; // Added

    /**
     * Creates an instance of ReasoningManager.
     * @param {LLMCordBot} bot - The main bot instance, used to access configuration.
     * @param {ProviderFactory} providerFactory - Factory to create LLM provider instances. // Added
     */
    constructor(bot: LLMCordBot, providerFactory: ProviderFactory) { // Added providerFactory
        this.config = bot.config.reasoning;
        this.botConfig = bot.config; // Store the full config
        this.providerFactory = providerFactory; // Added

        if (this.isEnabled() && bot.config.reasoning?.rateLimit) {
            this.rateLimiter = new RateLimiter(bot.config);
            logger.info('Reasoning rate limiter initialized.');
        }
        logger.info(`Reasoning Manager initialized. Enabled: ${this.isEnabled()}`);
    }

    /**
     * Checks if the reasoning feature is enabled in the configuration.
     * @returns {boolean} True if reasoning is enabled, false otherwise.
     */
    public isEnabled(): boolean {
        return !!this.config?.enabled;
    }

    /**
     * Checks if the initial LLM response text contains a reasoning signal.
     * Note: This currently uses a simple placeholder check for `[REASONING_REQUEST]`.
     * @param {string} responseText - The initial response text from the primary LLM.
     * @returns {boolean} True if a reasoning signal is detected, false otherwise.
     */
    public checkResponseForSignal(responseText: string): boolean {
        // Note: Using placeholder signal detection logic.
        const signalDetected = responseText.includes(this.config?.signalStart ?? '[REASONING_REQUEST]'); // Use configured signal
        if (signalDetected) {
            logger.debug('Reasoning signal detected in response.');
        }
        return signalDetected;
    }

    /**
     * Extracts the reasoning signal/prompt from the response text.
     * Uses configured start and end signals if available.
     * @param {string} responseText - The initial response text containing the signal.
     * @returns {string | null} The extracted signal text, or null if no signal is found.
     */
    public getReasoningSignal(responseText: string): string | null {
        const startSignal = this.config?.signalStart ?? '[REASONING_REQUEST]';
        const endSignal = this.config?.signalEnd ?? '[/REASONING_REQUEST]';
        // Escape special regex characters in signals
        const escapedStart = startSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedEnd = endSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'i');

        const match = responseText.match(regex);
        return match && match[1] ? match[1].trim() : null;
    }

     /**
     * Checks if the user associated with the interaction is rate-limited for reasoning requests.
     * Uses the dedicated reasoning rate limiter if configured.
     * @param {string} userId - The Discord user ID.
     * @returns {boolean} True if the user is currently rate-limited (request should be blocked), false otherwise.
     */
    public checkRateLimit(userId: string): boolean {
        if (!this.rateLimiter) {
            return false; // Not rate-limited if limiter is not configured
        }
        const [allowRequest, reason] = this.rateLimiter.checkReasoningRateLimit(userId);

        if (!allowRequest) {
            logger.warn(`Reasoning request rate limited for user ${userId}. Reason: ${reason}`);
            return true; // User *is* rate-limited
        }

        return false; // User is *not* rate-limited
    }

    /**
     * Generates a response using a secondary reasoning LLM call.
     * @param {ChatMessage[]} originalHistory - The original message history leading up to the reasoning request.
     * @param {string} reasoningSignal - The extracted signal/prompt for reasoning.
     * @param {string} userId - The ID of the user initiating the request (for provider selection).
     * @returns {Promise<ReasoningResult>} A promise resolving to the reasoning result.
     */
    public async generateReasoningResponse(
        originalHistory: ChatMessage[],
        reasoningSignal: string,
        userId: string
    ): Promise<ReasoningResult> {
        logger.info(`Generating reasoning response for signal: ${reasoningSignal.substring(0, 50)}...`);

        const modelName = this.config?.reasoningModel;
        if (!modelName) {
            logger.error('Reasoning model name is not configured.');
            return { shouldProcess: false, error: 'Reasoning model not configured.' };
        }

        let provider: BaseProvider;
        try {
            // Use the userId to potentially select a user-specific provider configuration if needed in the future
            provider = this.providerFactory.getProvider(modelName, userId);
        } catch (error) {
            logger.error(`Failed to get reasoning provider '${modelName}': ${error}`);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { shouldProcess: false, error: `Failed to create reasoning provider: ${errorMessage}` };
        }

        // --- History Modification ---
        let modifiedHistory = [...originalHistory]; // Start with a copy
        const strategy = this.config?.historyModificationStrategy ?? 'keep_all';
        const maxLength = this.config?.maxHistoryLength;

        if (strategy === 'truncate' && maxLength && maxLength > 0) {
            // Keep the last `maxLength` user/assistant pairs + any leading system message
            let systemMessage: ChatMessage | null = null;
            // Explicitly check length first, then safely access the element and its role
            if (modifiedHistory.length > 0) {
                const firstMessage = modifiedHistory[0];
                if (firstMessage && firstMessage.role === 'system') {
                    systemMessage = modifiedHistory.shift()!; // Remove system message temporarily
                }
            }

            const messagesToKeep = maxLength * 2; // Each pair is 2 messages
            if (modifiedHistory.length > messagesToKeep) {
                modifiedHistory = modifiedHistory.slice(-messagesToKeep);
                logger.debug(`Reasoning history truncated to last ${maxLength} pairs.`);
            }

            // Add system message back if it existed
            if (systemMessage) {
                modifiedHistory.unshift(systemMessage);
            }
        } else if (strategy !== 'keep_all') {
            logger.warn(`Unknown reasoning history modification strategy: ${strategy}. Defaulting to 'keep_all'.`);
        }
        // --- End History Modification ---


        // Prepare final history: Add the reasoning signal as a user message to the modified history
        // TODO: Consider if the signal should replace the last assistant message or be appended. Appending for now.
        const reasoningHistory: ChatMessage[] = [
            ...modifiedHistory,
            { role: 'user', content: reasoningSignal },
        ];

        // --- Assemble System Prompt ---
        const promptParts: string[] = [];
        const includeDefault = this.config?.includeDefaultPrompt ?? true; // Default to true if undefined

        if (includeDefault) {
            const defaultPrompt = this.botConfig.llm?.defaultSystemPrompt;
            if (defaultPrompt) {
                promptParts.push(defaultPrompt);
            }
        }

        const extraInstructions = this.config?.extraInstructions;
        if (extraInstructions && extraInstructions.trim().length > 0) {
            promptParts.push(extraInstructions);
        } else if (!extraInstructions || extraInstructions.trim().length === 0) {
            // Add hardcoded default only if extraInstructions are explicitly missing or empty
            promptParts.push("You are an advanced reasoning model. Analyze the request carefully and provide a comprehensive, step-by-step response.");
        }

        // Combine parts, ensuring undefined if no parts were added
        const systemPrompt = promptParts.length > 0 ? promptParts.join('\n\n') : undefined;
        logger.debug(`Assembled reasoning system prompt: ${systemPrompt ? systemPrompt.substring(0, 100) + '...' : 'None'}`);
        // --- End Assemble System Prompt ---

        // Prepare generation parameters: Use reasoning-specific or default
        const generationParams = this.config?.generationParams ?? {}; // Use reasoning config params

        try {
            // Pass generationParams as the third argument (options)
            const stream = provider.generateStream(reasoningHistory, systemPrompt, generationParams);
            let accumulatedResponse = '';
            for await (const chunk of stream) {
                accumulatedResponse += chunk;
            }

            logger.info(`Reasoning response generated successfully. Length: ${accumulatedResponse.length}`);

            // --- Response Processing ---
            // Basic processing: Remove the reasoning request tags from the response.
            const startSignal = this.config?.signalStart ?? '[REASONING_REQUEST]';
            const endSignal = this.config?.signalEnd ?? '[/REASONING_REQUEST]';
            // Escape special regex characters in signals
            const escapedStart = startSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedEnd = endSignal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const stripRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'gi');

            const finalResponse = accumulatedResponse.replace(stripRegex, '').trim();
            logger.debug(`Reasoning response processed (tags stripped). Final length: ${finalResponse.length}`);
            // --- End Response Processing ---

            return {
                shouldProcess: true,
                reasoningText: accumulatedResponse, // Raw response from reasoning model
                finalResponse: finalResponse, // Processed response
            };
        } catch (error) {
            logger.error(`Error during reasoning LLM call: ${error}`);
            let errorMessage = 'An unknown error occurred during the reasoning process.';
            // Check if error is an instance of Error before accessing message
            if (error instanceof Error) {
                // We don't have ProviderError defined, so just use a generic message
                errorMessage = `Reasoning process error: ${error.message}`;
            }
            return {
                shouldProcess: false, // Indicate failure
                error: errorMessage,
            };
        }
    }
}