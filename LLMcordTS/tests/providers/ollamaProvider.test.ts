// LLMcordTS/tests/providers/ollamaProvider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '@/providers/ollamaProvider';
import { ChatMessage, GenerationOptions } from '@/providers/baseProvider'; // Import types
import { Config } from '@/types/config'; // Import Config type
import axios from 'axios';
import { Readable } from 'stream';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true); // Use deep mocking

// Helper function to create a mock stream
const createMockStream = (chunks: any[]) => {
    return new Readable({
        read() {
            chunks.forEach(chunk => this.push(JSON.stringify(chunk) + '\n'));
            this.push(null); // End the stream
        }
    });
};

describe('OllamaProvider Capability Checks', () => {
    const baseURL = 'http://localhost:11434';

    // Setup default mock implementation for axios post for capability checks if needed
    beforeEach(() => {
        mockedAxios.create.mockReturnValue(mockedAxios);
        // Provide a basic mock response for capability checks if they were to make calls
        mockedAxios.post.mockResolvedValue({
            data: createMockStream([{ response: '', done: true }]), // Simple stream for setup
            status: 200, statusText: 'OK', headers: {}, config: {},
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });


    it('should report vision support for vision-specific models when config is undefined', () => {
        const visionModels = ['llava', 'bakllava', 'llava:7b', 'custom-llava-model'];
        visionModels.forEach(model => {
            const provider = new OllamaProvider(baseURL, model, undefined); // Pass undefined config
            expect(provider.supportsVision(), `Model ${model} should support vision (config undefined)`).toBe(true);
        });
    });

    it('should NOT report vision support for non-vision models when config is undefined', () => {
        const nonVisionModels = ['llama2', 'mistral', 'codellama:7b'];
        nonVisionModels.forEach(model => {
            const provider = new OllamaProvider(baseURL, model, undefined); // Pass undefined config
            expect(provider.supportsVision(), `Model ${model} should NOT support vision (config undefined)`).toBe(false);
        });
    });

    it('should report vision support based on config flag when set to true', () => {
        // Need to provide dummy baseURL and defaultProvider to satisfy the type checker
        const config: Partial<Config> = { llm: { defaultProvider: 'ollama', ollama: { baseURL: 'http://dummy', supportsVision: true } } };
        const provider = new OllamaProvider(baseURL, 'llama2', config as Config); // Non-vision model, but config=true
        expect(provider.supportsVision(), 'Should support vision based on config=true').toBe(true);
    });

    it('should report vision support based on config flag when set to false', () => {
        // Need to provide dummy baseURL and defaultProvider to satisfy the type checker
        const config: Partial<Config> = { llm: { defaultProvider: 'ollama', ollama: { baseURL: 'http://dummy', supportsVision: false } } };
        const provider = new OllamaProvider(baseURL, 'llava', config as Config); // Vision model, but config=false
        expect(provider.supportsVision(), 'Should NOT support vision based on config=false').toBe(false);
    });

    it('should always report support for system prompts', () => {
        const provider = new OllamaProvider(baseURL, 'llama2', undefined); // Pass undefined config
        expect(provider.supportsSystemPrompt()).toBe(true);
    });

    it('should always report NO support for tools', () => {
        const provider = new OllamaProvider(baseURL, 'llama2', undefined);
        expect(provider.supportsTools()).toBe(false);
    });

    it('should always report NO support for usernames', () => {
        const provider = new OllamaProvider(baseURL, 'llama2', undefined);
        expect(provider.supportsUsernames()).toBe(false);
    });

    it('should always report support for streaming', () => {
        const provider = new OllamaProvider(baseURL, 'llama2', undefined);
        expect(provider.supportsStreaming()).toBe(true);
    });
});


// --- New Describe Block for generateStream ---
describe('OllamaProvider generateStream', () => {
    const baseURL = 'http://localhost:11434';
    const model = 'llama3-test';
    // Removed provider declaration here; it will be instantiated in each test
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hello Ollama' }];
    const systemPrompt = 'You are test bot.';
    const keepAlive = '5m';

    beforeEach(() => {
        vi.clearAllMocks();
        mockedAxios.create.mockReturnValue(mockedAxios); // Ensure axios instance is mocked
        // Setup default mock response for generateStream tests
        mockedAxios.post.mockResolvedValue({
            data: createMockStream([
                { model: model, created_at: 'now', response: 'Response ', done: false },
                { model: model, created_at: 'now', response: 'chunk.', done: true, eval_count: 10, eval_duration: 1000 }
            ]),
            status: 200, statusText: 'OK', headers: {}, config: {},
        });
        // Provider will be instantiated in each test case now
    });

    // Helper function to consume the stream
    const consumeStream = async (stream: AsyncGenerator<any>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of stream) { /* Consume */ }
    };

    it('should call axios.post with correct body (no options) when no options are provided', async () => {
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive); // Instantiate provider
        const stream = provider.generateStream(messages, systemPrompt);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                // options field should be absent
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
        // Explicitly check that options is undefined in the call arguments
        const callArgs = mockedAxios.post.mock.calls[0];
        expect(callArgs).toBeDefined(); // Assert call happened
        if (callArgs) { // Type guard
            const requestBody: any = callArgs[1];
            expect(requestBody).toBeDefined(); // Assert body exists
            expect(requestBody.options).toBeUndefined();
        }
    });

    it('should call axios.post with temperature and num_predict in options when provided', async () => {
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive); // Instantiate provider
        const options: GenerationOptions = {
            temperature: 0.7,
            maxOutputTokens: 200,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    temperature: 0.7,
                    num_predict: 200, // Mapped from maxOutputTokens
                },
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
    });

    it('should call axios.post with only temperature when only temperature is provided', async () => {
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive); // Instantiate provider
        const options: GenerationOptions = {
            temperature: 0.2,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    temperature: 0.2,
                    // num_predict should be absent
                },
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
        const callArgs = mockedAxios.post.mock.calls[0];
        expect(callArgs).toBeDefined(); // Assert call happened
        if (callArgs) { // Type guard
            const requestBody: any = callArgs[1];
            expect(requestBody).toBeDefined(); // Assert body exists
            expect(requestBody.options.num_predict).toBeUndefined();
        }
    });

     it('should call axios.post with only num_predict when only maxOutputTokens is provided', async () => {
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive); // Instantiate provider
        const options: GenerationOptions = {
            maxOutputTokens: 99,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    num_predict: 99,
                    // temperature should be absent
                },
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
        const callArgs = mockedAxios.post.mock.calls[0];
        expect(callArgs).toBeDefined(); // Assert call happened
        if (callArgs) { // Type guard
            const requestBody: any = callArgs[1];
            expect(requestBody).toBeDefined(); // Assert body exists
            expect(requestBody.options.temperature).toBeUndefined();
        }
    });

    it('should handle empty messages array gracefully', async () => {
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive); // Instantiate provider
        const stream = provider.generateStream([], systemPrompt);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [{ role: 'system', content: systemPrompt }], // Only system prompt
                stream: true,
                keep_alive: keepAlive,
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
    });

    it('should handle messages without system prompt', async () => {
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive); // Instantiate provider
        const stream = provider.generateStream(messages); // No system prompt
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [{ role: 'user', content: 'Hello Ollama' }], // Only user message
                stream: true,
                keep_alive: keepAlive,
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
    });

    // --- Tests for extraParams ---

    it('should pass extraParams from constructor to requestBody.options', async () => {
        const extraParams = { mirostat: 1, num_ctx: 4096 };
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive, extraParams); // Instantiate with extraParams
        const stream = provider.generateStream(messages, systemPrompt);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    mirostat: 1, // From extraParams
                    num_ctx: 4096, // From extraParams
                },
            },
            // Check that the third argument is an object containing the signal property
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
    });

    it('should override extraParams with GenerationOptions', async () => {
        const extraParams = { temperature: 0.2, num_predict: 500, mirostat: 1 };
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive, extraParams); // Instantiate with extraParams
        const options: GenerationOptions = {
            temperature: 0.9, // Override extraParams.temperature
            maxOutputTokens: 150, // Override extraParams.num_predict (via maxOutputTokens)
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    temperature: 0.9, // From options (overrides extraParams)
                    num_predict: 150,  // From options (overrides extraParams)
                    mirostat: 1, // From extraParams (not overridden)
                },
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() }) // Use expect.anything()
        );
    });

    it('should merge extraParams and GenerationOptions', async () => {
        const extraParams = { mirostat: 1 };
        const provider = new OllamaProvider(baseURL, model, undefined, keepAlive, extraParams); // Instantiate with extraParams
        const options: GenerationOptions = {
            temperature: 0.7,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    temperature: 0.7, // From options
                    mirostat: 1, // From extraParams
                },
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() }) // Use expect.anything()
        );
    });


    it('should override the default model when model is provided in options', async () => {
        const defaultModel = 'llama2-default';
        const overrideModel = 'mistral-override';
        const provider = new OllamaProvider(baseURL, defaultModel, undefined, keepAlive); // Instantiate with default model
        const options: GenerationOptions = {
            model: overrideModel, // Provide override model in options
            temperature: 0.8,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStream(stream);

        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            '/api/chat',
            {
                model: overrideModel, // Expect the override model to be used
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Hello Ollama' },
                ],
                stream: true,
                keep_alive: keepAlive,
                options: {
                    temperature: 0.8, // Other options should still be passed
                },
            },
            expect.objectContaining({ responseType: 'stream', signal: expect.anything() })
        );
    });


    // Add tests for multimodal mapping if necessary
});