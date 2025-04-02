// LLMcordTS/tests/providers/geminiProvider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '@/providers/geminiProvider';
import { ToolDefinition } from '@/types/tools';
import { ChatMessage, GenerationOptions } from '@/providers/baseProvider';
// Removed GenerateContentStreamResult from import as it's not directly exported/used
import { Tool, Type as GeminiType, FunctionCall } from '@google/genai';

// --- Pre-define Mock Functions ---
const mockGenerateContentStreamFn = vi.fn(); // Mock for the actual stream method
// --- End Pre-defined Mock Functions ---


vi.mock('@google/genai', () => {
    // Mock for the main class constructor and its methods
    const MockGoogleGenerativeAI = vi.fn().mockImplementation(() => ({
        // Mock the 'models' property and its 'generateContentStream' method
        models: {
            generateContentStream: mockGenerateContentStreamFn,
        },
    }));

    // Return the mocked constructor and necessary enums
    return {
        GoogleGenAI: MockGoogleGenerativeAI,
        FinishReason: {
            STOP: 'STOP',
            MAX_TOKENS: 'MAX_TOKENS',
            SAFETY: 'SAFETY',
            RECITATION: 'RECITATION',
            OTHER: 'OTHER',
            FINISH_REASON_UNSPECIFIED: 'FINISH_REASON_UNSPECIFIED',
        },
        HarmCategory: {},
        HarmBlockThreshold: {},
        Type: {
            OBJECT: 'OBJECT',
            STRING: 'STRING',
            NUMBER: 'NUMBER',
            INTEGER: 'INTEGER',
            BOOLEAN: 'BOOLEAN',
            ARRAY: 'ARRAY',
        },
    };
});


describe('GeminiProvider Capability Checks', () => {
    const apiKey = 'test-api-key';

    it('should report vision support for vision-specific models', () => {
        const visionModels = ['gemini-pro-vision', 'gemini-1.5-pro-vision-latest', 'custom-vision-model'];
        visionModels.forEach(model => {
            const provider = new GeminiProvider(apiKey, model);
            expect(provider.supportsVision(), `Model ${model} should support vision`).toBe(true);
        });
    });

    it('should NOT report vision support for non-vision models', () => {
        const nonVisionModels = ['gemini-pro', 'gemini-1.0-pro', 'text-bison-001'];
        nonVisionModels.forEach(model => {
            const provider = new GeminiProvider(apiKey, model);
            expect(provider.supportsVision(), `Model ${model} should NOT support vision`).toBe(false);
        });
    });

    it('should report support for system prompts', () => {
        const provider = new GeminiProvider(apiKey, 'gemini-pro');
        expect(provider.supportsSystemPrompt()).toBe(true);
    });

    it('should report support for tools', () => {
        const provider = new GeminiProvider(apiKey, 'gemini-pro');
        expect(provider.supportsTools()).toBe(true);
    });

    it('should report NO support for usernames', () => {
        const provider = new GeminiProvider(apiKey, 'gemini-pro');
        expect(provider.supportsUsernames()).toBe(false);
    });

    it('should report support for streaming', () => {
        const provider = new GeminiProvider(apiKey, 'gemini-pro');
        expect(provider.supportsStreaming()).toBe(true);
    });

});

// --- Describe Block for generateStream ---
describe('GeminiProvider generateStream', () => {
    const apiKey = 'test-api-key';
    const modelName = 'gemini-pro-test'; // Renamed from 'model' to avoid conflict
    const messages: ChatMessage[] = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
        { role: 'user', content: 'Hello' } // Last message must be user
    ];
    const systemPrompt = 'You are a test bot.';

    // Default mock stream implementation
    const getDefaultMockStream = () => (async function* () { // Removed explicit : AsyncGenerator<GenerateContentStreamResult>
        yield { text: 'Hello ' };
        yield { text: 'World!', candidates: [{ finishReason: 'STOP' }] };
    })();

    beforeEach(() => {
        vi.clearAllMocks(); // Clear call history
        // Reset mock implementation for each test
        mockGenerateContentStreamFn.mockReset().mockResolvedValue(getDefaultMockStream());
    });

    // Helper function to consume the stream and perform common checks on the request object
    const consumeStreamAndCheckRequest = async (stream: AsyncGenerator<any>, expectedRequestProps: Record<string, any>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of stream) { /* Consume */ }

        expect(mockGenerateContentStreamFn).toHaveBeenCalledTimes(1);
        const actualRequest = mockGenerateContentStreamFn.mock.calls[0]![0];

        // Check common properties using bracket notation
        expect(actualRequest.model).toBe(expectedRequestProps['model'] ?? modelName); // Use bracket notation and updated modelName
        expect(actualRequest.contents).toEqual([ // Check mapped history
            { role: 'user', parts: [{ text: 'Previous message' }] },
            { role: 'model', parts: [{ text: 'Previous response' }] },
            { role: 'user', parts: [{ text: 'Hello' }] }, // Include last user message in contents
        ]);

        // Check systemInstruction inside the 'config' object
        if (expectedRequestProps['systemPrompt']) {
            expect(actualRequest.config?.systemInstruction).toEqual([{ text: expectedRequestProps['systemPrompt'] }]); // Check nested systemInstruction (no role needed here)
        } else {
            expect(actualRequest.config?.systemInstruction).toBeUndefined();
        }

        // Check generationConfig inside the 'config' object
        if (expectedRequestProps['generationConfig']) {
            // Check that all expected generationConfig props are present in actualRequest.config
            for (const key in expectedRequestProps['generationConfig']) {
                expect(actualRequest.config?.[key]).toEqual(expectedRequestProps['generationConfig'][key]);
            }
        } else {
            // If not expecting specific gen config, ensure the relevant keys are not in config (or config is undefined)
            expect(actualRequest.config?.temperature).toBeUndefined();
            expect(actualRequest.config?.maxOutputTokens).toBeUndefined();
            // Add checks for other potential generationConfig keys if needed
        }

        // Check tools inside the 'config' object
        if (expectedRequestProps['tools']) {
            expect(actualRequest.config?.tools).toEqual(expectedRequestProps['tools']);
        } else {
            expect(actualRequest.config?.tools).toBeUndefined();
        }

        // Check toolConfig inside the 'config' object
        if (expectedRequestProps['toolConfig']) {
            expect(actualRequest.config?.toolConfig).toEqual(expectedRequestProps['toolConfig']);
        } else {
            expect(actualRequest.config?.toolConfig).toBeUndefined();
        }
    };

    it('should call generateContentStream with mapped history and system prompt when no options are provided', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const stream = provider.generateStream(messages, systemPrompt);
        await consumeStreamAndCheckRequest(stream, { systemPrompt: systemPrompt });
    });

    it('should pass generationConfig when options are provided', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = {
            temperature: 0.6,
            maxOutputTokens: 150,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            generationConfig: { temperature: 0.6, maxOutputTokens: 150 }
        });
    });

    it('should pass only temperature in generationConfig when only temperature is provided', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = {
            temperature: 0.95,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            generationConfig: { temperature: 0.95 }
        });
    });

    it('should pass only maxOutputTokens in generationConfig when only maxOutputTokens is provided', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = {
            maxOutputTokens: 75,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            generationConfig: { maxOutputTokens: 75 }
        });
    });

    it('should handle empty messages array gracefully (yield error)', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const stream = provider.generateStream([], systemPrompt);
        const result = await stream.next();

        expect(mockGenerateContentStreamFn).not.toHaveBeenCalled();
        expect(result.value).toEqual({
            content: "Error: Message history is empty.",
            isFinal: true,
            finishReason: 'error'
        });
        expect(result.done).toBe(false);
        for await (const _ of stream) { /* Consume */ }
    });

     it('should handle history where last message is not user (yield error)', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const invalidMessages: ChatMessage[] = [
             { role: 'user', content: 'Hi' },
             { role: 'assistant', content: 'Hello there' }
        ];
        const stream = provider.generateStream(invalidMessages, systemPrompt);
        const result = await stream.next();

        expect(mockGenerateContentStreamFn).not.toHaveBeenCalled();
        expect(result.value).toEqual({
            content: "Error: Invalid final message role.",
            isFinal: true,
            finishReason: 'error'
        });
        expect(result.done).toBe(false);
        for await (const _ of stream) { /* Consume */ }
    });

    it('should pass systemInstruction when system prompt is provided', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const specificSystemPrompt = 'Be a helpful test assistant.';
        const stream = provider.generateStream(messages, specificSystemPrompt);
        await consumeStreamAndCheckRequest(stream, { systemPrompt: specificSystemPrompt });
    });

    it('should NOT pass systemInstruction when system prompt is undefined', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const stream = provider.generateStream(messages, undefined);
        await consumeStreamAndCheckRequest(stream, { systemPrompt: undefined });
    });

    // --- Tests for extraParams ---

    it('should pass extraParams from constructor to generationConfig', async () => {
        const extraParams = { topK: 40, topP: 0.9 };
        const provider = new GeminiProvider(apiKey, modelName, extraParams);
        const stream = provider.generateStream(messages, systemPrompt);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            generationConfig: { topK: 40, topP: 0.9 }
        });
    });

    it('should override extraParams with GenerationOptions', async () => {
        const extraParams = { temperature: 0.2, maxOutputTokens: 500, topK: 40 };
        const provider = new GeminiProvider(apiKey, modelName, extraParams);
        const options: GenerationOptions = {
            temperature: 0.9,
            maxOutputTokens: 150,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            generationConfig: { temperature: 0.9, maxOutputTokens: 150, topK: 40 }
        });
    });

    it('should merge extraParams and GenerationOptions', async () => {
        const extraParams = { topK: 40 };
        const provider = new GeminiProvider(apiKey, modelName, extraParams);
        const options: GenerationOptions = {
            temperature: 0.7,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            generationConfig: { temperature: 0.7, topK: 40 }
        });
    });


    it('should override the default model when model is provided in options', async () => {
        const defaultModel = 'gemini-pro-default';
        const overrideModel = 'gemini-pro-override';
        const provider = new GeminiProvider(apiKey, defaultModel);
        const options: GenerationOptions = {
            model: overrideModel,
            temperature: 0.85,
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            model: overrideModel, // Expect override model
            systemPrompt: systemPrompt,
            generationConfig: { temperature: 0.85 }
        });
    });



    // --- Tests for Tool Handling ---

    const sampleTool: ToolDefinition = {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
            type: 'object',
            properties: {
                location: { type: 'string', description: 'City and state, e.g. San Francisco, CA' },
                unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' }
            },
            required: ['location']
        }
    };

    const expectedGeminiTool: Tool = {
        functionDeclarations: [
            {
                name: 'get_weather',
                description: 'Get the current weather for a location',
                parameters: {
                    type: GeminiType.OBJECT,
                    properties: {
                        location: { type: GeminiType.STRING, description: 'City and state, e.g. San Francisco, CA' },
                        unit: { type: GeminiType.STRING, description: 'Temperature unit' }
                    },
                    required: ['location']
                }
            }
        ]
    };

    const expectedToolConfig = { functionCallingConfig: { mode: 'AUTO' } };

    it('should pass mapped tools and toolConfig when tools are provided', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = {
            tools: [sampleTool]
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            tools: [expectedGeminiTool], // Gemini expects tools as an array
            toolConfig: expectedToolConfig
        });
    });

    it('should merge generationConfig and tool options correctly', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = {
            tools: [sampleTool],
            temperature: 0.5
        };
        const stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            tools: [expectedGeminiTool],
            toolConfig: expectedToolConfig,
            generationConfig: { temperature: 0.5 }
        });
    });

    it('should yield ToolCallRequest when functionCall is received in stream', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = { tools: [sampleTool] };

        // Mock the stream to return a function call
        const mockFunctionCall: FunctionCall = {
            name: 'get_weather',
            args: { location: 'London, UK' }
        };
        mockGenerateContentStreamFn.mockResolvedValue(
            (async function* () { // Removed explicit : AsyncGenerator<GenerateContentStreamResult>
                yield { functionCalls: [mockFunctionCall] }; // Yield function call
                yield { candidates: [{ finishReason: 'STOP' }] }; // Finish
            })()
        );

        const stream = provider.generateStream(messages, systemPrompt, options);
        const yieldedChunks: any[] = [];
        for await (const chunk of stream) {
            yieldedChunks.push(chunk);
        }

        expect(mockGenerateContentStreamFn).toHaveBeenCalledTimes(1); // Ensure the mock stream was called
        expect(yieldedChunks.length).toBe(2); // Expect tool call chunk and final chunk

        // Check tool call chunk
        expect(yieldedChunks[0].content).toBeUndefined();
        expect(yieldedChunks[0].toolCalls).toBeDefined();
        expect(yieldedChunks[0].toolCalls.length).toBe(1);
        expect(yieldedChunks[0].toolCalls[0].toolName).toBe('get_weather');
        expect(yieldedChunks[0].toolCalls[0].args).toEqual({ location: 'London, UK' });
        expect(yieldedChunks[0].toolCalls[0].id).toMatch(/^gemini-tool-call-/);
        expect(yieldedChunks[0].isFinal).toBe(false);

        // Check final chunk
        expect(yieldedChunks[1].content).toBe('');
        expect(yieldedChunks[1].toolCalls).toEqual([]);
        expect(yieldedChunks[1].isFinal).toBe(true);
        expect(yieldedChunks[1].finishReason).toBe('tool_calls');
    });

    it('should handle stream with both text and function call', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        const options: GenerationOptions = { tools: [sampleTool] };

        const mockFunctionCall: FunctionCall = { name: 'get_weather', args: { location: 'Paris, FR' } };
        mockGenerateContentStreamFn.mockResolvedValue(
            (async function* () { // Removed explicit : AsyncGenerator<GenerateContentStreamResult>
                yield { text: 'Okay, looking up the weather... ' };
                yield { functionCalls: [mockFunctionCall] };
                yield { candidates: [{ finishReason: 'STOP' }] };
            })()
        );

        const stream = provider.generateStream(messages, systemPrompt, options);
        const yieldedChunks: any[] = [];
        for await (const chunk of stream) {
            yieldedChunks.push(chunk);
        }

        expect(mockGenerateContentStreamFn).toHaveBeenCalledTimes(1);
        expect(yieldedChunks.length).toBe(3); // Text chunk, tool call chunk, final chunk

        // Check text chunk
        expect(yieldedChunks[0].content).toBe('Okay, looking up the weather... ');
        expect(yieldedChunks[0].toolCalls).toBeUndefined();
        expect(yieldedChunks[0].isFinal).toBe(false);

        // Check tool call chunk
        expect(yieldedChunks[1].content).toBeUndefined();
        expect(yieldedChunks[1].toolCalls).toBeDefined();
        expect(yieldedChunks[1].toolCalls.length).toBe(1);
        expect(yieldedChunks[1].toolCalls[0].toolName).toBe('get_weather');
        expect(yieldedChunks[1].toolCalls[0].args).toEqual({ location: 'Paris, FR' });
        expect(yieldedChunks[1].isFinal).toBe(false);

        // Check final chunk
        expect(yieldedChunks[2].content).toBe('');
        expect(yieldedChunks[2].toolCalls).toEqual([]);
        expect(yieldedChunks[2].isFinal).toBe(true);
        expect(yieldedChunks[2].finishReason).toBe('tool_calls');
    });

    it('should NOT pass tools or toolConfig when tools array is empty or undefined', async () => {
        const provider = new GeminiProvider(apiKey, modelName);
        // Test with empty array
        let options: GenerationOptions = { tools: [] };
        let stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            tools: undefined, // Expect tools to be undefined
            toolConfig: undefined
        });

        // Test with undefined tools
        mockGenerateContentStreamFn.mockClear(); // Clear calls before the second scenario
        mockGenerateContentStreamFn.mockResolvedValue(getDefaultMockStream()); // Reset stream mock

        options = { temperature: 0.7 }; // No tools property
        stream = provider.generateStream(messages, systemPrompt, options);
        await consumeStreamAndCheckRequest(stream, {
            systemPrompt: systemPrompt,
            tools: undefined,
            toolConfig: undefined,
            generationConfig: { temperature: 0.7 }
        });
    });

    // Add tests for multimodal mapping if necessary
});