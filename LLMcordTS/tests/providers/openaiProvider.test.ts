// LLMcordTS/tests/providers/openaiProvider.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'; // Add beforeEach and beforeAll
import { OpenAIProvider } from '@/providers/openaiProvider';
import { ChatMessage, GenerationOptions } from '@/providers/baseProvider'; // Import GenerationOptions
// Removed unused import: import OpenAI from 'openai';

// Declare mock function in outer scope for test access
let mockCreateFn: ReturnType<typeof vi.fn>;
vi.mock('openai', () => {
    // Define mocks *inside* the factory to handle hoisting
    const mockStream = {
        [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: 'Hello ' } }] };
            yield { choices: [{ delta: { content: 'World!' }, finish_reason: 'stop' }] };
        }
    };
    // Define a local mock function first
    const localMockCreateFn = vi.fn().mockResolvedValue(mockStream);
    // Use the *local* mock function within the factory structure
    const mockCompletions = {
        create: localMockCreateFn, // Use local variable here
    };
    const mockChat = {
        completions: mockCompletions,
    };
    const MockOpenAI = vi.fn().mockImplementation(() => ({
        chat: mockChat,
        baseURL: 'mock-url',
    }));
    return { default: MockOpenAI };
});



beforeAll(async () => {
  // Dynamically import the mocked module *after* vi.mock has run
  const OpenAI = (await import('openai')).default;
  // Retrieve the actual mock function instance created within the factory
  const mockInstance = new OpenAI(); // Instantiate the mock class
  mockCreateFn = mockInstance.chat.completions.create as ReturnType<typeof vi.fn>;
});

describe('OpenAIProvider Capability Checks', () => {
    // ... (existing capability tests remain unchanged) ...
    const apiKey = 'test-api-key';
    const defaultModel = 'gpt-4-test'; // Use a consistent model for general tests

    it('should always report support for vision', () => {
        // Test with a couple of different model names to ensure it's always true
        const models = ['gpt-4-vision-preview', 'gpt-3.5-turbo', defaultModel];
        models.forEach(model => {
            const provider = new OpenAIProvider(apiKey, model);
            expect(provider.supportsVision(), `Model ${model} should report vision support`).toBe(true);
        });
    });

    it('should always report support for system prompts', () => {
        const provider = new OpenAIProvider(apiKey, 'gpt-4');
        expect(provider.supportsSystemPrompt()).toBe(true);
    });

    it('should always report support for tools', () => {
        const provider = new OpenAIProvider(apiKey, defaultModel);
        expect(provider.supportsTools()).toBe(true);
    });

    it('should always report support for usernames', () => {
        const provider = new OpenAIProvider(apiKey, defaultModel);
        expect(provider.supportsUsernames()).toBe(true);
    });

    it('should always report support for streaming', () => {
        const provider = new OpenAIProvider(apiKey, defaultModel);
        expect(provider.supportsStreaming()).toBe(true);
    });

});

// --- New Describe Block for generateStream ---
describe('OpenAIProvider generateStream', () => {
    const apiKey = 'test-api-key';
    const model = 'gpt-4-test';
    // Removed provider declaration here; it will be instantiated in each test
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];
    const systemPrompt = 'You are a test bot.';

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();
        // Provider will be instantiated in each test case now
    });

    // Helper function to consume the stream
    const consumeStream = async (stream: AsyncGenerator<any>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of stream) { /* Consume */ }
    };

    it('should call OpenAI completions.create with default parameters when no options are provided', async () => {
        const provider = new OpenAIProvider(apiKey, model); // Instantiate provider
        const stream = provider.generateStream(messages, systemPrompt);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: null, // Expect null when undefined
            max_tokens: null,  // Expect null when undefined
        });
    });

    it('should pass temperature and max_tokens to completions.create when provided in options', async () => {
        const provider = new OpenAIProvider(apiKey, model); // Instantiate provider
        const options: GenerationOptions = {
            temperature: 0.5,
            maxOutputTokens: 100,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: 0.5,
            max_tokens: 100,
        });
    });

    it('should pass only temperature when only temperature is provided', async () => {
        const provider = new OpenAIProvider(apiKey, model); // Instantiate provider
        const options: GenerationOptions = {
            temperature: 0.9,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: 0.9,
            max_tokens: null, // Expect null when undefined
        });
    });

    it('should pass only max_tokens when only maxOutputTokens is provided', async () => {
        const provider = new OpenAIProvider(apiKey, model); // Instantiate provider
        const options: GenerationOptions = {
            maxOutputTokens: 50,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: null, // Expect null when undefined
            max_tokens: 50,
        });
    });

     it('should handle empty messages array gracefully', async () => {
        const provider = new OpenAIProvider(apiKey, model); // Instantiate provider
        const stream = provider.generateStream([], systemPrompt);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [{ role: 'system', content: systemPrompt }], // Only system prompt
            stream: true,
            temperature: null,
            max_tokens: null,
        });
    });

    it('should handle messages without system prompt', async () => {
        const provider = new OpenAIProvider(apiKey, model); // Instantiate provider
        const stream = provider.generateStream(messages); // No system prompt
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [{ role: 'user', content: 'Hello' }], // Only user message
            stream: true,
            temperature: null,
            max_tokens: null,
        });
    });


    it('should pass extraParams from constructor to completions.create', async () => {
        const extraParams = { frequency_penalty: 0.5, presence_penalty: 0.2 };
        const provider = new OpenAIProvider(apiKey, model, undefined, extraParams); // Instantiate with extraParams
        const stream = provider.generateStream(messages, systemPrompt);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: null, // Default
            max_tokens: null,  // Default
            frequency_penalty: 0.5, // From extraParams
            presence_penalty: 0.2,  // From extraParams
        });
    });

    it('should override extraParams with GenerationOptions', async () => {
        const extraParams = { temperature: 0.2, max_tokens: 500, frequency_penalty: 0.5 };
        const provider = new OpenAIProvider(apiKey, model, undefined, extraParams); // Instantiate with extraParams
        const options: GenerationOptions = {
            temperature: 0.9, // Override extraParams.temperature
            maxOutputTokens: 150, // Override extraParams.max_tokens (via maxOutputTokens)
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: 0.9, // From options (overrides extraParams)
            max_tokens: 150,  // From options (overrides extraParams)
            frequency_penalty: 0.5, // From extraParams (not overridden)
        });
    });

    it('should merge extraParams and GenerationOptions', async () => {
        const extraParams = { frequency_penalty: 0.5 };
        const provider = new OpenAIProvider(apiKey, model, undefined, extraParams); // Instantiate with extraParams
        const options: GenerationOptions = {
            temperature: 0.7,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: 0.7, // From options
            max_tokens: null,  // Default
            frequency_penalty: 0.5, // From extraParams
        });
    });


    it('should override the default model when model is provided in options', async () => {
        const defaultModel = 'gpt-4-default';
        const overrideModel = 'gpt-4-override';
        const provider = new OpenAIProvider(apiKey, defaultModel); // Instantiate with default model
        const options: GenerationOptions = {
            model: overrideModel, // Provide override model in options
            temperature: 0.6,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockCreateFn).toHaveBeenCalledTimes(1);
        expect(mockCreateFn).toHaveBeenCalledWith({
            model: overrideModel, // Expect the override model to be used
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Hello' },
            ],
            stream: true,
            temperature: 0.6, // Other options should still be passed
            max_tokens: null,
        });
    });

    // Add more tests for multimodal content mapping if necessary
});