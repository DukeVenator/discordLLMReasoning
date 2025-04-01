// LLMcordTS/tests/memory/SQLiteMemoryStorage.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SQLiteMemoryStorage } from '@/memory/SQLiteMemoryStorage';
import { Config } from '@/core/config';
import { ProviderFactory } from '@/providers/providerFactory';
import { BaseProvider, StreamChunk } from '@/providers/baseProvider';
import { Logger } from '@/core/logger';
import Database from 'better-sqlite3';

// --- Mocks ---

// Mock Logger
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(() => 'info'), // Provide a default level
} as unknown as Logger; // Use unknown assertion for simplicity

// Mock ProviderFactory
vi.mock('@/providers/providerFactory'); // Mock the entire module

// Mock BaseProvider (for condensation)
const mockCondensationProvider: BaseProvider = {
    supportsVision: vi.fn(() => false),
    supportsTools: vi.fn(() => false),
    supportsSystemPrompt: vi.fn(() => true),
    supportsUsernames: vi.fn(() => false), // Added mock
    supportsStreaming: vi.fn(() => true), // Added mock
    generateStream: vi.fn(), // We'll mock implementation per test
    getProviderInfo: vi.fn(() => ({ name: 'mock-condensation-provider' })),
};

// --- Test Setup ---

let memoryStorage: SQLiteMemoryStorage;
let mockDb: Database.Database;
let mockProviderFactoryInstance: ProviderFactory;

// Helper to create a minimal mock config
const createMockConfig = (condensationConfig?: Partial<Config['memory']['condensation']>): Config => ({
    discord: { token: 'test', clientId: 'test' }, // Minimal required discord config
    model: 'mock/model', // Required model config
    llm: {
        defaultProvider: 'mock',
        defaultMaxTokens: 1024, // Default needed for fallback calculation
        defaultTemperature: 0.7,
    },
    memory: {
        enabled: true,
        storageType: 'sqlite',
        sqlite: { path: ':memory:' }, // Use in-memory DB for tests
        condensation: {
            enabled: false, // Default to disabled unless overridden
            maxTokens: 100, // Default max tokens for testing trigger
            ...condensationConfig, // Apply overrides
        },
    },
    logging: { level: 'info' },
    // Add other minimal required fields if necessary based on Config type
} as Config); // Use type assertion for partial mock


beforeEach(() => {
    // Reset mocks for ProviderFactory before each test
    vi.resetAllMocks();

    // Create a fresh in-memory database for each test
    // Note: better-sqlite3 might not need explicit closing for :memory: if instance is discarded
    mockDb = new Database(':memory:');

    // Mock ProviderFactory constructor and methods
    mockProviderFactoryInstance = {
        getProvider: vi.fn((providerName, _modelName) => { // Prefix unused modelName with _
            if (providerName === 'condensation-provider') { // Only check provider name for this mock
                return mockCondensationProvider;
            }
            throw new Error(`Mock ProviderFactory cannot get provider: ${providerName}/${_modelName}`); // Use prefixed name here too
        }),
        getDefaultProvider: vi.fn(), // Not directly used by SQLiteMemoryStorage constructor
    } as unknown as ProviderFactory;

    // Mock the constructor of ProviderFactory to return our instance
    vi.mocked(ProviderFactory).mockImplementation(() => mockProviderFactoryInstance);

    // Clear logger mocks
    Object.values(mockLogger).forEach(fn => {
        if (typeof fn === 'function' && 'mockClear' in fn) {
            fn.mockClear();
        }
    });
    // Clear condensation provider mocks
    vi.mocked(mockCondensationProvider.generateStream).mockClear();

});

afterEach(() => {
    // Close the database connection after each test
    if (mockDb && mockDb.open) {
        mockDb.close();
    }
});

// --- Test Suites ---

describe('SQLiteMemoryStorage', () => {

    describe('Initialization', () => {
        it('should initialize schema correctly', () => {
            const config = createMockConfig();
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('SQLite database connected'));
            expect(mockLogger.info).toHaveBeenCalledWith('Memory table schema initialized successfully.');
            // Check if table exists on the *internal* db instance of the storage object
            const internalDb = (memoryStorage as any).db as Database.Database; // Access private member for test
            const tableInfo = internalDb.pragma("table_info(memory_entries)") as { name: string }[]; // Check new table
            expect(tableInfo.length).toBeGreaterThan(0);
            expect(tableInfo.some(col => col.name === 'entryId')).toBe(true); // Check new columns
            expect(tableInfo.some(col => col.name === 'userId')).toBe(true);
            expect(tableInfo.some(col => col.name === 'content')).toBe(true);
            expect(tableInfo.some(col => col.name === 'timestamp')).toBe(true);
            // Check if index exists on the internal DB instance
            const indexInfo = internalDb.pragma("index_list('memory_entries')") as { name: string }[];
            expect(indexInfo.some(idx => idx.name === 'idx_memory_entries_userId')).toBe(true);
            memoryStorage.close(); // Close explicitly here
        });

        it('should initialize condensation provider if enabled and configured', () => {
            const config = createMockConfig({
                enabled: true,
                provider: 'condensation-provider',
                model: 'condensation-model',
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            expect(mockProviderFactoryInstance.getProvider).toHaveBeenCalledWith('condensation-provider', 'condensation-model');
            expect(mockLogger.info).toHaveBeenCalledWith("Condensation provider 'condensation-provider' initialized.");
            expect((memoryStorage as any).condensationProvider).toBe(mockCondensationProvider); // Access private member for test
             memoryStorage.close();
        });

        it('should not initialize condensation provider if disabled', () => {
            const config = createMockConfig({ enabled: false });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            expect(mockProviderFactoryInstance.getProvider).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith('Memory condensation is disabled or not fully configured.');
            expect((memoryStorage as any).condensationProvider).toBeNull();
             memoryStorage.close();
        });

        it('should handle condensation provider initialization failure', () => {
            const config = createMockConfig({
                enabled: true,
                provider: 'failing-provider', // Configure a provider that mock factory will fail for
                model: 'failing-model',
            });
             // Mock getProvider to throw for this specific case
            vi.mocked(mockProviderFactoryInstance.getProvider).mockImplementation((provider, _model) => { // Prefix unused model with _
                 if (provider === 'failing-provider') throw new Error('Initialization failed');
                 return mockCondensationProvider; // Should not be reached
            });

            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            expect(mockProviderFactoryInstance.getProvider).toHaveBeenCalledWith('failing-provider', 'failing-model');
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to initialize condensation provider 'failing-provider'"), expect.any(Error));
            expect((memoryStorage as any).condensationProvider).toBeNull();
             memoryStorage.close();
        });
    });

    describe('Basic CRUD Operations', () => {
        beforeEach(() => {
            // Use a simple config for basic tests
            const config = createMockConfig();
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
        });

        afterEach(() => {
             memoryStorage.close();
        });

        it('should set and get memory correctly', async () => {
            const userId = 'user1';
            const content = 'Test memory content';
            await memoryStorage.setMemory(userId, content);
            const retrieved = await memoryStorage.getMemory(userId);
            expect(retrieved).toBe(content);
        });

        it('should return null for non-existent memory', async () => {
            const retrieved = await memoryStorage.getMemory('nonexistent_user');
            expect(retrieved).toBeNull();
        });

        it('should append memory correctly', async () => {
            const userId = 'user2';
            const initialContent = 'Initial part.';
            const appendContent = 'Appended part.';
            await memoryStorage.setMemory(userId, initialContent);
            await memoryStorage.appendMemory(userId, appendContent);
            const retrieved = await memoryStorage.getMemory(userId);
            expect(retrieved).toBe(`${initialContent}\n${appendContent}`);
        });

         it('should append to empty memory correctly', async () => {
            const userId = 'user3';
            const appendContent = 'First part.';
            await memoryStorage.appendMemory(userId, appendContent);
            const retrieved = await memoryStorage.getMemory(userId);
            expect(retrieved).toBe(appendContent);
        });

        it('should delete memory correctly', async () => {
            const userId = 'user4';
            const content = 'To be deleted';
            await memoryStorage.setMemory(userId, content);
            let retrieved = await memoryStorage.getMemory(userId);
            expect(retrieved).toBe(content); // Verify it was set

            await memoryStorage.deleteMemory(userId);
            retrieved = await memoryStorage.getMemory(userId);
            expect(retrieved).toBeNull(); // Verify it's gone
        });

        it('should handle deleting non-existent memory gracefully', async () => {
            await expect(memoryStorage.deleteMemory('nonexistent_user')).resolves.toBeUndefined();
        });
    });



    // --- ID-Based Operations Tests ---
    describe('ID-Based Operations', () => {
        let userId: string;
        let entryId1: string;
        let entryId2: string;
        const content1 = 'Memory entry 1';
        const content2 = 'Memory entry 2';

        // Helper to directly insert an entry and return its ID
        const insertMemoryEntry = async (uid: string, content: string): Promise<string> => {
            const insertStmt = (memoryStorage as any).db.prepare('INSERT INTO memory_entries (entryId, userId, content, timestamp) VALUES (?, ?, ?, ?)');
            const eid = crypto.randomUUID(); // Use crypto from the original file scope if needed, or import it
            const timestamp = Date.now();
            insertStmt.run(eid, uid, content, timestamp);
            return eid;
        };

        beforeEach(async () => {
            // Use a simple config
            const config = createMockConfig();
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            userId = 'user-id-test';
            // Pre-populate with some entries
            entryId1 = await insertMemoryEntry(userId, content1);
            entryId2 = await insertMemoryEntry(userId, content2);
            // Add an entry for a different user
            await insertMemoryEntry('other-user', 'Other user content');
        });

        afterEach(() => {
            memoryStorage.close();
        });

        // getMemoryById Tests
        it('should get memory by existing ID', async () => {
            const retrieved = await memoryStorage.getMemoryById(userId, entryId1);
            expect(retrieved).toBe(content1);
        });

        it('should return null when getting memory by non-existent ID', async () => {
            const retrieved = await memoryStorage.getMemoryById(userId, 'non-existent-id');
            expect(retrieved).toBeNull();
        });

        it('should return null when getting memory by ID for a different user', async () => {
            const retrieved = await memoryStorage.getMemoryById('wrong-user', entryId1);
            expect(retrieved).toBeNull();
        });

        // editMemoryById Tests
        it('should edit memory by existing ID', async () => {
            const newContent = 'Updated memory entry 1';
            const success = await memoryStorage.editMemoryById(userId, entryId1, newContent);
            expect(success).toBe(true);
            const retrieved = await memoryStorage.getMemoryById(userId, entryId1);
            expect(retrieved).toBe(newContent);
        });

        it('should return false when editing memory by non-existent ID', async () => {
            const success = await memoryStorage.editMemoryById(userId, 'non-existent-id', 'Update failed');
            expect(success).toBe(false);
        });

        it('should return false when editing memory by ID for a different user', async () => {
            const success = await memoryStorage.editMemoryById('wrong-user', entryId1, 'Update failed');
            expect(success).toBe(false);
            // Verify original content is unchanged
            const retrieved = await memoryStorage.getMemoryById(userId, entryId1);
            expect(retrieved).toBe(content1);
        });

        it('should update timestamp when editing memory by ID', async () => {
            const stmt = (memoryStorage as any).db.prepare('SELECT timestamp FROM memory_entries WHERE entryId = ?');
            const initialTimestamp = (stmt.get(entryId1) as { timestamp: number }).timestamp;

            // Wait a bit to ensure timestamp changes
            await new Promise(resolve => setTimeout(resolve, 10));

            const success = await memoryStorage.editMemoryById(userId, entryId1, 'Timestamp update');
            expect(success).toBe(true);

            const updatedTimestamp = (stmt.get(entryId1) as { timestamp: number }).timestamp;
            expect(updatedTimestamp).toBeGreaterThan(initialTimestamp);
        });

        // deleteMemoryById Tests
        it('should delete memory by existing ID', async () => {
            const success = await memoryStorage.deleteMemoryById(userId, entryId1);
            expect(success).toBe(true);
            const retrieved = await memoryStorage.getMemoryById(userId, entryId1);
            expect(retrieved).toBeNull();
            // Verify other entry still exists
            const retrieved2 = await memoryStorage.getMemoryById(userId, entryId2);
            expect(retrieved2).toBe(content2);
        });

        it('should return false when deleting memory by non-existent ID', async () => {
            const success = await memoryStorage.deleteMemoryById(userId, 'non-existent-id');
            expect(success).toBe(false);
        });

        it('should return false when deleting memory by ID for a different user', async () => {
            const success = await memoryStorage.deleteMemoryById('wrong-user', entryId1);
            expect(success).toBe(false);
            // Verify original entry still exists
            const retrieved = await memoryStorage.getMemoryById(userId, entryId1);
            expect(retrieved).toBe(content1);
        });
    });

    // --- Condensation Tests ---
    describe('Memory Condensation', () => {
        const userId = 'condenseUser';
        const longMemoryContent = "line ".repeat(60); // Increased size to ensure threshold is passed (Approx 60 * 5 / 4 = 75 tokens)
        const shortMemoryContent = "line ".repeat(10); // Approx 10 * 5 / 4 = 12.5 tokens
        const contentToAppend = "append ".repeat(10); // Approx 10 * 7 / 4 = 17.5 tokens

        // Mock generateStream to return a summary
        async function* mockSuccessStream(): AsyncGenerator<StreamChunk> {
            yield { content: 'Summarized: ', isFinal: false };
            yield { content: 'Key points.', isFinal: true, finishReason: 'stop' };
        }

        // Mock generateStream to return an empty summary
        async function* mockEmptyStream(): AsyncGenerator<StreamChunk> {
            yield { content: '', isFinal: true, finishReason: 'stop' };
        }

        // Mock generateStream to throw an error
        async function* mockErrorStream(): AsyncGenerator<StreamChunk> {
            // Yield nothing, just throw
             yield { content: '', isFinal: false }; // Need to yield something before throwing in async generator
            throw new Error('LLM API Error');
        }


        it('should NOT trigger condensation if memory is below threshold', async () => {
            const config = createMockConfig({ enabled: true, maxTokens: 100 }); // maxTokens = 100
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            vi.spyOn(memoryStorage as any, '_condenseMemory'); // Spy on the private method

            await memoryStorage.setMemory(userId, shortMemoryContent); // ~13 tokens
            await memoryStorage.appendMemory(userId, contentToAppend); // ~18 tokens, total ~31 < 100

            expect((memoryStorage as any)._condenseMemory).not.toHaveBeenCalled();
            memoryStorage.close();
        });

        it('should trigger condensation if memory exceeds threshold after append', async () => {
            // Provide provider and model so condensationProvider is initialized
            const config = createMockConfig({
                enabled: true,
                maxTokens: 70,
                provider: 'condensation-provider', // Added
                model: 'condensation-model'        // Added
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            // Create the spy BEFORE any actions
            const condenseSpy = vi.spyOn(memoryStorage as any, '_condenseMemory').mockResolvedValue(undefined); // Mock implementation to prevent actual call

            await memoryStorage.setMemory(userId, longMemoryContent); // ~63 tokens
            // Append should now trigger and await condensation internally if needed
            await memoryStorage.appendMemory(userId, contentToAppend); // ~18 tokens, total ~81 > 70

            // No need for setTimeout, as condensation is awaited within appendMemory now

            expect(condenseSpy).toHaveBeenCalledTimes(1); // Use the spy variable
            // The new logic calls condense with the memory *before* the append
            expect(condenseSpy).toHaveBeenCalledWith(userId, longMemoryContent); // Use the spy variable
            memoryStorage.close();
        });

        it('should NOT trigger condensation if condensation is disabled in config', async () => {
            const config = createMockConfig({ enabled: false, maxTokens: 70 }); // Disabled, maxTokens = 70
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
             vi.spyOn(memoryStorage as any, '_condenseMemory');

            await memoryStorage.setMemory(userId, longMemoryContent); // ~63 tokens
            await memoryStorage.appendMemory(userId, contentToAppend); // ~18 tokens, total ~81 > 70

            await new Promise(resolve => setTimeout(resolve, 10));

            expect((memoryStorage as any)._condenseMemory).not.toHaveBeenCalled();
            memoryStorage.close();
        });

        it('should call condensation provider and update memory on success', async () => {
            const config = createMockConfig({
                enabled: true,
                maxTokens: 70,
                provider: 'condensation-provider',
                model: 'condensation-model',
                prompt: 'Test Prompt:' // Custom prompt for verification
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            vi.mocked(mockCondensationProvider.generateStream).mockImplementation(mockSuccessStream);

            const initialMemory = `${longMemoryContent}\n${contentToAppend}`; // ~81 tokens
            await memoryStorage.setMemory(userId, initialMemory); // Set memory directly to trigger condensation check within _condenseMemory

            // Directly call _condenseMemory for easier testing of its internal logic
            await (memoryStorage as any)._condenseMemory(userId, initialMemory);

            expect(mockCondensationProvider.generateStream).toHaveBeenCalledTimes(1);
            // Check arguments passed to generateStream (use non-null assertion !)
            const streamArgs = vi.mocked(mockCondensationProvider.generateStream).mock.calls[0]!;
            expect(streamArgs[0]).toEqual([{ role: 'user', content: initialMemory }]); // messages
            expect(streamArgs[1]).toBe('Test Prompt:'); // systemPrompt
            expect(streamArgs[2]).toMatchObject({ // options
                 temperature: expect.any(Number),
                 maxOutputTokens: expect.any(Number),
                 tools: [],
            });


            const finalMemory = await memoryStorage.getMemory(userId);
            expect(finalMemory).toMatch(/^\[Summarized History - .*\]\nSummarized: Key points.$/); // Check prefix and content
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Condensation successful'));
            expect(mockLogger.error).not.toHaveBeenCalled(); // No errors logged
            memoryStorage.close();
        });

        it('should apply fallback truncation if condensation LLM call fails', async () => {
            const config = createMockConfig({
                enabled: true,
                maxTokens: 70,
                fallbackTruncateTokens: 50, // Target ~50 tokens on fallback
                provider: 'condensation-provider',
                model: 'condensation-model',
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            vi.mocked(mockCondensationProvider.generateStream).mockImplementation(mockErrorStream);

            const initialMemory = `${longMemoryContent}\n${contentToAppend}`; // ~81 tokens
            await memoryStorage.setMemory(userId, initialMemory);

            await (memoryStorage as any)._condenseMemory(userId, initialMemory);

            expect(mockCondensationProvider.generateStream).toHaveBeenCalledTimes(1);
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Memory condensation LLM call failed'), expect.any(Error));
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Applying fallback truncation'));

            const finalMemory = await memoryStorage.getMemory(userId);
            expect(finalMemory).toMatch(/^\[Truncated History - .*\]\n/); // Check prefix
            // Check length - target 50 tokens * 4 chars/token = 200 chars
            const truncatedContent = finalMemory?.split('\n').slice(1).join('\n') ?? '';
            expect(truncatedContent.length).toBeLessThanOrEqual(200); // Should be roughly <= 200 chars
            expect(truncatedContent.length).toBeGreaterThan(100); // Should be more than a tiny fragment
            expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Truncated memory'));
            memoryStorage.close();
        });

         it('should apply fallback truncation if condensation returns empty summary', async () => {
            const config = createMockConfig({
                enabled: true,
                maxTokens: 70,
                fallbackTruncateTokens: 50,
                provider: 'condensation-provider',
                model: 'condensation-model',
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            vi.mocked(mockCondensationProvider.generateStream).mockImplementation(mockEmptyStream); // Mock empty response

            const initialMemory = `${longMemoryContent}\n${contentToAppend}`; // ~81 tokens
            await memoryStorage.setMemory(userId, initialMemory);

            await (memoryStorage as any)._condenseMemory(userId, initialMemory);

            expect(mockCondensationProvider.generateStream).toHaveBeenCalledTimes(1);
            // Check for the exact log message now
            expect(mockLogger.warn).toHaveBeenCalledWith(`Condensation for ${userId} resulted in an empty summary. Applying fallback.`);
            expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Memory condensation LLM call failed'), expect.any(Error)); // Error is thrown internally
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Applying fallback truncation'));

            const finalMemory = await memoryStorage.getMemory(userId);
            expect(finalMemory).toMatch(/^\[Truncated History - .*\]\n/);
            const truncatedContent = finalMemory?.split('\n').slice(1).join('\n') ?? '';
            expect(truncatedContent.length).toBeLessThanOrEqual(200);
            expect(truncatedContent.length).toBeGreaterThan(100);
            memoryStorage.close();
        });

    });


    // --- Token Counting Tests (using tiktoken indirectly via appendMemory) ---
    describe('Token Counting (via appendMemory)', () => {
        const userId = 'tokenCountUser';

        // Note: Token counts are based on cl100k_base encoding
        const stringBelowThreshold = 'Hello world'; // 2 tokens
        const stringNearThreshold = 'This is a test sentence with several words.'; // 9 tokens
        const stringOverThreshold = 'Another test sentence, this one is slightly longer.'; // 11 tokens

        it('should NOT trigger condensation when total tokens are below maxTokens', async () => {
            const config = createMockConfig({
                enabled: true,
                maxTokens: 15, // Threshold
                provider: 'condensation-provider', // Needed for condensation setup
                model: 'condensation-model'
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            const condenseSpy = vi.spyOn(memoryStorage as any, '_condenseMemory').mockResolvedValue(undefined);

            await memoryStorage.setMemory(userId, stringBelowThreshold); // 2 tokens
            await memoryStorage.appendMemory(userId, stringNearThreshold); // 9 tokens, total = 11 < 15

            expect(condenseSpy).not.toHaveBeenCalled();
            memoryStorage.close();
        });

        it('should trigger condensation when total tokens exceed maxTokens', async () => {
            const config = createMockConfig({
                enabled: true,
                maxTokens: 15, // Threshold
                provider: 'condensation-provider',
                model: 'condensation-model'
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            const condenseSpy = vi.spyOn(memoryStorage as any, '_condenseMemory').mockResolvedValue(undefined);

            await memoryStorage.setMemory(userId, stringNearThreshold); // 9 tokens
            await memoryStorage.appendMemory(userId, stringOverThreshold); // 11 tokens, total = 20 > 15

            expect(condenseSpy).toHaveBeenCalledTimes(1);
            // Verify it was called with the memory *before* the append that triggered it
            expect(condenseSpy).toHaveBeenCalledWith(userId, stringNearThreshold);
            memoryStorage.close();
        });

        it('should handle empty initial memory correctly during token check', async () => {
            const config = createMockConfig({
                enabled: true,
                maxTokens: 5, // Low threshold
                provider: 'condensation-provider',
                model: 'condensation-model'
            });
            memoryStorage = new SQLiteMemoryStorage(':memory:', mockLogger, config, mockProviderFactoryInstance);
            const condenseSpy = vi.spyOn(memoryStorage as any, '_condenseMemory').mockResolvedValue(undefined);

            // Append content that exceeds the threshold on its own
            await memoryStorage.appendMemory(userId, stringNearThreshold); // 9 tokens > 5

            // Condensation should still be triggered, called with an empty string as 'currentMemory'
            expect(condenseSpy).toHaveBeenCalledTimes(1);
            expect(condenseSpy).toHaveBeenCalledWith(userId, ''); // Called with empty string before append
            memoryStorage.close();
        });

        // Add more tests if needed, e.g., for unicode characters, edge cases
    });

});