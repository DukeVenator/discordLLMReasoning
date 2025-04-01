/**
 * @fileoverview Factory class for creating LLM provider instances based on configuration.
 */
// LLMcordTS/src/providers/providerFactory.ts
import _ from 'lodash';
import { Config } from '../types/config';
import { BaseProvider } from './baseProvider'; // Removed unused ChatMessage, StreamChunk
import { OpenAIProvider } from './openaiProvider';
import { GeminiProvider } from './geminiProvider';
import { OllamaProvider } from './ollamaProvider';
import { logger } from '@/core/logger'; // Import shared logger instance

/**
 * Custom error class for provider instantiation issues.
 */
export class ProviderInitializationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProviderInitializationError';
    }
}

/**
 * Factory responsible for creating instances of LLM providers (`BaseProvider`)
 * based on the loaded application configuration.
 */
export class ProviderFactory {
    private config: Config;

    /**
     * Creates an instance of ProviderFactory.
     * @param {Config} config - The loaded application configuration object.
     */
    constructor(config: Config) {
        this.config = config;
        logger.info('ProviderFactory initialized.');
    }

    /**
     * Creates and returns an instance of the specified LLM provider and model.
     *
     * Validates that necessary configuration (like API keys or base URLs) exists for the chosen provider.
     * Instantiates the corresponding provider class (OpenAIProvider, GeminiProvider, OllamaProvider).
     *
     * @param {string} providerIdentifier - The name of the provider (e.g., 'openai', 'gemini', 'ollama').
     * @param {string} [modelName] - The specific model name to use. Falls back to provider defaults if not provided.
     * @param {string} [userId] - Optional user ID, currently unused but available for future user-specific logic.
     * @returns {BaseProvider} An instance of the configured LLM provider.
     * @throws {ProviderInitializationError} If the provider is unsupported or lacks required configuration.
     */
    public getProvider(providerIdentifier: string, modelName?: string, userId?: string): BaseProvider {
        const providerName = providerIdentifier.toLowerCase(); // Normalize
        let effectiveModelName = modelName;

        logger.debug(`Attempting to get provider: ${providerName}, model: ${modelName ?? 'default'}, user: ${userId ?? 'N/A'}`);

        // Determine modelName based on the provider if not explicitly passed
        if (!effectiveModelName) {
             switch (providerName) {
                case 'openai':
                    effectiveModelName = this.config.llm.openai?.defaultModel;
                    break;
                case 'gemini':
                case 'google': // Allow 'google' as an alias
                case 'google-gemini': // Add specific provider name from config
                    effectiveModelName = this.config.llm.gemini?.defaultModel;
                    break;
                case 'ollama':
                    effectiveModelName = this.config.llm.ollama?.defaultModel;
                    break;
                default:
                    // Attempt to find a defaultModel even for custom providers
                    if (providerName in this.config.llm) {
                        effectiveModelName = (this.config.llm as any)[providerName]?.defaultModel;
                    }
            }
            if (!effectiveModelName) {
                 logger.warn(`No default model specified or found for provider "${providerName}". Using 'default' placeholder.`);
                 effectiveModelName = 'default'; // Use placeholder if no default found
            } else {
                logger.debug(`Using default model "${effectiveModelName}" for provider "${providerName}".`);
            }
        }


        // Instantiate based on providerName
        switch (providerName) {
            case 'openai':
                if (!this.config.llm.openai?.apiKey) {
                    throw new ProviderInitializationError("OpenAI API key is missing in the configuration (llm.openai.apiKey).");
                }
                return new OpenAIProvider(
                    this.config.llm.openai.apiKey,
                    effectiveModelName,
                    this.config.llm.openai.baseURL, // Pass baseURL if provided
                    this.config.llm.openai.extraParams // Pass extraParams if provided
                );

            case 'gemini':
            case 'google': // Allow 'google' as an alias
            case 'google-gemini': // Add specific provider name from config
                // Fetch API key using the camelCased key: providers.googleGemini.apiKey
                const camelCaseProviderName = _.camelCase(providerName); // Ensure we use camelCase
                const geminiApiKey = this.config.providers?.[camelCaseProviderName as keyof typeof this.config.providers]?.apiKey;
                if (!geminiApiKey) {
                    // Update error message to reflect the expected camelCase key path
                    throw new ProviderInitializationError(`Gemini API key is missing in the configuration (providers.${camelCaseProviderName}.apiKey).`);
                }
                return new GeminiProvider(
                    geminiApiKey,
                    effectiveModelName,
                    this.config.llm.gemini?.extraParams // Pass extraParams if provided
                );

            case 'ollama':
                if (!this.config.llm.ollama?.baseURL) {
                    throw new ProviderInitializationError("Ollama base URL is missing in the configuration (llm.ollama.baseURL).");
                }
                return new OllamaProvider(
                    this.config.llm.ollama.baseURL,
                    effectiveModelName,
                    this.config, // Pass the full config object
                    this.config.llm.ollama.keepAlive, // Pass keepAlive
                    this.config.llm.ollama.extraParams // Pass extraParams if provided
                );

            default:
                 // Check if it's a configured custom provider section
                 if (providerName in this.config.llm) {
                     // Basic check for some common config fields for custom providers
                     // This part might need more robust handling depending on expected custom provider structures
                     const customProviderConfig = (this.config.llm as any)[providerName];
                     if (!customProviderConfig?.apiKey && !customProviderConfig?.baseURL) {
                         logger.warn(`Custom provider "${providerName}" configuration seems incomplete (missing apiKey or baseURL).`);
                         // Depending on requirements, might throw an error or proceed cautiously
                     }
                     // Placeholder: Returning a generic error as we don't know how to instantiate custom providers yet
                     // TODO: Implement dynamic loading or specific handling for known custom providers if needed
                     throw new ProviderInitializationError(`Instantiation logic for custom provider "${providerName}" is not implemented.`);

                 } else {
                    throw new ProviderInitializationError(`Unsupported or undefined LLM provider specified: "${providerName}".`);
                 }
        }
    }

     /**
      * Creates and returns an instance of the configured default LLM provider.
      * Convenience method using getProvider.
      *
      * @returns {BaseProvider} An instance of the configured default LLM provider.
      * @throws {ProviderInitializationError} If the default provider is not specified, unsupported, or lacks required configuration.
      */
     public getDefaultProvider(): BaseProvider {
         const modelSetting = this.config.model; // Get the main model setting, e.g., "google-gemini/gemini-2.0-flash"
         if (!modelSetting || typeof modelSetting !== 'string' || !modelSetting.includes('/')) {
             throw new ProviderInitializationError("`model` setting is missing, invalid, or not in 'provider/model' format in the configuration.");
         }
         const parts = modelSetting.split('/', 2);
         const providerName = parts[0];
         const modelName = parts[1]; // Get the second part

         // Add an explicit check, although the includes('/') check should guarantee this
         if (modelName === undefined) {
              throw new ProviderInitializationError(`Failed to parse model name from 'model' setting: '${modelSetting}'.`);
         }
         // Add explicit check for providerName to potentially help TS inference
         if (providerName === undefined) {
              throw new ProviderInitializationError(`Failed to parse provider name from 'model' setting: '${modelSetting}'.`);
         }

         logger.debug(`Default provider/model from config.model: ${providerName}/${modelName}`);
         // Pass both provider and model name explicitly (modelName is now guaranteed string)
         return this.getProvider(providerName, modelName);
     }
}