import { ChatInputCommandInteraction } from 'discord.js';
import { IMemoryManager } from '@/types/memory'; // Use the manager interface
// import { Config } from '@/core/config'; // Removed unused import
import { logger } from '@/core/logger';

type LoggerInstance = typeof logger;

export class MemoryCommandHandler {
    private memoryManager: IMemoryManager; // Rename and change type
    // private config: Config; // Removed unused property
    private logger: LoggerInstance;

    constructor(memoryManager: IMemoryManager, loggerInstance: LoggerInstance) { // Update constructor parameter
        this.memoryManager = memoryManager; // Assign to the new property
        this.logger = loggerInstance.getSubLogger({ name: 'MemoryCommandHandler' }); // Create sub-logger
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
                    await this.handleEdit(interaction);
                    break;
                case 'delete':
                    await this.handleDelete(interaction);
                    break;
                case 'view':
                    await this.handleView(interaction);
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
        // Use getUserMemory which returns an array
        const memories = await this.memoryManager.getUserMemory(userId);
        if (memories && memories.length > 0) {
            // Format the array of memories into a string for display
            const formattedMemory = memories
                .map(mem => `[${mem.id.substring(0, 6)}] (${mem.type}): ${mem.content}`) // Show ID prefix and type
                .join('\n');
            const content = formattedMemory.length > 1900 ? formattedMemory.substring(0, 1900) + '... (truncated)' : formattedMemory;
            await interaction.reply({ content: `Your current memory entries:\n\`\`\`\n${content}\n\`\`\``, ephemeral: true });
        } else {
            await interaction.reply({ content: 'You have no memory stored.', ephemeral: true });
        }
    }

    private async handleAppend(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const textToAppend = interaction.options.getString('text', true);
        // Use addMemory with a default type like 'recall' or 'core'
        await this.memoryManager.addMemory(userId, textToAppend, 'recall');
        await interaction.reply({ content: 'Text appended to your memory.', ephemeral: true });
    }

    private async handleReplace(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        const newText = interaction.options.getString('text', true);
        // Use replaceMemory
        await this.memoryManager.replaceMemory(userId, newText, 'core'); // Assume replace sets 'core' memory
        await interaction.reply({ content: 'Your memory has been replaced.', ephemeral: true });
    }

    private async handleForget(interaction: ChatInputCommandInteraction, userId: string): Promise<void> {
        // Use clearUserMemory
        await this.memoryManager.clearUserMemory(userId);
        await interaction.reply({ content: 'Your memory has been cleared.', ephemeral: true });
    }

    private async handleEdit(interaction: ChatInputCommandInteraction): Promise<void> { // Removed unused userId
        const entryId = interaction.options.getString('id', true);
        const newContent = interaction.options.getString('content', true);

        // Note: This relies on the placeholder implementation in storage for now.
        // Use updateMemoryById - Note: userId is not needed for manager method
        // Note: updateMemoryById doesn't need userId
        const success = await this.memoryManager.updateMemoryById(entryId, { content: newContent });

        if (success) {
            await interaction.reply({ content: `Memory entry \`${entryId}\` updated successfully.`, ephemeral: true });
        } else {
            // This message might be inaccurate until storage is fully implemented
            await interaction.reply({ content: `Could not find or edit memory entry \`${entryId}\`. (Note: ID-based editing might not be fully implemented yet).`, ephemeral: true });
        }
    }

    private async handleDelete(interaction: ChatInputCommandInteraction): Promise<void> { // Removed unused userId
        const entryId = interaction.options.getString('id', true);

        // Note: This relies on the placeholder implementation in storage for now.
        // Use deleteMemoryById - Note: userId is not needed for manager method
        // Note: deleteMemoryById doesn't need userId
        const success = await this.memoryManager.deleteMemoryById(entryId);

        if (success) {
            await interaction.reply({ content: `Memory entry \`${entryId}\` deleted successfully.`, ephemeral: true });
        } else {
            // This message might be inaccurate until storage is fully implemented
            await interaction.reply({ content: `Could not find or delete memory entry \`${entryId}\`. (Note: ID-based deletion might not be fully implemented yet).`, ephemeral: true });
        }
    }

     private async handleView(interaction: ChatInputCommandInteraction): Promise<void> { // Removed unused userId
        const entryId = interaction.options.getString('id', true);

        // Note: This relies on the placeholder implementation in storage for now.
        // Use getMemoryById - Note: userId is not needed for manager method
        // Note: getMemoryById doesn't need userId
        const memoryEntry = await this.memoryManager.getMemoryById(entryId);

        if (memoryEntry) {
            // memoryEntry is now an IMemory object
            const content = memoryEntry.content.length > 1900 ? memoryEntry.content.substring(0, 1900) + '... (truncated)' : memoryEntry.content;
            await interaction.reply({ content: `Memory entry \`${entryId}\` (${memoryEntry.type}):\n\`\`\`\n${content}\n\`\`\``, ephemeral: true });
        } else {
             // This message might be inaccurate until storage is fully implemented
            await interaction.reply({ content: `Could not find memory entry \`${entryId}\`. (Note: ID-based viewing might not be fully implemented yet).`, ephemeral: true });
        }
    }
}