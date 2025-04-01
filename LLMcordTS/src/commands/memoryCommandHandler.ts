// LLMcordTS/src/commands/memoryCommandHandler.ts
import { ChatInputCommandInteraction, Message, EmbedBuilder } from 'discord.js';
import { IMemoryStorage } from '@/memory/SQLiteMemoryStorage'; // Corrected import path
import { Config } from '@/types/config';
import { Logger } from '@/core/logger'; // Use path alias

export class MemoryCommandHandler {
    private memoryStorage: IMemoryStorage;
    private config: Config;
    private logger: Logger;

    constructor(memoryStorage: IMemoryStorage, config: Config, logger: Logger) {
        this.memoryStorage = memoryStorage;
        this.config = config;
        this.logger = logger.getSubLogger({ name: 'MemoryCmdHandler' });
        this.logger.info('MemoryCommandHandler initialized');
    }

    // --- Slash Command Handlers ---

    public async handleShowMemory(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.config.memory.enabled) {
            await interaction.reply({ content: 'Memory feature is disabled.', ephemeral: true });
            return;
        }
        const userId = interaction.user.id;
        try {
            const memory = await this.memoryStorage.getMemory(userId);
            if (!memory || memory.trim() === '') {
                await interaction.reply({ content: 'Your memory is currently empty.', ephemeral: true });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.user.username}'s Memory`)
                    .setDescription(`\`\`\`\n${memory}\n\`\`\``)
                    .setColor(0x00AE86)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        } catch (error) {
            this.logger.error(`Error fetching memory for user ${userId}:`, error);
            await interaction.reply({ content: 'Sorry, I encountered an error trying to retrieve your memory.', ephemeral: true });
        }
    }

    public async handleAppendMemory(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.config.memory.enabled) {
            await interaction.reply({ content: 'Memory feature is disabled.', ephemeral: true });
            return;
        }
        const userId = interaction.user.id;
        const textToAppend = interaction.options.getString('text', true);
        try {
            await this.memoryStorage.appendMemory(userId, textToAppend);
            await interaction.reply({ content: 'Text appended to your memory.', ephemeral: true });
            this.logger.info(`Appended memory for user ${userId}`);
        } catch (error) {
            this.logger.error(`Error appending memory for user ${userId}:`, error);
            await interaction.reply({ content: 'Sorry, I encountered an error trying to append to your memory.', ephemeral: true });
        }
    }

    public async handleReplaceMemory(interaction: ChatInputCommandInteraction): Promise<void> {
         if (!this.config.memory.enabled) {
            await interaction.reply({ content: 'Memory feature is disabled.', ephemeral: true });
            return;
        }
        const userId = interaction.user.id;
        const newMemory = interaction.options.getString('text', true);
        try {
            await this.memoryStorage.setMemory(userId, newMemory);
            await interaction.reply({ content: 'Your memory has been replaced.', ephemeral: true });
             this.logger.info(`Replaced memory for user ${userId}`);
        } catch (error) {
            this.logger.error(`Error replacing memory for user ${userId}:`, error);
            await interaction.reply({ content: 'Sorry, I encountered an error trying to replace your memory.', ephemeral: true });
        }
    }

     public async handleDeleteMemory(interaction: ChatInputCommandInteraction): Promise<void> {
         if (!this.config.memory.enabled) {
            await interaction.reply({ content: 'Memory feature is disabled.', ephemeral: true });
            return;
        }
        const userId = interaction.user.id;
        try {
            await this.memoryStorage.deleteMemory(userId);
            await interaction.reply({ content: 'Your memory has been cleared.', ephemeral: true });
             this.logger.info(`Deleted memory for user ${userId}`);
        } catch (error) {
            this.logger.error(`Error deleting memory for user ${userId}:`, error);
            await interaction.reply({ content: 'Sorry, I encountered an error trying to delete your memory.', ephemeral: true });
        }
    }

    // --- Legacy Command Handlers ---

    public async handleLegacyMemoryCommand(message: Message, args: string[]): Promise<void> {
        if (!this.config.memory.enabled) {
            await message.reply('Memory feature is disabled.');
            return;
        }

        const subCommand = args[0]?.toLowerCase();
        const userId = message.author.id;
        const textContent = args.slice(1).join(' ');

        try {
            switch (subCommand) {
                case 'show':
                case undefined: // Default to show if no subcommand
                    const memory = await this.memoryStorage.getMemory(userId);
                     if (!memory || memory.trim() === '') {
                        await message.reply('Your memory is currently empty.');
                    } else {
                         // Send in DM to keep it private like ephemeral slash commands
                        try {
                            await message.author.send(`**Your Memory:**\n\`\`\`\n${memory}\n\`\`\``);
                            if (message.guild) { // Avoid replying if already in DM
                                await message.reply('I\'ve sent your memory content via DM.');
                            }
                        } catch (dmError) {
                             this.logger.warn(`Could not send DM to user ${userId}. Replying in channel.`);
                             await message.reply(`**Your Memory:**\n\`\`\`\n${memory}\n\`\`\``);
                        }
                    }
                    break;
                case 'append':
                    if (!textContent) {
                        await message.reply('Please provide text to append. Usage: `!memory append <text>`');
                        return;
                    }
                    await this.memoryStorage.appendMemory(userId, textContent);
                    await message.reply('Text appended to your memory.');
                    this.logger.info(`Appended memory for user ${userId} via legacy command`);
                    break;
                case 'replace':
                     if (!textContent) {
                        await message.reply('Please provide the new memory content. Usage: `!memory replace <text>`');
                        return;
                    }
                    await this.memoryStorage.setMemory(userId, textContent);
                    await message.reply('Your memory has been replaced.');
                     this.logger.info(`Replaced memory for user ${userId} via legacy command`);
                    break;
                case 'forget':
                case 'delete':
                case 'clear':
                    await this.memoryStorage.deleteMemory(userId);
                    await message.reply('Your memory has been cleared.');
                     this.logger.info(`Deleted memory for user ${userId} via legacy command`);
                    break;
                default:
                    await message.reply('Invalid memory command. Use `!memory show`, `!memory append <text>`, `!memory replace <text>`, or `!memory forget`.');
            }
        } catch (error) {
            this.logger.error(`Error handling legacy memory command for user ${userId}:`, error);
            await message.reply('Sorry, I encountered an error processing your memory command.');
        }
    }

     public async handleLegacyForgetCommand(message: Message): Promise<void> {
         if (!this.config.memory.enabled) {
            await message.reply('Memory feature is disabled.');
            return;
        }
        const userId = message.author.id;
        try {
            await this.memoryStorage.deleteMemory(userId);
            await message.reply('Your memory has been cleared.');
             this.logger.info(`Deleted memory for user ${userId} via !forget command`);
        } catch (error) {
            this.logger.error(`Error handling !forget command for user ${userId}:`, error);
            await message.reply('Sorry, I encountered an error trying to clear your memory.');
        }
    }
}