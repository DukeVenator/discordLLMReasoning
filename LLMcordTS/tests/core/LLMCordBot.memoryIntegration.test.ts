import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { LLMCordBot } from '@/core/LLMCordBot';
import { Config, DeepPartial } from '@/types/config';
import { Logger } from '@/core/logger';
// Updated imports for Adapter and Manager
import { SQLiteMemoryAdapter } from '@/memory/storage/SQLiteMemoryAdapter';
import { MemoryManager } from '@/memory/MemoryManager';
import { IMemoryStorageAdapter, IMemoryManager, IMemory } from '@/types/memory'; // Added IMemory
import { BaseProvider, ChatMessage } from '@/providers/baseProvider'; // Corrected import name
// Removed unused import: ProviderFactory
import { Message } from 'discord.js';
import { MessageProcessor } from '@/processing/MessageProcessor'; // Added
import { AxiosInstance } from 'axios'; // Added
import { IMessageNode } from '@/types/message'; // Removed unused IWarning import

// Mock dependencies
vi.mock('@/core/logger');
// Update mocks for new classes
vi.mock('@/memory/storage/SQLiteMemoryAdapter');
vi.mock('@/memory/MemoryManager');
vi.mock('@/providers/providerFactory');
vi.mock('@/providers/baseProvider'); // Mock BaseProvider if needed for generateStream
vi.mock('@/processing/MessageProcessor'); // Mock the actual MessageProcessor class
vi.mock('@/core/config'); // Assuming loadConfig is mocked or config provided directly

// Helper to create a mock Discord message
const createMockMessage = (userId: string, content: string, messageId: string = 'msg1'): Partial<Message> => {
    const mockReplyMessage = {
        id: `${messageId}-reply`,
        content: '',
        edit: vi.fn().mockResolvedValue(undefined),
    } as unknown as Partial<Message>;

    return {
        id: messageId,
        author: { id: userId, tag: `user#${userId.slice(0, 4)}` } as any,
        content: content,
        channelId: 'channel1',
        reply: vi.fn().mockResolvedValue(mockReplyMessage),
    } as unknown as Partial<Message>;
};

// Helper to create a mock bot instance
const createMockBotWithMocks = (configOverrides: DeepPartial<Config> = {}) => {
    const bot = new LLMCordBot();

    // Mock logger
    bot.logger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        getSubLogger: vi.fn(() => bot.logger), // Simple mock for getSubLogger
    } as unknown as Logger;

    // Base config
    const baseConfig: Config = {
        discord: { token: 'test', clientId: 'test-client-id' }, // Ensure clientId
        llm: { defaultProvider: 'mockProvider', defaultSystemPrompt: 'Default test prompt.' },
        memory: {
            enabled: true,
            storageType: 'sqlite',
            sqlite: { path: ':memory:' },
            maxHistoryLength: 10,
            suggestions: {}, // Add suggestions object
            condensation: { enabled: false }, // Add condensation object
        },
        logging: { level: 'info' },
        permissions: {},
        rateLimit: { user: { intervalSeconds: 1, maxCalls: 5 } },
        model: 'mockProvider/mock-model',
        reasoning: { enabled: false },
    };

    // Merge configs more carefully for nested properties
    bot.config = {
        ...baseConfig,
        ...configOverrides,
        memory: {
            ...baseConfig.memory,
            ...(configOverrides.memory ?? {}),
            suggestions: { // Ensure suggestions is always an object
                 ...(baseConfig.memory.suggestions ?? {}),
                 ...(configOverrides.memory?.suggestions ?? {}),
            },
             condensation: { // Ensure condensation is always an object
                 ...(baseConfig.memory.condensation ?? { enabled: false }),
                 ...(configOverrides.memory?.condensation ?? {}),
            }
        },
        llm: {
             ...baseConfig.llm,
             ...(configOverrides.llm ?? {}),
        }
    } as Config;

    // Mock Memory Adapter and Manager
    let mockMemoryAdapterInstance: IMemoryStorageAdapter | null = null;
    let mockMemoryManagerInstance: IMemoryManager | null = null;
    if (bot.config.memory.enabled) {
        // Use the mocked constructor for SQLiteMemoryAdapter
        // We need to cast the result because the constructor isn't technically mocked, just the module
        mockMemoryAdapterInstance = new SQLiteMemoryAdapter(':memory:', bot.logger) as unknown as IMemoryStorageAdapter;
        // Mock methods on the instance
        mockMemoryAdapterInstance.initialize = vi.fn().mockResolvedValue(undefined);
        mockMemoryAdapterInstance.getUserMemories = vi.fn().mockResolvedValue([]);
        mockMemoryAdapterInstance.addMemory = vi.fn();
        mockMemoryAdapterInstance.deleteMemory = vi.fn();
        mockMemoryAdapterInstance.deleteMemoryById = vi.fn();
        // Add other mocks as needed...
        bot.memoryStorage = mockMemoryAdapterInstance;

        // Use the mocked constructor for MemoryManager
        mockMemoryManagerInstance = new MemoryManager(mockMemoryAdapterInstance, bot.config, bot.logger) as unknown as IMemoryManager;
        // Mock manager methods used by the bot in processMessage
        mockMemoryManagerInstance.getUserMemory = vi.fn().mockResolvedValue([]);
        mockMemoryManagerInstance.formatSystemPrompt = vi.fn().mockImplementation((base) => base); // Default mock returns base
        mockMemoryManagerInstance.processMemorySuggestions = vi.fn().mockResolvedValue(undefined);
        bot.memoryManager = mockMemoryManagerInstance;
    } else {
        bot.memoryStorage = null;
        bot.memoryManager = null;
    }


    // Mock LLM Provider
    const mockLlmProvider = {
        generateStream: vi.fn().mockImplementation(async function*() { yield { content: 'mock response' }; }), // Default stream mock
        supportsSystemPrompt: vi.fn().mockReturnValue(true),
        supportsTools: vi.fn().mockReturnValue(false),
    } as unknown as BaseProvider;
    bot.llmProvider = mockLlmProvider;

    // Mock Tool Registry minimally
    bot.toolRegistry = { getToolDefinitions: vi.fn().mockReturnValue([]) } as any;

    // Mock HttpClient
    const mockHttpClient = { get: vi.fn() } as unknown as AxiosInstance;
    bot.httpClient = mockHttpClient;

    // Mock MessageNodeCache
    const mockMessageNodeCache = new Map<string, IMessageNode>();
    bot.messageNodeCache = mockMessageNodeCache;

    // Instantiate MessageProcessor with mocks
    const clientId = bot.config.discord.clientId; // Already ensured in config merge
    // Use the mocked MessageProcessor constructor
    bot.messageProcessor = new MessageProcessor(
        bot.config,
        bot.logger,
        bot.llmProvider,
        mockHttpClient,
        mockMessageNodeCache,
        clientId
    );
    // Mock the buildMessageHistory method ON the messageProcessor instance
    vi.spyOn(bot.messageProcessor, 'buildMessageHistory').mockResolvedValue({ history: [], warnings: [] }); // Default mock

    return {
        bot,
        mockMemoryManager: mockMemoryManagerInstance, // Return manager mock
        mockLlmProvider,
        mockMessageProcessor: bot.messageProcessor,
        mockBuildMessageHistory: bot.messageProcessor.buildMessageHistory as Mock,
    };
};


describe('LLMCordBot - processMessage Memory Integration', () => {
    const userId = 'user123';

    beforeEach(() => {
        vi.clearAllMocks();
        // Removed spyOn for the deleted _processMemorySuggestions method.
        // Integration tests should focus on inputs to LLM, not internal manager logic.
    });

    it('should fetch and inject memory when enabled and memory exists', async () => {
        // Destructure mockMemoryManager instead of mockMemoryStorage
        const { bot, mockMemoryManager, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: true }
        });
        const mockMessage = createMockMessage(userId, 'Hello bot') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Hello bot' }];
        const userMemory: IMemory[] = [{ id: 'm1', userId, content: 'User likes red color.', type: 'core', timestamp: new Date() }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        // Ensure manager is mocked and then mock its method
        if (!mockMemoryManager) throw new Error("Memory Manager was not mocked for this test case.");
        vi.mocked(mockMemoryManager.getUserMemory).mockResolvedValue(userMemory);
        // Refine formatSystemPrompt mock for clearer assertion
        const formattedMemoryString = '--- Formatted Memory ---';
        vi.mocked(mockMemoryManager.formatSystemPrompt).mockReturnValue(bot.config.llm!.defaultSystemPrompt + formattedMemoryString);
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'test chunk' }; });


        try {
            await bot.processMessage(mockMessage);
        } catch (e) {
            console.error("Test Error during processMessage:", e);
            throw e;
        }

        // Assertions
        // Expect manager's method to be called
        expect(vi.mocked(mockMemoryManager.getUserMemory)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockMemoryManager.getUserMemory)).toHaveBeenCalledWith(userId);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        expect((mockLlmProvider.generateStream as Mock).mock.calls.length).toBeGreaterThan(0); // Ensure it was called
        const [historyArg, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!; // Get args

        // Check system prompt
        expect(systemPromptArg).toBeDefined();
        expect(typeof systemPromptArg).toBe('string');
        expect(systemPromptArg).toContain(bot.config.llm?.defaultSystemPrompt);
        expect(vi.mocked(mockMemoryManager.formatSystemPrompt)).toHaveBeenCalledTimes(1);
        expect(systemPromptArg).toContain(formattedMemoryString); // Check if the mocked formatted string is present

        // Check history
        expect(historyArg).toEqual(initialHistory);
    });

    it('should not inject memory when enabled but no memory exists', async () => {
        const { bot, mockMemoryManager, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: true }
        });
        const mockMessage = createMockMessage(userId, 'Hello again') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Hello again' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        if (!mockMemoryManager) throw new Error("Memory Manager was not mocked for this test case.");
        vi.mocked(mockMemoryManager.getUserMemory).mockResolvedValue([]); // No memory found
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'test chunk' }; });

        try {
            await bot.processMessage(mockMessage);
        } catch (e) {
            console.error("Test Error during processMessage:", e);
            throw e;
        }

        // Assertions
        expect(vi.mocked(mockMemoryManager.getUserMemory)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mockMemoryManager.getUserMemory)).toHaveBeenCalledWith(userId);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        expect((mockLlmProvider.generateStream as Mock).mock.calls.length).toBeGreaterThan(0);
        const [historyArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // History should only contain the initial message
        expect(historyArg).toEqual(initialHistory);
        // Check formatSystemPrompt was still called (it handles the "no memory" case internally)
        expect(vi.mocked(mockMemoryManager.formatSystemPrompt)).toHaveBeenCalledTimes(1);
        // Check formatSystemPrompt was still called (it handles the "no memory" case internally)
        expect(vi.mocked(mockMemoryManager.formatSystemPrompt)).toHaveBeenCalledTimes(1);
    });

    it('should not attempt to fetch or inject memory when disabled', async () => {
        // Destructure only needed mocks (mockMemoryManager is null here)
        const { bot, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: false } // Memory explicitly disabled
        });
        const mockMessage = createMockMessage(userId, 'One more time') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'One more time' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'test chunk' }; });

        try {
            await bot.processMessage(mockMessage);
        } catch (e) {
            console.error("Test Error during processMessage:", e);
            throw e;
        }

        // Assertions
        // Check that the manager itself is null
        expect(bot.memoryManager).toBeNull();
        // If manager is null, its methods shouldn't be called
        // Assert manager is null, no need to check its methods
        expect(bot.memoryManager).toBeNull();

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        expect((mockLlmProvider.generateStream as Mock).mock.calls.length).toBeGreaterThan(0);
        const [historyArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // History should only contain the initial message
        expect(historyArg).toEqual(initialHistory);
        // Verify manager is null as per setup (already checked above)
    });

    it('should add memory instructions to system prompt when enabled', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryManager } = createMockBotWithMocks({
            memory: { enabled: true },
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        if (!mockMemoryManager) throw new Error("Memory Manager was not mocked for this test case.");
        vi.mocked(mockMemoryManager.getUserMemory).mockResolvedValue([]);
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // Check that the system prompt contains the base prompt AND memory instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        expect(systemPromptArg).toContain('[MEM_APPEND]');
        expect(systemPromptArg).toContain('[MEM_REPLACE:');
    });

    it('should NOT add memory instructions to system prompt when disabled', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory } = createMockBotWithMocks({
            memory: { enabled: false }, // Memory disabled
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // Check that the system prompt contains the base prompt BUT NOT memory instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).not.toContain('**Memory Instructions:**');
        expect(systemPromptArg).not.toContain('[MEM_APPEND]');
        expect(systemPromptArg).not.toContain('[MEM_REPLACE:');
    });


    it('should handle errors during memory fetch gracefully', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryManager } = createMockBotWithMocks({
            memory: { enabled: true },
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];
        const fetchError = new Error('Database connection failed');

        // Setup mocks
        // Update mock to return warnings array
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] }); // Start with no warnings
        if (!mockMemoryManager) throw new Error("Memory Manager was not mocked for this test case.");
        vi.mocked(mockMemoryManager.getUserMemory).mockRejectedValue(fetchError);
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        // Assertions
        expect(vi.mocked(mockMemoryManager.getUserMemory)).toHaveBeenCalledTimes(1);
        expect(bot.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to retrieve memory'), fetchError);
        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1); // Should still attempt to generate response

        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // System prompt should contain base prompt and memory instructions,
        // but the memory content itself should reflect the "no memory" state handled by formatSystemPrompt
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(vi.mocked(mockMemoryManager.formatSystemPrompt)).toHaveBeenCalled();
        // Check that memory instructions are still present
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        // Assertions about specific memory block content removed as manager handles it

        const [historyArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // History should not contain the memory message
        expect(historyArg).toEqual(initialHistory);
    });

    it('should not inject memory block or history message for empty/whitespace memory', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryManager } = createMockBotWithMocks({
            memory: { enabled: true },
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        // Simulate whitespace memory by returning an empty array from manager
        if (!mockMemoryManager) throw new Error("Memory Manager was not mocked for this test case.");
        vi.mocked(mockMemoryManager.getUserMemory).mockResolvedValue([]);
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        // Assertions
        expect(vi.mocked(mockMemoryManager.getUserMemory)).toHaveBeenCalledTimes(1);
        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);

        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // System prompt should have instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        // Check that formatSystemPrompt was called (it handles the empty case)
        expect(vi.mocked(mockMemoryManager.formatSystemPrompt)).toHaveBeenCalled();
        // Assertions about specific memory block content removed

        const [historyArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;
        // History should not contain the memory message
        expect(historyArg).toEqual(initialHistory);
    });

    it('should include both memory and reasoning instructions when both enabled', async () => {
        const baseSystemPrompt = 'Base prompt.';
        const { bot, mockLlmProvider, mockBuildMessageHistory, mockMemoryManager } = createMockBotWithMocks({
            memory: { enabled: true },
            reasoning: { enabled: true }, // Enable reasoning
            llm: { defaultSystemPrompt: baseSystemPrompt }
        });
        // Mock reasoningManager isEnabled (assuming it's accessed via bot instance)
        bot.reasoningManager = { isEnabled: vi.fn().mockReturnValue(true) } as any;

        const mockMessage = createMockMessage(userId, 'Test message') as Message;
        const initialHistory: ChatMessage[] = [{ role: 'user', name: userId, content: 'Test message' }];

        // Setup mocks
        mockBuildMessageHistory.mockResolvedValue({ history: [...initialHistory], warnings: [] });
        if (!mockMemoryManager) throw new Error("Memory Manager was not mocked for this test case.");
        vi.mocked(mockMemoryManager.getUserMemory).mockResolvedValue([]);
        (mockLlmProvider.generateStream as Mock).mockImplementation(async function* () { yield { content: 'response' }; });

        await bot.processMessage(mockMessage);

        expect(mockLlmProvider.generateStream).toHaveBeenCalledTimes(1);
        const [, systemPromptArg] = (mockLlmProvider.generateStream as Mock).mock.calls[0]!;

        // Check for base prompt, memory instructions, AND reasoning instructions
        expect(systemPromptArg).toContain(baseSystemPrompt);
        expect(systemPromptArg).toContain('**Memory Instructions:**');
        expect(systemPromptArg).toContain('[MEM_APPEND]');
        expect(systemPromptArg).toContain('[MEM_REPLACE:');
        expect(systemPromptArg).toContain('[USE_REASONING_MODEL]'); // Default reasoning signal
        expect(systemPromptArg).toContain('Internal Task:');
    });

});