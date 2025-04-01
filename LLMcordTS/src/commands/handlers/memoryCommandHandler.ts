import { ChatInputCommandInteraction } from 'discord.js';
import { IMemoryStorage } from '@/memory/SQLiteMemoryStorage'; // Corrected import path
// import { Config } from '@/core/config'; // Removed unused import
import { logger } from '@/core/logger';

type LoggerInstance = typeof logger;

export class MemoryCommandHandler {
    private memoryStorage: IMemoryStorage;
    // private config: Config; // Removed unused property
    private logger: LoggerInstance;

    constructor(memoryStorage: IMemoryStorage, /* config: Config, */ loggerInstance: LoggerInstance) { // Removed unused config parameter
        this.memoryStorage = memoryStorage;
        // this.config = config; // Removed assignment of unused property
        this.logger = loggerInstance;
    }

    async handle(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        try {
            switch (subcommand) {
                case 'show':
                    await this.handleShow(interaction, userId);
                    break;
                case 'append':
                    await this.handleAppend(interaction, userId);
                    break;
                case 'replace':
                    await this.handleReplace(interaction, userId);
                    break;
                case 'forget':
                    await this.handleForget(interaction, userId);
                    break;
                case 'edit':
                    await this.handleEdit(interaction, userId);
                    break;
                case 'delete':
                    await this.handleDelete(interaction, userId);
                    break;
                case 'view':
                    await this.handleView(interaction, userId);
                    break;
                default:
                    await interaction.reply({ content: 'Unknown memory subcommand.', ephemeral: true });
            }
        } catch (error) {
            this.logger.error(`Error handling memory command '${subcommand}' for user ${userId}:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'An error occurred while processing your memory command.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'An error occurred while processing your memory command.', ephemeral: true });
            }
        }
    }

    private async handleShow(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const memory = await this.memoryStorage.getMemory(userId);
        if (memory) {
            // Consider potential length limits for Discord messages
            const content = memory.length > 1900 ? memory.substring(0, 1900) + '... (truncated)' : memory;
            await interaction.reply({ content: `Your current memory:\n\`\`\`\n${content}\n\`\`\``, ephemeral: true });
        } else {
            await interaction.reply({ content: 'You have no memory stored.', ephemeral: true });
        }
    }

    private async handleAppend(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const textToAppend = interaction.options.getString('text', true);
        await this.memoryStorage.appendMemory(userId, textToAppend);
        await interaction.reply({ content: 'Text appended to your memory.', ephemeral: true });
    }

    private async handleReplace(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const newText = interaction.options.getString('text', true);
        await this.memoryStorage.setMemory(userId, newText);
        await interaction.reply({ content: 'Your memory has been replaced.', ephemeral: true });
    }

    private async handleForget(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        await this.memoryStorage.deleteMemory(userId);
        await interaction.reply({ content: 'Your memory has been cleared.', ephemeral: true });
    }

    private async handleEdit(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const entryId = interaction.options.getString('id', true);
        const newContent = interaction.options.getString('content', true);

        // Note: This relies on the placeholder implementation in storage for now.
        const success = await this.memoryStorage.editMemoryById(userId, entryId, newContent);

        if (success) {
            await interaction.reply({ content: `Memory entry \`${entryId}\` updated successfully.`, ephemeral: true });
        } else {
            // This message might be inaccurate until storage is fully implemented
            await interaction.reply({ content: `Could not find or edit memory entry \`${entryId}\`. (Note: ID-based editing might not be fully implemented yet).`, ephemeral: true });
        }
    }

    private async handleDelete(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const entryId = interaction.options.getString('id', true);

        // Note: This relies on the placeholder implementation in storage for now.
        const success = await this.memoryStorage.deleteMemoryById(userId, entryId);

        if (success) {
            await interaction.reply({ content: `Memory entry \`${entryId}\` deleted successfully.`, ephemeral: true });
        } else {
            // This message might be inaccurate until storage is fully implemented
            await interaction.reply({ content: `Could not find or delete memory entry \`${entryId}\`. (Note: ID-based deletion might not be fully implemented yet).`, ephemeral: true });
        }
    }

     private async handleView(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const entryId = interaction.options.getString('id', true);

        // Note: This relies on the placeholder implementation in storage for now.
        const memoryEntry = await this.memoryStorage.getMemoryById(userId, entryId);

        if (memoryEntry) {
            const content = memoryEntry.length > 1900 ? memoryEntry.substring(0, 1900) + '... (truncated)' : memoryEntry;
            await interaction.reply({ content: `Memory entry \`${entryId}\`:\n\`\`\`\n${content}\n\`\`\``, ephemeral: true });
        } else {
             // This message might be inaccurate until storage is fully implemented
            await interaction.reply({ content: `Could not find memory entry \`${entryId}\`. (Note: ID-based viewing might not be fully implemented yet).`, ephemeral: true });
        }
    }
}