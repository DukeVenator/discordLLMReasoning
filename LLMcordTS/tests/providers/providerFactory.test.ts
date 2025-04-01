// LLMcordTS/tests/providers/providerFactory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProviderFactory, ProviderInitializationError } from '@/providers/providerFactory'; // Import error class
import { Config } from '@/types/config'; // Keep type import if needed
import { OpenAIProvider } from '@/providers/openaiProvider';
import { GeminiProvider } from '@/providers/geminiProvider';
import { OllamaProvider } from '@/providers/ollamaProvider';

// Define a mutable mock config structure accessible to tests
let currentMockConfig: Partial<Config> = {};

// Mock config *before* importing ProviderFactory
vi.mock('@/core/config', () => ({
    // getConfig returns the *current* state of our mutable mock config
    getConfig: vi.fn(() => currentMockConfig),
    // Keep a simple getConfigValue for potential indirect dependencies
    getConfigValue: vi.fn((key, defaultValue) => {
        const keys = key.split('.');
        let value: any = currentMockConfig;
        try {
            for (const k of keys) {
                if (value === undefined || value === null) return defaultValue; // Handle undefined path
                value = value[k];
            }
            return value ?? defaultValue;
        } catch {
            return defaultValue;
        }
    }),
}));


// Mock the actual provider implementations
vi.mock('@/providers/openaiProvider');
vi.mock('@/providers/geminiProvider');
vi.mock('@/providers/ollamaProvider');

// Helper function createProviderConfig removed as config is now mocked globally
// const createProviderConfig = ...










describe('ProviderFactory', () => {
    let factory: ProviderFactory;

    beforeEach(() => {
        // Clear mocks before each test
        vi.clearAllMocks();
        // Reset the mock config before each test to a default state
        currentMockConfig = {
            llm: {
                defaultProvider: '', // Start with empty string to satisfy Config type
                // providers: {}, // Removed as not directly used by factory logic shown
                // Omit optional provider configs initially due to exactOptionalPropertyTypes
                // openai: undefined,
                // gemini: undefined,
                // ollama: undefined,
                // Add other llm properties if needed by Config type
            },
            // Add other top-level config sections if needed by Config type
            model: 'mock/default-model', // Add default model setting
            providers: { // Add default providers section
                mock: { apiKey: 'default_mock_key' }
            }
        };
    });

    it('should create OpenAIProvider based on model setting', () => {
        // 1. Modify the mock config for this test
        currentMockConfig.model = 'openai/gpt-test'; // Set top-level model
        // Ensure provider details exist
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            openai: { apiKey: 'test-key', baseURL: 'http://openai.test' }
        };
        // Keep llm.openai for potential provider constructor use (though factory uses top-level model)
        currentMockConfig.llm!.openai = { apiKey: 'test-key', defaultModel: 'gpt-test', baseURL: 'http://openai.test' };


        // 2. Instantiate the factory with the *current* mock config
        factory = new ProviderFactory(currentMockConfig as Config); // Cast needed as it's Partial

        // 3. Test
        const provider = factory.getDefaultProvider();
        expect(provider).toBeInstanceOf(OpenAIProvider);
        // Constructor likely takes (apiKey, modelName, baseURL)
        expect(OpenAIProvider).toHaveBeenCalledWith(
            'test-key',
            'gpt-test', // Model name comes from the top-level 'model' setting
            'http://openai.test', // baseURL comes from providers.openai
            undefined // Expect extraParams to be undefined here
        );
    });

    it('should create GeminiProvider based on model setting', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'google-gemini/gemini-test'; // Set top-level model
        // Ensure provider details exist
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            googleGemini: { apiKey: 'test-gemini-key' } // Use camelCase key
        };
        // Keep llm.gemini for potential provider constructor use
        currentMockConfig.llm!.gemini = { apiKey: 'test-key', defaultModel: 'gemini-test' };


        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        const provider = factory.getDefaultProvider();
        expect(provider).toBeInstanceOf(GeminiProvider);
        // Constructor likely takes (apiKey, modelName)
        expect(GeminiProvider).toHaveBeenCalledWith(
            'test-gemini-key', // Use the provided key
            'gemini-test', // Model name comes from the top-level 'model' setting
            undefined // Expect extraParams to be undefined here
        );
    });

    it('should create OllamaProvider based on model setting', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'ollama/ollama-test'; // Set top-level model
        // Ensure provider details exist
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            ollama: { baseURL: 'http://test' }
        };
        // Keep llm.ollama for potential provider constructor use
        currentMockConfig.llm!.ollama = { baseURL: 'http://test', defaultModel: 'ollama-test', keepAlive: '5m' };


        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        const provider = factory.getDefaultProvider();
        expect(provider).toBeInstanceOf(OllamaProvider);
        // Constructor takes (baseURL, modelName, config, keepAlive, extraParams)
        expect(OllamaProvider).toHaveBeenCalledWith(
            'http://test', // baseURL comes from providers.ollama
            'ollama-test', // Model name comes from the top-level 'model' setting
            currentMockConfig as Config, // The factory passes the config object
            '5m',    // keepAlive comes from llm.ollama (or defaults)
            undefined // Expect extraParams to be undefined here
        );
    });

    it('should throw ProviderInitializationError for unsupported provider in model setting', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'unsupported-provider/some-model'; // Set model with unsupported provider

        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        // The error message should now reflect the check based on the 'model' setting
        expect(() => factory.getDefaultProvider())
            .toThrow(new ProviderInitializationError('Unsupported or undefined LLM provider specified: "unsupported-provider".')); // Match actual error
    });

    it('should throw ProviderInitializationError if apiKey for OpenAI provider is missing', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'openai/gpt-test'; // Set model to use OpenAI
        // Ensure providers.openai exists but lacks a valid key
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            openai: { apiKey: '' } // Missing or invalid key
        };
        // Keep llm.openai for potential constructor use
        currentMockConfig.llm!.openai = { apiKey: '', defaultModel: 'gpt-test' };


        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        // The factory should check providers.openai.apiKey based on the model setting
        // Update expected error to match what the provider constructor likely throws
        expect(() => factory.getDefaultProvider())
            .toThrow(new ProviderInitializationError("OpenAI API key is missing in the configuration (llm.openai.apiKey)."));
    });

     it('should throw ProviderInitializationError if apiKey for Gemini provider is missing', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'google-gemini/gemini-test'; // Set model to use Gemini
        // Ensure providers.google-gemini exists but lacks a valid key
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            'google-gemini': { apiKey: '' } // Missing or invalid key
        };
        // Keep llm.gemini for potential constructor use
        currentMockConfig.llm!.gemini = { apiKey: '', defaultModel: 'gemini-test' };


        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        // The factory should check providers['google-gemini'].apiKey based on the model setting
        // Update expected error to match what the provider constructor likely throws
        expect(() => factory.getDefaultProvider())
            // Match the actual camelCase error message from the factory
            .toThrow(new ProviderInitializationError("Gemini API key is missing in the configuration (providers.googleGemini.apiKey)."));
    });

     it('should throw ProviderInitializationError if baseURL for Ollama provider is missing', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'ollama/ollama-test'; // Set model to use Ollama
        // Ensure providers.ollama exists but lacks a valid baseURL
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            ollama: { baseURL: '' } // Missing or invalid baseURL
        };
        // Keep llm.ollama for potential constructor use
        currentMockConfig.llm!.ollama = { baseURL: '', defaultModel: 'ollama-test' };


        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        // The factory should check providers.ollama.baseURL based on the model setting
        // Update expected error to match what the provider constructor likely throws
        expect(() => factory.getDefaultProvider())
            .toThrow(new ProviderInitializationError("Ollama base URL is missing in the configuration (llm.ollama.baseURL)."));
    });

     it('should throw ProviderInitializationError if model setting is missing or invalid', () => {
        // 1. Modify mock config - remove or invalidate the model setting
        delete currentMockConfig.model; // Remove the model setting entirely
        // Or set to invalid format: currentMockConfig.model = 'invalid-format';

        // Ensure some provider config exists to avoid other errors
        currentMockConfig.providers = { openai: { apiKey: 'test-key' } };
        currentMockConfig.llm!.openai = { apiKey: 'test-key' };

        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test
        expect(() => factory.getDefaultProvider())
            .toThrow(new ProviderInitializationError("`model` setting is missing, invalid, or not in 'provider/model' format in the configuration."));
    });

    // Test getProvider directly
    it('should get specific provider using getProvider', () => {
        // 1. Modify mock config
        currentMockConfig.model = 'openai/gpt-main'; // Set a default model for completeness
        // Ensure provider details exist in the 'providers' section
        currentMockConfig.providers = {
            ...currentMockConfig.providers,
            openai: { apiKey: 'openai-key', baseURL: 'http://oai.base' },
            googleGemini: { apiKey: 'test-gemini-key-get' } // Use camelCase key
        };
        // Keep llm sections for defaultModel lookup if needed by getProvider
        currentMockConfig.llm!.openai = { apiKey: 'openai-key', defaultModel: 'gpt-main', baseURL: 'http://oai.base' };
        currentMockConfig.llm!.gemini = { apiKey: 'test-gemini-key-get', defaultModel: 'gemini-flash' };


        // 2. Instantiate factory
        factory = new ProviderFactory(currentMockConfig as Config);

        // 3. Test getProvider('google-gemini') - Assuming 'google-gemini' is the key
        // If no model name is passed, it should use the defaultModel from llm.gemini
        const geminiProvider = factory.getProvider('google-gemini');
        expect(geminiProvider).toBeInstanceOf(GeminiProvider);
        // GeminiProvider constructor takes (apiKey, modelName)
        expect(GeminiProvider).toHaveBeenCalledWith(
            'test-gemini-key-get', // Key from providers['google-gemini']
            'gemini-flash', // Default model from llm.gemini
            undefined // Expect extraParams to be undefined here
        );

        // 4. Test getProvider('openai', 'gpt-override')
        const openaiProvider = factory.getProvider('openai', 'gpt-override');
        expect(openaiProvider).toBeInstanceOf(OpenAIProvider);
        // OpenAIProvider constructor takes (apiKey, modelName, baseURL)
        expect(OpenAIProvider).toHaveBeenCalledWith(
            'openai-key', // Key from providers.openai
            'gpt-override', // Explicit model override
            'http://oai.base', // baseURL from providers.openai
            undefined // Expect extraParams to be undefined here
        );
    });

    });

// Removed final extra closing brace