// LLMcordTS/src/memory/SQLiteMemoryStorage.ts
import crypto from 'crypto';
import Database from 'better-sqlite3';
// Removed incorrect import: import { IMemoryStorage } from './memoryStorage';
import { logger } from '@/core/logger'; // Import shared logger instance
import { Config } from '@/core/config';
import { get_encoding, Tiktoken } from '@dqbd/tiktoken'; // Corrected import: Tiktoken instead of TiktokenEncoding
import { ProviderFactory } from '@/providers/providerFactory';
import { BaseProvider, ChatMessage, GenerationOptions } from '@/providers/baseProvider'; // Corrected import name and added ChatMessage, GenerationOptions

// Define the memory storage interface
export interface IMemoryStorage {
    getMemory(userId: string): Promise<string | null>;
    setMemory(userId: string, content: string): Promise<void>;
    appendMemory(userId: string, contentToAppend: string): Promise<void>;
    deleteMemory(userId: string): Promise<void>;
    getMemoryById(userId: string, entryId: string): Promise<string | null>;
    editMemoryById(userId: string, entryId: string, newContent: string): Promise<boolean>;
    deleteMemoryById(userId: string, entryId: string): Promise<boolean>;
    // Optional methods if needed by other parts of the application
    // loadMemory?(): Promise<void>;
    // saveMemory?(): Promise<void>;
    close?(): void; // Add close method if needed by interface users
}

// Define a type for the logger instance if needed for type hinting elsewhere
type LoggerInstance = typeof logger;

// Use cl100k_base encoding, common for GPT-3.5 and GPT-4
// Cache the encoding instance for performance
let encoding: Tiktoken | null = null; // Corrected type: Tiktoken | null
try {
    encoding = get_encoding('cl100k_base');
} catch (error) {
    logger.error('Failed to initialize tiktoken encoding:', error);
    // Handle the error appropriately, maybe fallback or throw
}

// Function to estimate token count using tiktoken
function estimateTokenCount(text: string): number {
    if (!encoding) {
        logger.warn('Tiktoken encoding not available, falling back to character count / 4');
        // Fallback to simple approximation if encoding failed
        return Math.ceil(text.length / 4);
    }
    try {
        const tokens = encoding.encode(text);
        return tokens.length;
    } catch (error) {
        logger.error('Failed to encode text with tiktoken:', error);
        // Fallback or return 0 on encoding error
        return Math.ceil(text.length / 4); // Fallback to approximation
    }
}


export class SQLiteMemoryStorage implements IMemoryStorage {
    private db: Database.Database;
    private logger: LoggerInstance;
    private config: Config;
    private providerFactory: ProviderFactory;
    private condensationProvider: BaseProvider | null = null; // Corrected type

    constructor(
        dbPath: string,
        loggerInstance: LoggerInstance,
        config: Config,
        providerFactory: ProviderFactory
    ) {
        this.logger = loggerInstance;
        this.config = config;
        this.providerFactory = providerFactory;

        try {
            this.db = new Database(dbPath);
            this.logger.info(`SQLite database connected at: ${dbPath}`);
            this.initializeSchema();
            this.initializeCondensationProvider(); // Initialize on startup
        } catch (error) {
            this.logger.error(`Failed to connect or initialize SQLite database at ${dbPath}:`, error);
            throw error; // Re-throw to prevent bot startup if DB fails
        }
    }

    private initializeCondensationProvider(): void {
        const condensationConfig = this.config.memory.condensation;
        if (condensationConfig?.enabled && condensationConfig.provider && condensationConfig.model) {
            try {
                this.condensationProvider = this.providerFactory.getProvider(
                    condensationConfig.provider,
                    condensationConfig.model // Pass model specifically for condensation
                    // Potentially add specific API key/config overrides here if needed
                );
                this.logger.info(`Condensation provider '${condensationConfig.provider}' initialized.`);
            } catch (error) {
                this.logger.error(`Failed to initialize condensation provider '${condensationConfig.provider}':`, error);
                this.condensationProvider = null; // Ensure it's null if init fails
            }
        } else {
            this.logger.info('Memory condensation is disabled or not fully configured.');
        }
    }


    private initializeSchema(): void {
        try {
            // Drop the old table if it exists (simple migration for now)
            // In a production scenario, a more robust migration strategy would be needed.
            this.db.exec('DROP TABLE IF EXISTS memory');
            this.logger.info('Dropped old memory table (if exists).');

            // Create the new memory_entries table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS memory_entries (
                    entryId TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                )
            `);
            this.logger.info('Created memory_entries table.');

            // Create an index on userId for faster lookups
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_memory_entries_userId
                ON memory_entries (userId)
            `);
            this.logger.info('Created index on userId for memory_entries.');

            this.logger.info('Memory table schema initialized successfully.');
        } catch (error) {
            this.logger.error('Failed to initialize database schema:', error);
            throw error;
        }
    }

    async getMemory(userId: string): Promise<string | null> {
        try {
            // Select all entries for the user, ordered by timestamp
            const stmt = this.db.prepare('SELECT content FROM memory_entries WHERE userId = ? ORDER BY timestamp ASC');
            const rows = stmt.all(userId) as { content: string }[];

            if (rows.length === 0) {
                return Promise.resolve(null);
            }

            // Concatenate content from all entries
            const fullMemory = rows.map(row => row.content).join('\n');
            return Promise.resolve(fullMemory);
        } catch (error) {
            this.logger.error(`Failed to get memory for userId ${userId}:`, error);
            return Promise.resolve(null); // Return null on error
        }
    }

    async setMemory(userId: string, content: string): Promise<void> {
        // This method now replaces all existing memory with a single new entry.
        const transaction = this.db.transaction(() => {
            try {
                // Delete existing entries
                const deleteStmt = this.db.prepare('DELETE FROM memory_entries WHERE userId = ?');
                deleteStmt.run(userId);

                // Insert the new entry
                const insertStmt = this.db.prepare('INSERT INTO memory_entries (entryId, userId, content, timestamp) VALUES (?, ?, ?, ?)');
                const entryId = crypto.randomUUID();
                const timestamp = Date.now();
                insertStmt.run(entryId, userId, content, timestamp);
                this.logger.debug(`Set memory for userId ${userId} with new entry ${entryId}.`);
            } catch (error) {
                this.logger.error(`Failed during setMemory transaction for userId ${userId}:`, error);
                // Transaction automatically rolls back on error
                throw error; // Re-throw to indicate failure if needed by caller, though interface returns void promise
            }
        });

        try {
            transaction();
            return Promise.resolve();
        } catch (error) {
            // Error already logged in transaction
            return Promise.resolve(); // Fulfill promise even on error as per interface
        }
    }

    async appendMemory(userId: string, contentToAppend: string): Promise<void> {
        try {
            // 1. Get current total memory content
            const currentFullMemory = await this.getMemory(userId); // Use existing getMemory which concatenates
            const memoryBeforeAppend = currentFullMemory ?? '';

            // 2. Estimate new total size
            const estimatedNewTotalContent = `${memoryBeforeAppend}\n${contentToAppend}`;
            const tokenCount = estimateTokenCount(estimatedNewTotalContent);
            const maxTokens = this.config.memory.condensation?.maxTokens ?? Infinity;

            // 3. Condense if needed (and enabled) BEFORE appending the new piece
            if (this.condensationProvider && tokenCount > maxTokens) {
                this.logger.info(`Memory for userId ${userId} would exceed token limit (${tokenCount}/${maxTokens}). Triggering condensation.`);
                // Await condensation here. _condenseMemory now uses setMemory which clears old entries.
                await this._condenseMemory(userId, memoryBeforeAppend);
                // Note: After successful condensation, memoryBeforeAppend is now outdated,
                // but we proceed to append the new content regardless.
            }

            // 4. Append the new content as a separate entry
            const insertStmt = this.db.prepare('INSERT INTO memory_entries (entryId, userId, content, timestamp) VALUES (?, ?, ?, ?)');
            const entryId = crypto.randomUUID();
            const timestamp = Date.now();
            insertStmt.run(entryId, userId, contentToAppend, timestamp);
            this.logger.debug(`Appended new memory entry ${entryId} for userId ${userId}.`);

            return Promise.resolve();
        } catch (error) {
            this.logger.error(`Failed during appendMemory operation for userId ${userId}:`, error);
            return Promise.resolve(); // Fulfill promise even on error
        }
    }

    async deleteMemory(userId: string): Promise<void> {
        // Deletes all memory entries for a user.
        try {
            const stmt = this.db.prepare('DELETE FROM memory_entries WHERE userId = ?');
            const result = stmt.run(userId);
            this.logger.info(`Deleted ${result.changes} memory entries for userId ${userId}.`);
            return Promise.resolve();
        } catch (error) {
            this.logger.error(`Failed to delete memory entries for userId ${userId}:`, error);
            return Promise.resolve();
        }
    }


    private async _condenseMemory(userId: string, currentMemory: string): Promise<void> {
        this.logger.info(`Attempting memory condensation for userId: ${userId}`);
        const condensationConfig = this.config.memory.condensation;

        if (!this.condensationProvider || !condensationConfig?.enabled) {
            this.logger.warn(`Condensation skipped for ${userId}: Provider not available or condensation disabled.`);
            // Fallback should ideally happen here if needed even without a provider attempt
            // but the trigger condition in appendMemory already checks for the provider.
            return;
        }

        // Define condensation-specific generation options (optional)
        const condensationOptions: GenerationOptions = {
            // Use specific temp/tokens for condensation if configured, else defaults from main config, with a final fallback
            temperature: condensationConfig.temperature ?? this.config.llm.defaultTemperature ?? 0.7, // Added final fallback
            // Use a specific maxOutputTokens for condensation, falling back to main default
            maxOutputTokens: condensationConfig.maxTokens ?? this.config.llm.defaultMaxTokens ?? 1024,
            // Condensation should not use tools
            tools: [],
        };

        try {
            // Use configured prompt or default. Note: Renamed 'condensation_prompt' to 'prompt' in config type.
            const systemPrompt = condensationConfig.prompt || 'You are a summarization assistant. Condense the following conversation history concisely, retaining key facts, decisions, and the overall narrative flow. Output only the summary.';
            const historyToCondense = currentMemory; // Use the full current memory

            this.logger.debug(`Condensing memory for ${userId} using prompt: "${systemPrompt}" and options: ${JSON.stringify(condensationOptions)}`);

            // Prepare messages for the LLM
            const messages: ChatMessage[] = [
                // System prompt might need to be handled differently depending on the provider
                // For now, assume it's passed separately if supported, otherwise prepended (handled by provider)
                { role: 'user', content: historyToCondense }
            ];

            // Call the condensation provider's stream
            const stream = this.condensationProvider.generateStream(
                messages,
                systemPrompt, // Pass system prompt separately
                condensationOptions
            );

            let summarizedMemory = '';
            for await (const chunk of stream) {
                if (chunk.content) {
                    summarizedMemory += chunk.content;
                }
                if (chunk.isFinal) {
                    this.logger.debug(`Condensation stream finished for ${userId}. Reason: ${chunk.finishReason}`);
                    break;
                }
            }

            summarizedMemory = summarizedMemory.trim(); // Clean up whitespace

            if (summarizedMemory) {
                this.logger.info(`Condensation successful for ${userId}. Updating memory (length: ${summarizedMemory.length}).`);
                // Prepend a notice that this is summarized history
                const finalCondensedMemory = `[Summarized History - ${new Date().toISOString()}]\n${summarizedMemory}`;
                await this.setMemory(userId, finalCondensedMemory);
            } else {
                this.logger.warn(`Condensation for ${userId} resulted in an empty summary. Applying fallback.`);
                // Trigger fallback manually if summary is empty
                throw new Error("Condensation resulted in empty summary.");
            }

        } catch (error) {
            this.logger.error(`Memory condensation LLM call failed for userId ${userId}:`, error);

            // Fallback (Truncation)
            this.logger.warn(`Applying fallback truncation for userId ${userId}.`);
            const maxTokens = condensationConfig.maxTokens ?? 2000; // Use configured max or a default
            const fallbackTargetTokens = condensationConfig.fallbackTruncateTokens ?? maxTokens * 0.75;
            // Simple character-based truncation for now
            const estimatedTargetChars = fallbackTargetTokens * 4; // Rough estimate
            const truncatedMemory = currentMemory.slice(-estimatedTargetChars);

            this.logger.info(`Truncated memory for ${userId} to approx ${fallbackTargetTokens} tokens (${truncatedMemory.length} chars).`);
            await this.setMemory(userId, `[Truncated History - ${new Date().toISOString()}]
${truncatedMemory}`); // Prepend notice
        }
    }


    // --- ID-based operations (Placeholders - Requires Schema Change) ---

    async getMemoryById(userId: string, entryId: string): Promise<string | null> {
        try {
            const stmt = this.db.prepare('SELECT content FROM memory_entries WHERE userId = ? AND entryId = ?');
            const row = stmt.get(userId, entryId) as { content: string } | undefined;
            return Promise.resolve(row ? row.content : null);
        } catch (error) {
            this.logger.error(`Failed to get memory entry ${entryId} for userId ${userId}:`, error);
            return Promise.resolve(null);
        }
    }

    async editMemoryById(userId: string, entryId: string, newContent: string): Promise<boolean> {
        try {
            const stmt = this.db.prepare('UPDATE memory_entries SET content = ?, timestamp = ? WHERE userId = ? AND entryId = ?');
            const timestamp = Date.now();
            const result = stmt.run(newContent, timestamp, userId, entryId);
            const success = result.changes > 0;
            if (success) {
                this.logger.debug(`Edited memory entry ${entryId} for userId ${userId}.`);
            } else {
                this.logger.warn(`Memory entry ${entryId} not found for userId ${userId} or content unchanged.`);
            }
            return Promise.resolve(success);
        } catch (error) {
            this.logger.error(`Failed to edit memory entry ${entryId} for userId ${userId}:`, error);
            return Promise.resolve(false);
        }
    }

    
        async deleteMemoryById(userId: string, entryId: string): Promise<boolean> {
            try {
                const stmt = this.db.prepare('DELETE FROM memory_entries WHERE userId = ? AND entryId = ?');
                const result = stmt.run(userId, entryId);
                const success = result.changes > 0;
                if (success) {
                    this.logger.info(`Deleted memory entry ${entryId} for userId ${userId}.`);
                } else {
                    this.logger.warn(`Memory entry ${entryId} not found for userId ${userId}.`);
                }
                return Promise.resolve(success);
            } catch (error) {
                this.logger.error(`Failed to delete memory entry ${entryId} for userId ${userId}:`, error);
                return Promise.resolve(false);
            }
        }
    // Optional methods from IMemoryStorage are not needed for direct DB operations
    // loadMemory?(): Promise<void>;
    // saveMemory?(): Promise<void>;

    // Add a method to close the database connection gracefully
    public close(): void {
        if (this.db) {
            this.db.close();
            this.logger.info('SQLite database connection closed.');
        }
    }
}