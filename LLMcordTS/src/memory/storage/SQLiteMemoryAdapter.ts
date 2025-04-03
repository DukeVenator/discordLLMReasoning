// LLMcordTS/src/memory/storage/SQLiteMemoryAdapter.ts

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Logger } from '../../core/logger'; // Correct path
import { IMemory, IMemoryStorageAdapter } from '../../types/memory'; // Correct path

export class SQLiteMemoryAdapter implements IMemoryStorageAdapter {
    private db: Database.Database;
    private logger: Logger;

    constructor(dbPath: string, logger: Logger) {
        this.logger = logger.getSubLogger({ name: 'SQLiteMemoryAdapter' });
        try {
            this.db = new Database(dbPath);
            this.logger.info(`SQLite database connected at: ${dbPath}`);
            // Schema initialization is now handled explicitly by the caller (LLMCordBot.initialize)
        } catch (error) {
            this.logger.error(`Failed to connect SQLite database at ${dbPath}:`, error);
            throw error; // Re-throw to prevent adapter instantiation if connection fails
        }
    }

    /**
     * Initializes the database schema.
     * Adds 'type' and 'metadata' columns.
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing database schema...');
        try {
            // Create the memory_entries table with new columns
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS memory_entries (
                    id TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    content TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'recall',
                    timestamp INTEGER NOT NULL,
                    metadata TEXT
                )
            `);
            this.logger.debug('Checked/Created memory_entries table.');

            // Add columns if they don't exist (simple migration)
            this.addColumnIfNotExists('memory_entries', 'type', 'TEXT NOT NULL DEFAULT \'recall\'');
            this.addColumnIfNotExists('memory_entries', 'metadata', 'TEXT');


            // Create index on userId
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_memory_entries_userId
                ON memory_entries (userId)
            `);
            this.logger.debug('Checked/Created index on userId.');

            this.logger.info('Database schema initialization complete.');
            return Promise.resolve();
        } catch (error) {
            this.logger.error('Failed to initialize database schema:', error);
            return Promise.reject(error); // Reject promise on error
        }
    }

    // Helper to add columns safely
    private addColumnIfNotExists(tableName: string, columnName: string, columnDefinition: string): void {
        try {
            const checkStmt = this.db.prepare(`PRAGMA table_info(${tableName})`);
            const columns = checkStmt.all() as { name: string }[];
            if (!columns.some(col => col.name === columnName)) {
                this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
                this.logger.info(`Added column '${columnName}' to table '${tableName}'.`);
            }
        } catch (error) {
             this.logger.error(`Failed to check/add column '${columnName}' to table '${tableName}':`, error);
             // Decide if this should throw or just log
        }
    }


    /**
     * Retrieves all memories for a given user ID, ordered by timestamp.
     */
    async getUserMemories(userId: string): Promise<IMemory[]> {
        this.logger.debug(`Getting memories for userId: ${userId}`);
        try {
            const stmt = this.db.prepare(`
                SELECT id, userId, content, type, timestamp, metadata
                FROM memory_entries
                WHERE userId = ?
                ORDER BY timestamp ASC
            `);
            const rows = stmt.all(userId) as any[]; // Use any for now, map below

            const memories: IMemory[] = rows.map(row => ({
                id: row.id,
                userId: row.userId,
                content: row.content,
                type: row.type, // Assuming type is stored directly
                timestamp: new Date(row.timestamp), // Convert DB timestamp (number) to Date
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined // Parse JSON metadata
            }));

            this.logger.debug(`Found ${memories.length} memories for userId: ${userId}`);
            return memories;
        } catch (error) {
            this.logger.error(`Failed to get memories for userId ${userId}:`, error);
            throw error; // Re-throw error
        }
    }

    /**
     * Adds a new memory item to the storage.
     */
    async addMemory(memoryData: Omit<IMemory, 'id' | 'timestamp'>): Promise<IMemory> {
        this.logger.debug(`Adding memory for userId: ${memoryData.userId}`);
        const entryId = crypto.randomUUID(); // Generate ID here
        const timestamp = Date.now();

        try {
            const stmt = this.db.prepare(`
                INSERT INTO memory_entries (id, userId, content, type, timestamp, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const metadataString = memoryData.metadata ? JSON.stringify(memoryData.metadata) : null;
            stmt.run(
                entryId,
                memoryData.userId,
                memoryData.content,
                memoryData.type,
                timestamp,
                metadataString
            );

            const newMemory: IMemory = {
                ...memoryData,
                id: entryId,
                timestamp: new Date(timestamp),
                // Conditionally add metadata only if it exists in memoryData
                ...(memoryData.metadata !== undefined && { metadata: memoryData.metadata }),
            };

            this.logger.info(`Added memory entry ${entryId} for userId ${memoryData.userId}.`);
            return newMemory;
        } catch (error) {
            this.logger.error(`Failed to add memory for userId ${memoryData.userId}:`, error);
            throw error; // Re-throw error to indicate failure
        }
    }

    /**
     * Updates an existing memory item.
     */
    async updateMemory(memory: IMemory): Promise<void> {
        this.logger.debug(`Updating memory entry ${memory.id} for userId ${memory.userId}`);
        try {
            const stmt = this.db.prepare(`
                UPDATE memory_entries
                SET content = ?, type = ?, timestamp = ?, metadata = ?
                WHERE id = ? AND userId = ?
            `);
            const timestamp = memory.timestamp.getTime(); // Convert Date back to number
            const metadataString = memory.metadata ? JSON.stringify(memory.metadata) : null;
            const result = stmt.run(
                memory.content,
                memory.type,
                timestamp,
                metadataString,
                memory.id,
                memory.userId
            );

            if (result.changes > 0) {
                this.logger.info(`Updated memory entry ${memory.id} for userId ${memory.userId}.`);
            } else {
                this.logger.warn(`Memory entry ${memory.id} not found for userId ${memory.userId} during update.`);
                // Optional: Throw an error if update target must exist
                // throw new Error(`Memory entry ${memory.id} not found for user ${memory.userId}`);
            }
            return Promise.resolve();
        } catch (error) {
            this.logger.error(`Failed to update memory entry ${memory.id} for userId ${memory.userId}:`, error);
            return Promise.reject(error); // Reject promise on error
        }
    }

    /**
     * Deletes a memory item by its ID.
     */
    async deleteMemory(memoryId: number | string): Promise<void> {
         // Ensure memoryId is treated as string for consistency with UUID PK
        const idString = String(memoryId);
        this.logger.debug(`Deleting memory entry ${idString}`);
        try {
            const stmt = this.db.prepare('DELETE FROM memory_entries WHERE id = ?');
            const result = stmt.run(idString);

            if (result.changes > 0) {
                this.logger.info(`Deleted memory entry ${idString}.`);
            } else {
                this.logger.warn(`Memory entry ${idString} not found during delete.`);
                 // Optional: Throw an error if delete target must exist
                // throw new Error(`Memory entry ${idString} not found`);
            }
            return Promise.resolve();
        } catch (error) {
            this.logger.error(`Failed to delete memory entry ${idString}:`, error);
            return Promise.reject(error); // Reject promise on error
        }
    }


    /**
     * Retrieves a specific memory entry by its ID.
     */
    async getMemoryById(memoryId: string): Promise<IMemory | null> {
        this.logger.debug(`Getting memory entry by ID: ${memoryId}`);
        try {
            const stmt = this.db.prepare(`
                SELECT id, userId, content, type, timestamp, metadata
                FROM memory_entries
                WHERE id = ?
            `);
            const row = stmt.get(memoryId) as any; // Use any for now, map below

            if (!row) {
                this.logger.debug(`Memory entry ${memoryId} not found.`);
                return null;
            }

            const memory: IMemory = {
                id: row.id,
                userId: row.userId,
                content: row.content,
                type: row.type,
                timestamp: new Date(row.timestamp),
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined
            };

            this.logger.debug(`Found memory entry ${memoryId}.`);
            return memory;
        } catch (error) {
            this.logger.error(`Failed to get memory entry ${memoryId}:`, error);
            return null; // Return null on error
        }
    }

    /**
     * Updates specific fields of a memory entry by its ID.
     */
    async updateMemoryById(memoryId: string, updates: Partial<Omit<IMemory, 'id' | 'userId' | 'timestamp'>>): Promise<boolean> {
        this.logger.debug(`Updating memory entry ${memoryId}`);
        const updateFields = Object.keys(updates) as (keyof typeof updates)[];

        if (updateFields.length === 0) {
            this.logger.warn(`Update called for memory ${memoryId} with no fields to update.`);
            return false; // Nothing to update
        }

        // Always update the timestamp
        const timestamp = Date.now();
        const setClauses: string[] = ['timestamp = ?'];
        const values: (string | number | null)[] = [timestamp];

        // Build SET clauses and values array dynamically
        for (const field of updateFields) {
            if (field === 'metadata') {
                setClauses.push('metadata = ?');
                values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
            } else if (field === 'content' || field === 'type') { // Add other updatable fields here
                setClauses.push(`${field} = ?`);
                values.push(updates[field] as string); // Assume string for content/type
            }
        }

        // Add the memoryId to the values array for the WHERE clause
        values.push(memoryId);

        const sql = `UPDATE memory_entries SET ${setClauses.join(', ')} WHERE id = ?`;

        try {
            const stmt = this.db.prepare(sql);
            const result = stmt.run(...values);

            const success = result.changes > 0;
            if (success) {
                this.logger.info(`Updated memory entry ${memoryId}.`);
            } else {
                this.logger.warn(`Memory entry ${memoryId} not found during partial update.`);
            }
            return success;
        } catch (error) {
            this.logger.error(`Failed to partially update memory entry ${memoryId}:`, error);
            return false; // Return false on error
        }
    }

    /**
     * Deletes a specific memory entry by its ID.
     */
    async deleteMemoryById(memoryId: string): Promise<boolean> {
        this.logger.debug(`Deleting memory entry by ID: ${memoryId}`);
        try {
            const stmt = this.db.prepare('DELETE FROM memory_entries WHERE id = ?');
            const result = stmt.run(memoryId);
            const success = result.changes > 0;
            if (success) {
                this.logger.info(`Deleted memory entry ${memoryId}.`);
            } else {
                this.logger.warn(`Memory entry ${memoryId} not found during ID-based delete.`);
            }
            return success;
        } catch (error) {
            this.logger.error(`Failed to delete memory entry ${memoryId}:`, error);
            return false; // Return false on error
        }
    }

    /**
     * Closes the database connection.
     */
    public close(): void {
        if (this.db) {
            this.db.close();
            this.logger.info('SQLite database connection closed.');
        }
    }
}