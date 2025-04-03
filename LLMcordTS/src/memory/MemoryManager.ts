// LLMcordTS/src/memory/MemoryManager.ts

import {
    IMemoryManager,
    IMemoryStorageAdapter,
    IMemory,
} from '../types/memory';
import { Config } from '../types/config';
import { Logger } from '../core/logger';

export class MemoryManager implements IMemoryManager {
    private storageAdapter: IMemoryStorageAdapter;
    private config: Config;
    private logger: Logger;

    constructor(
        storageAdapter: IMemoryStorageAdapter,
        config: Config,
        logger: Logger,
    ) {
        this.storageAdapter = storageAdapter;
        this.config = config;
        // Create a sub-logger specific to the MemoryManager for better context
        this.logger = logger.getSubLogger({ name: 'MemoryManager' });
        this.logger.info('MemoryManager initialized.');
    }

    /**
     * Retrieves the relevant memories for a specific user.
     */
    async getUserMemory(userId: string): Promise<IMemory[]> {
        this.logger.debug(`Fetching memory for user: ${userId}`);
        try {
            const memories = await this.storageAdapter.getUserMemories(userId);
            this.logger.debug(`Fetched ${memories.length} memory items for user ${userId}.`);
            return memories;
        } catch (error) {
            this.logger.error(`Error fetching memory for user ${userId}:`, error);
            throw error; // Re-throw error
        }
    }

    /**
     * Formats the user's memory to be included in the system prompt.
     */
    formatSystemPrompt(baseSystemPrompt: string, userMemory: IMemory[]): string {
        this.logger.debug(`Formatting system prompt with ${userMemory.length} memory items.`);
        const memoryPrefix = this.config.memory?.memoryPrefix ?? '--- User Memory ---';
        const memorySuffix = '--- End Memory ---';

        let formattedMemorySection: string;
        if (userMemory && userMemory.length > 0) {
            const memoryContent = userMemory
                .map(mem => `- ${mem.content.replace(/```/g, '\\`\\`\\`')}`)
                .join('\n');
            formattedMemorySection = `\n\n${memoryPrefix}\n${memoryContent}\n${memorySuffix}`;
        } else {
            formattedMemorySection = `\n\n${memoryPrefix}\nYou have no memories of the user.\n${memorySuffix}`;
        }
        return `${baseSystemPrompt}${formattedMemorySection}`;
    }

    /**
     * Processes memory suggestions potentially included in an LLM response.
     */
    async processMemorySuggestions(userId: string, rawResponse: string, messageId: string): Promise<void> {
        const logger = this.logger.getSubLogger({ messageId });
        logger.debug(`Processing memory suggestions for user ${userId}`);

        if (!this.config.memory.enabled) {
            logger.debug('Memory processing skipped: memory is disabled in config.');
            return;
        }

        const suggestionsConfig = this.config.memory.suggestions;
        const appendStart = suggestionsConfig?.appendMarkerStart ?? '[MEM_APPEND]';
        const appendEnd = suggestionsConfig?.appendMarkerEnd ?? '[/MEM_APPEND]';
        const replaceStart = suggestionsConfig?.replaceMarkerStart ?? '[MEM_REPLACE]';
        const replaceEnd = suggestionsConfig?.replaceMarkerEnd ?? '[/MEM_REPLACE]';

        const appendStartEsc = this.escapeRegex(appendStart);
        const appendEndEsc = this.escapeRegex(appendEnd);
        const replaceStartEsc = this.escapeRegex(replaceStart);
        const replaceEndEsc = this.escapeRegex(replaceEnd);

        // Regex requiring both start and end tags (for replace and initial append check)
        const appendRegexStrict = new RegExp(`${appendStartEsc}([\\s\\S]*?)${appendEndEsc}`, 'gi');
        const replaceRegexStrict = new RegExp(`${replaceStartEsc}([\\s\\S]*?)${replaceEndEsc}`, 'gi');
        // Regex for append start tag, capturing everything after it (greedy)
        const appendRegexLenient = new RegExp(`${appendStartEsc}([\\s\\S]*)`, 'i'); // Case-insensitive, only first match needed

        const replaceMatches = [...rawResponse.matchAll(replaceRegexStrict)];
        let appendMatches = [...rawResponse.matchAll(appendRegexStrict)];
        let appendContent: string | null = null;
        let replaceContent: string | null = null;

        try {
            // --- Check for REPLACE first ---
            if (replaceMatches.length > 0) {
                replaceContent = replaceMatches
                    .map((match) => match[1])
                    .filter((content): content is string => content !== undefined)
                    .map((content) => content.trim())
                    .join('\n') // Join content from multiple tags if present
                    .trim();
                logger.info(`Found strict [REPLACE] suggestion(s). Combined content length: ${replaceContent?.length ?? 0}`);
                // Use replaceMemory which handles clearing old and adding new
                await this.replaceMemory(userId, replaceContent || '', 'suggestion', { sourceMessageId: messageId });

            // --- Check for APPEND only if REPLACE wasn't found ---
            } else {
                // Try strict append first
                if (appendMatches.length > 0) {
                     appendContent = appendMatches
                        .map((match) => match[1])
                        .filter((content): content is string => content !== undefined)
                        .map((content) => content.trim())
                        .join('\n') // Join content from multiple tags if present
                        .trim();
                     logger.info(`Found strict [APPEND] suggestion(s). Combined content length: ${appendContent?.length ?? 0}`);
                } else {
                    // If strict fails, try lenient append (start tag only, towards the end)
                    const lenientMatch = rawResponse.match(appendRegexLenient);
                    // Check if the match exists and isn't excessively long (e.g., > 50% of response)
                    // to avoid accidentally capturing huge parts of the response if the tag is misplaced.
                    if (lenientMatch && lenientMatch[1] && lenientMatch.index !== undefined && lenientMatch.index > rawResponse.length / 2) {
                        appendContent = lenientMatch[1].trim();
                        logger.info(`Found lenient [APPEND] suggestion (no end tag detected near end). Content length: ${appendContent?.length ?? 0}`);
                    }
                }

                // If any append content was found (strict or lenient)
                if (appendContent !== null) {
                    if (appendContent) {
                        await this.addMemory(userId, appendContent, 'suggestion', { sourceMessageId: messageId });
                    } else {
                        logger.warn(`Append suggestion found but content was empty for user ${userId}.`);
                    }
                } else {
                    logger.debug(`No memory suggestions (APPEND or REPLACE) found in response for user ${userId}.`);
                }
            }
        } catch (error) {
            logger.error(`Error processing memory suggestions for user ${userId}:`, error);
            // Do not re-throw, just log the error
        }
    }

     /**
     * Adds a new memory item manually.
     */
     async addMemory(userId: string, content: string, type: IMemory['type'], metadata?: Record<string, any>): Promise<IMemory> {
        this.logger.debug(`Manually adding memory for user ${userId}, type: ${type}`);
        const newMemoryData: Omit<IMemory, 'id' | 'timestamp'> = {
            userId,
            content,
            type,
            ...(metadata !== undefined && { metadata }),
        };
        try {
            const createdMemory = await this.storageAdapter.addMemory(newMemoryData);
            this.logger.info(`Added new memory item ID: ${createdMemory.id} for user ${userId}`);
            return createdMemory;
        } catch (error) {
             this.logger.error(`Error manually adding memory for user ${userId}:`, error);
             throw error; // Re-throw
        }
    }

    /**
     * Replaces all existing memory for a user with a single new entry.
     */
    async replaceMemory(userId: string, content: string, type: IMemory['type'] = 'core', metadata?: Record<string, any>): Promise<void> {
        this.logger.info(`Replacing all memory for user ${userId}.`);
        try {
            const existingMemories = await this.storageAdapter.getUserMemories(userId);
            this.logger.debug(`Found ${existingMemories.length} existing memories to remove during replace operation for user ${userId}.`);
            for (const mem of existingMemories) {
                // Use deleteMemoryById if available, otherwise deleteMemory
                 if (typeof this.storageAdapter.deleteMemoryById === 'function') {
                    await this.storageAdapter.deleteMemoryById(mem.id);
                } else {
                    await this.storageAdapter.deleteMemory(mem.id); // Fallback
                }
            }
            this.logger.debug(`Removed existing memories for user ${userId}.`);

            if (content) {
                await this.storageAdapter.addMemory({
                    userId,
                    content,
                    type,
                    // Conditionally add metadata only if it's provided
                    ...(metadata !== undefined && { metadata }),
                });
                this.logger.info(`Added single new memory entry to replace old memory for user ${userId}.`);
            } else {
                this.logger.info(`Cleared all memory for user ${userId} (replace with empty content).`);
            }
        } catch (error) {
            this.logger.error(`Error replacing memory for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Deletes all memory entries for a specific user.
     */
    async clearUserMemory(userId: string): Promise<void> {
        this.logger.info(`Clearing all memory for user ${userId}.`);
        try {
            const existingMemories = await this.storageAdapter.getUserMemories(userId);
             this.logger.debug(`Found ${existingMemories.length} existing memories to clear for user ${userId}.`);
            for (const mem of existingMemories) {
                 // Use deleteMemoryById if available, otherwise deleteMemory
                 if (typeof this.storageAdapter.deleteMemoryById === 'function') {
                    await this.storageAdapter.deleteMemoryById(mem.id);
                } else {
                    await this.storageAdapter.deleteMemory(mem.id); // Fallback
                }
            }
            this.logger.info(`Successfully cleared ${existingMemories.length} memory entries for user ${userId}.`);
        } catch (error) {
            this.logger.error(`Error clearing memory for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves a specific memory entry by its ID.
     */
    async getMemoryById(memoryId: string): Promise<IMemory | null> {
        this.logger.debug(`Getting memory by ID: ${memoryId}`);
        try {
            if (typeof this.storageAdapter.getMemoryById === 'function') {
                 return await this.storageAdapter.getMemoryById(memoryId);
            } else {
                this.logger.warn('Storage adapter does not support getMemoryById.');
                throw new Error('getMemoryById is not supported by the current storage adapter.');
            }
        } catch (error) {
            this.logger.error(`Error getting memory by ID ${memoryId}:`, error);
            throw error;
        }
    }

    /**
     * Updates specific fields of a memory entry by its ID.
     */
    async updateMemoryById(memoryId: string, updates: Partial<Omit<IMemory, 'id' | 'userId' | 'timestamp'>>): Promise<boolean> {
        this.logger.debug(`Updating memory by ID: ${memoryId}`);
         try {
            if (typeof this.storageAdapter.updateMemoryById === 'function') {
                 return await this.storageAdapter.updateMemoryById(memoryId, updates);
            } else {
                 this.logger.warn('Storage adapter does not support updateMemoryById.');
                 throw new Error('updateMemoryById is not supported by the current storage adapter.');
            }
        } catch (error) {
            this.logger.error(`Error updating memory by ID ${memoryId}:`, error);
            throw error;
        }
    }

    /**
     * Deletes a specific memory entry by its ID.
     */
    async deleteMemoryById(memoryId: string): Promise<boolean> {
        this.logger.debug(`Deleting memory by ID: ${memoryId}`);
        try {
            if (typeof this.storageAdapter.deleteMemoryById === 'function') {
                 return await this.storageAdapter.deleteMemoryById(memoryId);
            } else {
                 this.logger.warn('Storage adapter does not support deleteMemoryById.');
                 throw new Error('deleteMemoryById is not supported by the current storage adapter.');
            }
        } catch (error) {
            this.logger.error(`Error deleting memory by ID ${memoryId}:`, error);
            throw error;
        }
    }

    // Helper function
    private escapeRegex(s: string): string {
        return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
}