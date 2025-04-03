// LLMcordTS/tests/memory/MemoryManager.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager';
import { IMemoryStorageAdapter, IMemory } from '../../src/types/memory';
import { Config } from '../../src/types/config';
import { Logger } from '../../src/core/logger'; // Assuming Logger class is exported

// --- Mocks ---
// Use vi.mocked for better type inference with mock functions
const mockStorageAdapter: IMemoryStorageAdapter = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getUserMemories: vi.fn(),
    addMemory: vi.fn(),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    // Add new methods required by the interface
    getMemoryById: vi.fn(),
    updateMemoryById: vi.fn(),
    deleteMemoryById: vi.fn(),
    close: vi.fn(), // Add optional close method
};
const mockedGetUserMemories = vi.mocked(mockStorageAdapter.getUserMemories);
const mockedAddMemory = vi.mocked(mockStorageAdapter.addMemory);
// Remove unused mocks for methods not directly asserted in these tests
// const mockedDeleteMemory = vi.mocked(mockStorageAdapter.deleteMemory);
// const mockedGetMemoryById = vi.mocked(mockStorageAdapter.getMemoryById);
// const mockedUpdateMemoryById = vi.mocked(mockStorageAdapter.updateMemoryById);
// const mockedDeleteMemoryById = vi.mocked(mockStorageAdapter.deleteMemoryById);
// updateMemory is not used in these tests yet, but could be mocked similarly if needed
// const mockedUpdateMemory = vi.mocked(mockStorageAdapter.updateMemory);

// Refined Logger Mock
const mockLogMethod = vi.fn();
// Define the sub-logger structure first
const mockSubLoggerInstance = {
    debug: mockLogMethod,
    info: mockLogMethod,
    warn: mockLogMethod,
    error: mockLogMethod,
    // IMPORTANT: Mock getSubLogger on the sub-logger as well, returning itself
    // This handles cases where a sub-logger tries to create another sub-logger (though unlikely here)
    getSubLogger: vi.fn(() => mockSubLoggerInstance),
};
// Define the main logger mock
const mockLogger = {
    debug: mockLogMethod,
    info: mockLogMethod,
    warn: mockLogMethod,
    error: mockLogMethod,
    // getSubLogger now returns the pre-defined sub-logger instance
    getSubLogger: vi.fn(() => mockSubLoggerInstance),
    setLevel: vi.fn(),
    getLevel: vi.fn().mockReturnValue('info'),
};

// Default Mock Config
const mockConfig: Config = {
    discord: { token: 'test-token', clientId: 'test-client-id' },
    llm: { defaultProvider: 'mock' },
    model: 'mock/mock-model',
    logging: { level: 'info' },
    permissions: {},
    rateLimit: { user: { intervalSeconds: 60, maxCalls: 5 } },
    memory: {
        enabled: true,
        storageType: 'sqlite',
        sqlite: { path: ':memory:' }, // Use in-memory for tests if adapter needed real DB
        memoryPrefix: '--- Test Memory ---',
        suggestions: {
            appendMarkerStart: '[APPEND]',
            appendMarkerEnd: '[/APPEND]',
            replaceMarkerStart: '[REPLACE]',
            replaceMarkerEnd: '[/REPLACE]',
            stripFromResponse: true,
        },
        condensation: { enabled: false } // Keep condensation disabled for basic tests
    },
};

// Mock Logger instance is now the plain object defined above

// --- Test Suite ---
describe('MemoryManager', () => {
    let memoryManager: MemoryManager;

    beforeEach(() => {
        // Reset mocks before each test
        vi.clearAllMocks();

        // Create a fresh instance for each test
        memoryManager = new MemoryManager(
            mockStorageAdapter,
            mockConfig,
            mockLogger as unknown as Logger, // Cast the mock object to Logger type for constructor
        );
    });

    it('should initialize correctly and create a sub-logger', () => {
        // Check if constructor was called (implicit via beforeEach)
        expect(MemoryManager).toBeDefined();
        // Check if the sub-logger was requested from the root logger
        expect(mockLogger.getSubLogger).toHaveBeenCalledWith({ name: 'MemoryManager' });
    });

    // --- getUserMemory Tests ---
    describe('getUserMemory', () => {
        it('should return memories from the storage adapter', async () => {
            const userId = 'user-123';
            const mockMemories: IMemory[] = [
                { id: 'mem-1', userId, content: 'Test memory 1', type: 'recall', timestamp: new Date() },
                { id: 'mem-2', userId, content: 'Test memory 2', type: 'core', timestamp: new Date() },
            ];
            mockedGetUserMemories.mockResolvedValue(mockMemories);

            const result = await memoryManager.getUserMemory(userId);

            expect(result).toEqual(mockMemories);
            expect(mockStorageAdapter.getUserMemories).toHaveBeenCalledWith(userId);
            expect(mockStorageAdapter.getUserMemories).toHaveBeenCalledTimes(1);
        });

        it('should return an empty array if no memories exist', async () => {
            const userId = 'user-456';
            mockedGetUserMemories.mockResolvedValue([]);

            const result = await memoryManager.getUserMemory(userId);

            expect(result).toEqual([]);
            expect(mockStorageAdapter.getUserMemories).toHaveBeenCalledWith(userId);
        });

        it('should return an empty array and log error if storage adapter fails', async () => {
            const userId = 'user-789';
            const error = new Error('Database connection failed');
            mockedGetUserMemories.mockRejectedValue(error);

            const result = await memoryManager.getUserMemory(userId);

            expect(result).toEqual([]);
            expect(mockStorageAdapter.getUserMemories).toHaveBeenCalledWith(userId);
            // Check if the error was logged via the sub-logger instance mock
            expect(mockSubLoggerInstance.error).toHaveBeenCalledWith(
                expect.stringContaining(`Error fetching memory for user ${userId}`),
                error
            );
        });
    });

    // --- formatSystemPrompt Tests ---
    describe('formatSystemPrompt', () => {
        const basePrompt = 'You are a helpful assistant.';
        const userId = 'user-abc';

        it('should format prompt with memories using configured prefix', () => {
            const memories: IMemory[] = [
                { id: 'm1', userId, content: 'Loves dogs', type: 'core', timestamp: new Date() },
                { id: 'm2', userId, content: 'Prefers ```code``` blocks', type: 'recall', timestamp: new Date() },
            ];
            const expectedMemoryString = `- Loves dogs\n- Prefers \\\`\\\`\\\`code\\\`\\\`\\\` blocks`; // Note escaped backticks
            const expected = `${basePrompt}\n\n--- Test Memory ---\n${expectedMemoryString}\n--- End Memory ---`;

            const result = memoryManager.formatSystemPrompt(basePrompt, memories);
            expect(result).toBe(expected);
        });

        it('should format prompt with default message when no memories exist', () => {
            const memories: IMemory[] = [];
            const expected = `${basePrompt}\n\n--- Test Memory ---\nYou have no memories of the user.\n--- End Memory ---`;

            const result = memoryManager.formatSystemPrompt(basePrompt, memories);
            expect(result).toBe(expected);
        });

         it('should format prompt using default prefix if not configured', () => {
            const memories: IMemory[] = [
                { id: 'm1', userId, content: 'Test', type: 'core', timestamp: new Date() },
            ];
            // Create a config without the memoryPrefix
            const configWithoutPrefix: Config = {
                ...mockConfig,
                memory: { // Create a new memory object, omitting the prefix
                    enabled: true,
                    storageType: 'sqlite',
                    sqlite: { path: ':memory:' },
                    // memoryPrefix is omitted
                    // Provide default empty objects if source is undefined to satisfy exactOptionalPropertyTypes
                    suggestions: mockConfig.memory.suggestions ?? {},
                    condensation: mockConfig.memory.condensation ?? { enabled: false }, // Ensure condensation has at least 'enabled'
                }
            };
             const managerWithoutPrefix = new MemoryManager(mockStorageAdapter, configWithoutPrefix, mockLogger as unknown as Logger);
            const expectedMemoryString = `- Test`;
            const expected = `${basePrompt}\n\n--- User Memory ---\n${expectedMemoryString}\n--- End Memory ---`; // Expect the actual default prefix

            const result = managerWithoutPrefix.formatSystemPrompt(basePrompt, memories);
            expect(result).toBe(expected);
        });
    });

    // --- processMemorySuggestions Tests ---
    describe('processMemorySuggestions', () => {
        const userId = 'user-suggest';
        const messageId = 'msg-123';

        it('should add memory on [APPEND] suggestion', async () => {
            const rawResponse = 'This is the response. [APPEND]User likes blue.[/APPEND]';
            const expectedContent = 'User likes blue.';
            // Spy on addMemory for this test
            const addMemorySpy = vi.spyOn(memoryManager, 'addMemory');

            await memoryManager.processMemorySuggestions(userId, rawResponse, messageId);

            expect(addMemorySpy).toHaveBeenCalledTimes(1);
            // Assert call includes metadata
            expect(addMemorySpy).toHaveBeenCalledWith(userId, expectedContent, 'suggestion', { sourceMessageId: messageId });
            // Ensure replaceMemory wasn't called
            const replaceMemorySpy = vi.spyOn(memoryManager, 'replaceMemory'); // Need to spy to check if not called
            expect(replaceMemorySpy).not.toHaveBeenCalled();
            replaceMemorySpy.mockRestore();


            addMemorySpy.mockRestore();
        });

         it('should replace memory on [REPLACE] suggestion', async () => {
            const rawResponse = 'Okay, I will update that. [REPLACE]User prefers cats now.[/REPLACE]';
            const expectedNewContent = 'User prefers cats now.';
            // Spy on replaceMemory for this test
            const replaceMemorySpy = vi.spyOn(memoryManager, 'replaceMemory').mockResolvedValue(undefined); // Mock implementation
            const addMemorySpy = vi.spyOn(memoryManager, 'addMemory');

            await memoryManager.processMemorySuggestions(userId, rawResponse, messageId);

            // Assert that replaceMemory was called correctly
            expect(replaceMemorySpy).toHaveBeenCalledTimes(1);
            expect(replaceMemorySpy).toHaveBeenCalledWith(userId, expectedNewContent, 'suggestion', { sourceMessageId: messageId });
            // Ensure addMemory wasn't called directly by processMemorySuggestions
            expect(addMemorySpy).not.toHaveBeenCalled();

            replaceMemorySpy.mockRestore();
            addMemorySpy.mockRestore();
        });

        it('should clear memory on empty [REPLACE] suggestion', async () => {
            const rawResponse = 'Understood, removing that note. [REPLACE][/REPLACE]';
             // Spy on replaceMemory for this test
            const replaceMemorySpy = vi.spyOn(memoryManager, 'replaceMemory').mockResolvedValue(undefined); // Mock implementation
            const addMemorySpy = vi.spyOn(memoryManager, 'addMemory');


            await memoryManager.processMemorySuggestions(userId, rawResponse, messageId);

            // Assert that replaceMemory was called correctly with empty content
            expect(replaceMemorySpy).toHaveBeenCalledTimes(1);
            expect(replaceMemorySpy).toHaveBeenCalledWith(userId, '', 'suggestion', { sourceMessageId: messageId }); // Expect empty string
             // Ensure addMemory wasn't called directly by processMemorySuggestions
            expect(addMemorySpy).not.toHaveBeenCalled();

            replaceMemorySpy.mockRestore();
            addMemorySpy.mockRestore();
        });

        it('should do nothing if no suggestions are present', async () => {
            const rawResponse = 'This is just a normal response.';
            const replaceMemorySpy = vi.spyOn(memoryManager, 'replaceMemory');
            const addMemorySpy = vi.spyOn(memoryManager, 'addMemory');


            await memoryManager.processMemorySuggestions(userId, rawResponse, messageId);

            expect(replaceMemorySpy).not.toHaveBeenCalled();
            expect(addMemorySpy).not.toHaveBeenCalled();

            replaceMemorySpy.mockRestore();
            addMemorySpy.mockRestore();
        });

        it('should do nothing if memory is disabled in config', async () => {
             const configDisabled: Config = {
                ...mockConfig,
                memory: {
                    ...mockConfig.memory,
                    enabled: false,
                }
            };
            const managerDisabled = new MemoryManager(mockStorageAdapter, configDisabled, mockLogger as unknown as Logger);
            const replaceMemorySpy = vi.spyOn(managerDisabled, 'replaceMemory');
            const addMemorySpy = vi.spyOn(managerDisabled, 'addMemory');
            const rawResponse = 'Response with [APPEND]suggestion[/APPEND] but memory disabled.';

            await managerDisabled.processMemorySuggestions(userId, rawResponse, messageId);

            expect(replaceMemorySpy).not.toHaveBeenCalled();
            expect(addMemorySpy).not.toHaveBeenCalled();

            replaceMemorySpy.mockRestore();
            addMemorySpy.mockRestore();
        });

        it('should handle errors during storage operations gracefully', async () => {
            const rawResponse = 'Append this: [APPEND]Error case[/APPEND]';
            const error = new Error('DB write failed');
            // Mock addMemory directly on the manager to throw an error
            const addMemorySpy = vi.spyOn(memoryManager, 'addMemory').mockRejectedValue(error);

            // Expect the function not to throw, but to log the error
            await expect(memoryManager.processMemorySuggestions(userId, rawResponse, messageId))
                .resolves.toBeUndefined();

            expect(addMemorySpy).toHaveBeenCalledTimes(1);
            // Check if the error was logged by the processMemorySuggestions method's catch block
             expect(mockSubLoggerInstance.error).toHaveBeenCalledWith(
                expect.stringContaining(`Error processing memory suggestions for user ${userId}`),
                error
            );
             addMemorySpy.mockRestore(); // Clean up spy
        });

        // Add tests for custom markers if needed
    });

     // --- addMemory Tests ---
    describe('addMemory (manual)', () => {
        const userId = 'user-manual';
        const content = 'Manually added memory.';
        const type = 'core';

        it('should call storageAdapter.addMemory and return the created memory', async () => {
            const mockCreatedMemory: IMemory = {
                id: 'new-mem-id',
                userId,
                content,
                type,
                timestamp: new Date(),
            };
            mockedAddMemory.mockResolvedValue(mockCreatedMemory);

            const result = await memoryManager.addMemory(userId, content, type);

            expect(result).toEqual(mockCreatedMemory);
            expect(mockedAddMemory).toHaveBeenCalledTimes(1);
            expect(mockedAddMemory).toHaveBeenCalledWith({
                userId,
                content,
                type,
                metadata: undefined, // Explicitly check metadata is undefined when not passed
            });
        });

        it('should call storageAdapter.addMemory with metadata', async () => {
             const metadata = { source: 'test-case' };
             const mockCreatedMemory: IMemory = {
                id: 'new-mem-id-meta',
                userId,
                content,
                type,
                timestamp: new Date(),
                metadata,
            };
            mockedAddMemory.mockResolvedValue(mockCreatedMemory);


            const result = await memoryManager.addMemory(userId, content, type, metadata);

            expect(result).toEqual(mockCreatedMemory);
            expect(mockedAddMemory).toHaveBeenCalledTimes(1);
            expect(mockedAddMemory).toHaveBeenCalledWith({
                userId,
                content,
                type,
                metadata, // Check metadata is passed correctly
            });
        });

        it('should re-throw error from storageAdapter.addMemory', async () => {
            const error = new Error('Failed to insert');
            mockedAddMemory.mockRejectedValue(error);

            await expect(memoryManager.addMemory(userId, content, type))
                .rejects.toThrow(error);

            expect(mockedAddMemory).toHaveBeenCalledTimes(1);
        });
    });

    // TODO: Add tests for replaceMemory, clearUserMemory, getMemoryById, updateMemoryById, deleteMemoryById

});