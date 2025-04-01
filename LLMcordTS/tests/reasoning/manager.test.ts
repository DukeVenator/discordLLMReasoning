import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReasoningManager } from '@/reasoning/manager';
import { LLMCordBot } from '@/core/LLMCordBot';
import { ProviderFactory } from '@/providers/providerFactory';
import { BaseProvider, ChatMessage } from '@/providers/baseProvider';
import { Config, DefaultConfig } from '@/types/config';
import { merge } from 'lodash';
import { logger } from '@/core/logger';

// Mock the logger
vi.mock('@/core/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Mock ProviderFactory and BaseProvider
// BaseProvider is an interface, so we implement it
class MockProvider implements BaseProvider {
    providerName = 'mock'; // Add required property from interface
    config = {} as any; // Add required property from interface
    capabilities = { vision: false, functions: false, systemPrompt: true }; // Add required property
    // Implement capability flags as methods returning boolean
    supportsVision(): boolean { return this.capabilities.vision; }
    supportsTools(): boolean { return this.capabilities.functions; }
    supportsSystemPrompt(): boolean { return this.capabilities.systemPrompt; }

    // Added missing methods from BaseProvider
    supportsUsernames(): boolean { return false; } // Mock implementation
    supportsStreaming(): boolean { return true; } // Mock implementation


    constructor() { // Constructor takes no arguments
        // No-op or minimal setup if needed
    }

    generateStream = vi.fn();
    getCapabilities = vi.fn().mockReturnValue(this.capabilities); // Example capabilities

    // Add other required methods/properties from BaseProvider if necessary, mocking them
    async generateResponse(history: ChatMessage[], systemPrompt?: string | undefined, options?: Record<string, any> | undefined): Promise<string> {
        // Simple mock implementation
        let response = '';
        const stream = this.generateStream(history, systemPrompt, options);
        // Check if stream is actually iterable (might be mocked differently)
        if (typeof stream[Symbol.asyncIterator] === 'function') {
             for await (const chunk of stream) {
                response += chunk;
            }
        } else {
            // Handle cases where generateStream mock doesn't return an async iterator
            console.warn("Mock generateStream did not return an async iterator in generateResponse mock.");
        }

        return response;
    }
}

const mockProviderInstance = new MockProvider(); // No arguments needed for constructor
const mockProviderFactory = {
    getProvider: vi.fn().mockReturnValue(mockProviderInstance),
} as unknown as ProviderFactory;

// Helper to create a mock bot with specific config
const createMockBot = (partialConfig: DefaultConfig): LLMCordBot => {
    const baseConfig: Config = {
        discord: { token: 'test-token', clientId: 'test-client' },
        llm: { defaultProvider: 'mock', defaultSystemPrompt: "Default bot system prompt." }, // Added defaultSystemPrompt here for consistency
        memory: { enabled: false, storageType: 'sqlite', sqlite: { path: ':memory:' } },
        logging: { level: 'info' },
        model: 'mock/model', // model is a top-level property
        permissions: {},
        rateLimit: { user: { intervalSeconds: 60, maxCalls: 5 } },
        // Add other required base config fields if necessary
    };
    // Deep merge partial config into base config
    const mergedConfig = merge({}, baseConfig, partialConfig);

    // Ensure 'model' is not present inside 'llm' after merge, only at top level
    if (mergedConfig.llm && 'model' in mergedConfig.llm) {
        delete (mergedConfig.llm as any).model;
    }

    // Explicitly remove defaultSystemPrompt if it wasn't provided in the partial config's llm section
    if (partialConfig.llm && !('defaultSystemPrompt' in partialConfig.llm) && mergedConfig.llm) {
        delete mergedConfig.llm.defaultSystemPrompt;
    }


    return { config: mergedConfig } as LLMCordBot;
};

describe('ReasoningManager', () => {
    let bot: LLMCordBot;
    let reasoningManager: ReasoningManager;
    const defaultReasoningInstruction = 'You are an advanced reasoning model. Analyze the request carefully and provide a comprehensive, step-by-step response.';

    beforeEach(() => {
        vi.clearAllMocks();

        // Explicitly reset mocks that might be reassigned in tests
        mockProviderFactory.getProvider = vi.fn().mockReturnValue(mockProviderInstance);
        mockProviderInstance.generateStream.mockImplementation(async function* () { // Reset stream mock too
            yield 'Reasoning ';
            yield 'response.';
        });


        // Default bot config for most tests
        bot = createMockBot({
            reasoning: {
                enabled: true,
                reasoningModel: 'mock/reasoning-model',
                provider: 'mock', // Ensure provider is specified if needed by factory logic
            },
        });
        reasoningManager = new ReasoningManager(bot, mockProviderFactory);

        // Mock stream generator
        mockProviderInstance.generateStream.mockImplementation(async function* () {
            yield 'Reasoning ';
            yield 'response.';
        });
    });

    it('should initialize correctly when enabled', () => {
        expect(reasoningManager.isEnabled()).toBe(true);
        expect(logger.info).toHaveBeenCalledWith('Reasoning Manager initialized. Enabled: true');
    });

    it('should initialize correctly when disabled', () => {
        bot = createMockBot({ reasoning: { enabled: false } });
        reasoningManager = new ReasoningManager(bot, mockProviderFactory);
        expect(reasoningManager.isEnabled()).toBe(false);
        expect(logger.info).toHaveBeenCalledWith('Reasoning Manager initialized. Enabled: false');
    });

    describe('generateReasoningResponse', () => {
        const originalHistory: ChatMessage[] = [
            { role: 'system', content: 'System prompt.' },
            { role: 'user', content: 'User message 1' },
            { role: 'assistant', content: 'Assistant response 1' },
            { role: 'user', content: 'User message 2' },
            { role: 'assistant', content: 'Assistant response 2 [REASONING_REQUEST]Signal[/REASONING_REQUEST]' },
        ];
        const reasoningSignal = 'Signal';
        const userId = 'user123';

        it('should pass correct generation parameters to the provider', async () => {
            bot = createMockBot({
                // llm.defaultSystemPrompt is set in base createMockBot
                reasoning: {
                    enabled: true,
                    reasoningModel: 'mock/reasoning-model',
                    generationParams: {
                        temperature: 0.9,
                        maxOutputTokens: 150,
                        customParam: 'value',
                    },
                    // Uses default includeDefaultPrompt: true, extraInstructions: undefined
                },
            });
            reasoningManager = new ReasoningManager(bot, mockProviderFactory);

            await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            expect(mockProviderFactory.getProvider).toHaveBeenCalledWith('mock/reasoning-model', userId);
            // Expect the default combined prompt (bot default + reasoning default)
            const expectedPrompt = `${bot.config.llm?.defaultSystemPrompt}\n\n${defaultReasoningInstruction}`;
            expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(
                expect.any(Array), // History check is separate
                expectedPrompt, // Check combined system prompt
                { temperature: 0.9, maxOutputTokens: 150, customParam: 'value' } // Check generation params
            );
        });

        // Rewritten test: Checks extraInstructions combined with default bot prompt
        it('should use extraInstructions when provided (and default bot prompt)', async () => {
            const specificInstructions = "Use bullet points.";
            bot = createMockBot({
                 llm: { defaultSystemPrompt: 'Default bot prompt.' }, // Ensure default bot prompt is set
                 reasoning: {
                    enabled: true,
                    reasoningModel: 'mock/reasoning-model',
                    includeDefaultPrompt: true, // Include bot prompt
                    extraInstructions: specificInstructions, // Use extra instructions
                },
            });
            reasoningManager = new ReasoningManager(bot, mockProviderFactory);

            await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            const expectedPrompt = `Default bot prompt.\n\n${specificInstructions}`;
            expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(
                expect.any(Array),
                expectedPrompt, // Check combined system prompt
                {} // Default generation params
            );
        });

        it('should handle history modification strategy: keep_all (default)', async () => {
            // Bot uses default config from beforeEach, which includes defaultSystemPrompt
            await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            const expectedHistory = [
                ...originalHistory,
                { role: 'user', content: reasoningSignal },
            ];

            // Expect the default combined prompt
            const expectedPrompt = `${bot.config.llm?.defaultSystemPrompt}\n\n${defaultReasoningInstruction}`;
            expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(
                expectedHistory,
                expectedPrompt,
                {}
            );
        });

        it('should handle history modification strategy: truncate', async () => {
            bot = createMockBot({
                // llm.defaultSystemPrompt is set in base createMockBot
                reasoning: {
                    enabled: true,
                    reasoningModel: 'mock/reasoning-model',
                    historyModificationStrategy: 'truncate',
                    maxHistoryLength: 1, // Keep only the last user/assistant pair
                    // Uses default includeDefaultPrompt: true, extraInstructions: undefined
                },
            });
            reasoningManager = new ReasoningManager(bot, mockProviderFactory);

            await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            // Expected: System prompt + last user/assistant pair + new reasoning signal
            const expectedHistory = [
                { role: 'system', content: 'System prompt.' }, // Preserved system prompt
                { role: 'user', content: 'User message 2' }, // Last user message
                { role: 'assistant', content: 'Assistant response 2 [REASONING_REQUEST]Signal[/REASONING_REQUEST]' }, // Last assistant message
                { role: 'user', content: reasoningSignal }, // Appended signal
            ];

            // Expect the default combined prompt
            const expectedPrompt = `${bot.config.llm?.defaultSystemPrompt}\n\n${defaultReasoningInstruction}`;
            expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(
                expectedHistory,
                expectedPrompt,
                {}
            );
            expect(logger.debug).toHaveBeenCalledWith('Reasoning history truncated to last 1 pairs.');
        });

         it('should handle history modification strategy: truncate without system prompt', async () => {
            const historyWithoutSystem: ChatMessage[] = [
                { role: 'user', content: 'User message 1' },
                { role: 'assistant', content: 'Assistant response 1' },
                { role: 'user', content: 'User message 2' },
                { role: 'assistant', content: 'Assistant response 2 [REASONING_REQUEST]Signal[/REASONING_REQUEST]' },
            ];
            bot = createMockBot({
                // llm.defaultSystemPrompt is set in base createMockBot
                reasoning: {
                    enabled: true,
                    reasoningModel: 'mock/reasoning-model',
                    historyModificationStrategy: 'truncate',
                    maxHistoryLength: 1, // Keep only the last user/assistant pair
                    // Uses default includeDefaultPrompt: true, extraInstructions: undefined
                },
            });
            reasoningManager = new ReasoningManager(bot, mockProviderFactory);

            await reasoningManager.generateReasoningResponse(historyWithoutSystem, reasoningSignal, userId);

            // Expected: last user/assistant pair + new reasoning signal
            const expectedHistory = [
                { role: 'user', content: 'User message 2' }, // Last user message
                { role: 'assistant', content: 'Assistant response 2 [REASONING_REQUEST]Signal[/REASONING_REQUEST]' }, // Last assistant message
                { role: 'user', content: reasoningSignal }, // Appended signal
            ];

            // Expect the default combined prompt
            const expectedPrompt = `${bot.config.llm?.defaultSystemPrompt}\n\n${defaultReasoningInstruction}`;
            expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(
                expectedHistory,
                expectedPrompt,
                {}
            );
            expect(logger.debug).toHaveBeenCalledWith('Reasoning history truncated to last 1 pairs.');
        });

        describe('System Prompt Assembly', () => {
            const defaultBotPrompt = 'Default bot system prompt.'; // Already set in createMockBot base
            // defaultReasoningInstruction defined in outer scope
            const extraReasoningInstructions = 'Focus on clarity and conciseness.';

            it('should use default bot prompt and default reasoning instruction by default', async () => {
                bot = createMockBot({
                    // llm.defaultSystemPrompt is set
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        // includeDefaultPrompt: undefined (defaults to true)
                        // extraInstructions: undefined
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                const expectedPrompt = `${defaultBotPrompt}\n\n${defaultReasoningInstruction}`;
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), expectedPrompt, {});
            });

            it('should use only default reasoning instruction when includeDefaultPrompt is false', async () => {
                bot = createMockBot({
                    // llm.defaultSystemPrompt is set
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: false,
                        // extraInstructions: undefined
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), defaultReasoningInstruction, {});
            });

            it('should use only extra instructions when includeDefaultPrompt is false and extraInstructions are provided', async () => {
                bot = createMockBot({
                    // llm.defaultSystemPrompt is set
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: false,
                        extraInstructions: extraReasoningInstructions,
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), extraReasoningInstructions, {});
            });

            it('should combine default bot prompt and extra instructions when includeDefaultPrompt is true', async () => {
                bot = createMockBot({
                    // llm.defaultSystemPrompt is set
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: true,
                        extraInstructions: extraReasoningInstructions,
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                const expectedPrompt = `${defaultBotPrompt}\n\n${extraReasoningInstructions}`;
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), expectedPrompt, {});
            });

            it('should use default bot prompt and default reasoning instruction when extraInstructions is empty', async () => {
                bot = createMockBot({
                    // llm.defaultSystemPrompt is set
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: true,
                        extraInstructions: '   ', // Empty string with whitespace
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                const expectedPrompt = `${defaultBotPrompt}\n\n${defaultReasoningInstruction}`;
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), expectedPrompt, {});
            });

             it('should use only default reasoning instruction when default bot prompt is missing and includeDefaultPrompt is true', async () => {
                bot = createMockBot({
                    llm: { defaultProvider: 'mock' /* Omit defaultSystemPrompt */ },
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: true,
                        // extraInstructions: undefined
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), defaultReasoningInstruction, {});
            });

            it('should use only extra instructions when default bot prompt is missing and includeDefaultPrompt is true', async () => {
                bot = createMockBot({
                    llm: { defaultProvider: 'mock' /* Omit defaultSystemPrompt */ },
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: true,
                        extraInstructions: extraReasoningInstructions,
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), extraReasoningInstructions, {});
            });

            // Corrected test name and expectation
            it('should use hardcoded default prompt if default bot prompt excluded and extra instructions empty', async () => {
                 bot = createMockBot({
                    llm: { defaultProvider: 'mock' /* Omit defaultSystemPrompt */ },
                    reasoning: {
                        enabled: true,
                        reasoningModel: 'mock/reasoning-model',
                        includeDefaultPrompt: false, // Don't include bot default
                        extraInstructions: '', // Explicitly empty extra instructions
                    },
                });
                reasoningManager = new ReasoningManager(bot, mockProviderFactory);
                await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);
                // Expect the hardcoded default because extraInstructions are empty
                expect(mockProviderInstance.generateStream).toHaveBeenCalledWith(expect.any(Array), defaultReasoningInstruction, {});
            });
        });



        it('should return reasoning result on success', async () => {
            // Uses default bot config from beforeEach
            const result = await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            expect(result).toEqual({
                shouldProcess: true,
                reasoningText: 'Reasoning response.',
                finalResponse: 'Reasoning response.', // Currently raw response
            });
        });

        it('should return error if reasoning model is not configured', async () => {
             bot = createMockBot({
                reasoning: {
                    enabled: true,
                    // reasoningModel is missing
                },
            });
            reasoningManager = new ReasoningManager(bot, mockProviderFactory);
            const result = await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            expect(result).toEqual({
                shouldProcess: false,
                error: 'Reasoning model not configured.',
            });
            expect(logger.error).toHaveBeenCalledWith('Reasoning model name is not configured.');
            expect(mockProviderFactory.getProvider).not.toHaveBeenCalled();
        });

        it('should return error if provider factory fails', async () => {
            const factoryError = new Error('Factory failed');
            mockProviderFactory.getProvider = vi.fn().mockImplementation(() => { throw factoryError; });
             bot = createMockBot({
                reasoning: {
                    enabled: true,
                    reasoningModel: 'fail-model',
                },
            });
            reasoningManager = new ReasoningManager(bot, mockProviderFactory);

            const result = await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            expect(result).toEqual({
                shouldProcess: false,
                error: 'Failed to create reasoning provider: Factory failed',
            });
            expect(logger.error).toHaveBeenCalledWith(`Failed to get reasoning provider 'fail-model': ${factoryError}`);
            expect(mockProviderInstance.generateStream).not.toHaveBeenCalled();
        });

        it('should return error if provider stream generation fails', async () => {
            const streamError = new Error('Stream failed');
            mockProviderInstance.generateStream.mockImplementation(async function* () {
                throw streamError;
            });
            // Uses default bot config from beforeEach
            const result = await reasoningManager.generateReasoningResponse(originalHistory, reasoningSignal, userId);

            expect(result).toEqual({
                shouldProcess: false,
                error: 'Reasoning process error: Stream failed',
            });
            expect(logger.error).toHaveBeenCalledWith(`Error during reasoning LLM call: ${streamError}`);
        });
    });

    // TODO: Add tests for checkResponseForSignal, getReasoningSignal, checkRateLimit
});