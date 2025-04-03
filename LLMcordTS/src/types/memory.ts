// LLMcordTS/src/types/memory.ts

// Removed unused imports: Config, Logger
// These interfaces are used by the *implementations* (MemoryManager, SQLiteMemoryAdapter)
// but not directly within this types file itself.

/**
 * Represents a single memory item stored for a user.
 * Structure can be adapted based on actual needs.
 */
export interface IMemory {
    id: string; // Changed to string UUID
    userId: string;
    content: string;
    type: 'core' | 'recall' | 'suggestion'; // Example types
    timestamp: Date;
    metadata?: Record<string, any>; // Optional extra data
}

/**
 * Interface for abstracting the underlying memory storage mechanism (e.g., SQLite, file system).
 */
export interface IMemoryStorageAdapter {
    /**
     * Initializes the storage adapter.
     */
    initialize(): Promise<void>;

    /**
     * Retrieves all relevant memories for a given user ID.
     * @param userId The ID of the user.
     * @returns A promise resolving to an array of IMemory objects.
     */
    getUserMemories(userId: string): Promise<IMemory[]>;

    /**
     * Adds a new memory item to the storage.
     * @param memory The memory item to add.
     * @returns A promise resolving when the memory is added.
     */
    addMemory(memory: Omit<IMemory, 'id' | 'timestamp'>): Promise<IMemory>; // Return the created memory with ID/timestamp

    /**
     * Updates an existing memory item.
     * @param memory The memory item with updated details.
     * @returns A promise resolving when the memory is updated.
     */
    updateMemory(memory: IMemory): Promise<void>;

    /**
     * Deletes a memory item by its ID.
     * @param memoryId The ID of the memory item to delete.
     * @returns A promise resolving when the memory is deleted.
     */
    deleteMemory(memoryId: number | string): Promise<void>;


    /**
     * Retrieves a specific memory entry by its ID.
     * @param memoryId The ID of the memory entry.
     * @returns A promise resolving to the IMemory object or null if not found.
     */
    getMemoryById(memoryId: string): Promise<IMemory | null>;

    /**
     * Updates specific fields of a memory entry by its ID.
     * Note: This provides a more granular update than replacing the whole IMemory object.
     * @param memoryId The ID of the memory entry to update.
     * @param updates An object containing the fields to update (e.g., { content: 'new content', type: 'recall' }).
     * @returns A promise resolving to true if the update was successful, false otherwise.
     */
    updateMemoryById(memoryId: string, updates: Partial<Omit<IMemory, 'id' | 'userId' | 'timestamp'>>): Promise<boolean>;

    /**
     * Deletes a specific memory entry by its ID.
     * @param memoryId The ID of the memory entry to delete.
     * @returns A promise resolving to true if the deletion was successful, false otherwise.
     */
    deleteMemoryById(memoryId: string): Promise<boolean>;

    // Add other necessary methods like clearing memories, searching, etc.
    /**
     * Optional: Closes the connection to the underlying storage.
     */
    close?(): void;

}

/**
 * Interface for the MemoryManager class.
 */
export interface IMemoryManager {
    /**
     * Retrieves the relevant memories for a specific user.
     * @param userId The ID of the user.
     * @returns A promise resolving to an array of IMemory objects.
     */
    getUserMemory(userId: string): Promise<IMemory[]>;

    /**
     * Formats the user's memory to be included in the system prompt.
     * @param baseSystemPrompt The base system prompt string.
     * @param userMemory An array of the user's memories.
     * @returns The system prompt string including formatted memory.
     */
    formatSystemPrompt(baseSystemPrompt: string, userMemory: IMemory[]): string;

    /**
     * Processes memory suggestions potentially included in an LLM response.
     * This might involve parsing the response and adding/updating memories via the storage adapter.
     * @param userId The ID of the user associated with the response.
     * @param rawResponse The raw response string from the LLM.
     * @param messageId The ID of the original Discord message (for context/linking).
     * @returns A promise resolving when processing is complete.
     */
    processMemorySuggestions(userId: string, rawResponse: string, messageId: string): Promise<void>;

    /**
     * Adds a new memory item manually.
     * @param userId The user ID.
     * @param content The content of the memory.
     * @param type The type of memory.
     * @param metadata Optional metadata.
     * @returns A promise resolving to the created IMemory object.
     */
    addMemory(userId: string, content: string, type: IMemory['type'], metadata?: Record<string, any>): Promise<IMemory>;


    /**
     * Replaces all existing memory for a user with a single new entry.
     * @param userId The user ID.
     * @param content The new memory content.
     * @param type The type of the new memory (defaults to 'core' or similar).
     * @param metadata Optional metadata for the new memory.
     * @returns A promise resolving when the operation is complete.
     */
    replaceMemory(userId: string, content: string, type?: IMemory['type'], metadata?: Record<string, any>): Promise<void>;

    /**
     * Deletes all memory entries for a specific user.
     * @param userId The ID of the user whose memory should be cleared.
     * @returns A promise resolving when the operation is complete.
     */
    clearUserMemory(userId: string): Promise<void>;

    /**
     * Retrieves a specific memory entry by its ID.
     * @param memoryId The ID of the memory entry.
     * @returns A promise resolving to the IMemory object or null if not found.
     */
    getMemoryById(memoryId: string): Promise<IMemory | null>;

    /**
     * Updates specific fields of a memory entry by its ID.
     * @param memoryId The ID of the memory entry to update.
     * @param updates An object containing the fields to update (e.g., { content: 'new content', type: 'recall' }).
     * @returns A promise resolving to true if the update was successful, false otherwise.
     */
    updateMemoryById(memoryId: string, updates: Partial<Omit<IMemory, 'id' | 'userId' | 'timestamp'>>): Promise<boolean>;

    /**
     * Deletes a specific memory entry by its ID.
     * @param memoryId The ID of the memory entry to delete.
     * @returns A promise resolving to true if the deletion was successful, false otherwise.
     */
    deleteMemoryById(memoryId: string): Promise<boolean>;

    // Potentially add methods for updating/deleting memories directly through the manager if needed.
}

// Note: IConfig should be defined and exported in './config.ts'
// Note: ILogger should be defined and exported in '../core/logger.ts'