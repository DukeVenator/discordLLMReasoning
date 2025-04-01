/**
 * @fileoverview Defines event handlers for the Discord client.
 * Includes handlers for the 'ready' and 'messageCreate' events.
 */
// LLMcordTS/src/discord/eventHandlers.ts
import { Message } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
import { LLMCordBot } from '../core/LLMCordBot'; // Import the main bot class type
import { checkPermissions } from '../utils/permissions'; // Import permissions check
// import { MemoryCommandHandler } from '../commands/memoryCommandHandler'; // Removed unused import

/**
 * Handles the 'ready' event when the bot successfully connects to Discord.
 * @param bot - The LLMCordBot instance.
 */
export async function onReady(bot: LLMCordBot): Promise<void> { // Make the function async and return Promise<void>
    if (!bot.client.user) {
        bot.logger.error('Error: Bot client user is not available on ready event.');
        return;
    }
    bot.logger.info(`Logged in as ${bot.client.user.tag}!`);
    bot.logger.info(`Bot ID: ${bot.client.user.id}`);
    bot.logger.info('Bot is ready!');

    // Construct and log invite URL
    const permissions = new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.UseApplicationCommands,
        // PermissionsBitField.Flags.EmbedLinks, // Optional: Add if needed later
    ]).bitfield;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${bot.client.user.id}&permissions=${permissions}&scope=bot%20applications.commands`;
    bot.logger.info(`Invite URL: ${inviteUrl}`);

    // Start status manager
    bot.statusManager.start();

    // Sync slash commands
    bot.logger.info('Syncing slash commands...');
    await bot.slashCommandHandler.registerCommands(); // Call the registration method
}

/**
 * Handles the 'messageCreate' event when a message is sent in a channel the bot has access to.
 * @param bot - The LLMCordBot instance.
 * @param message - The message object received from Discord.
 */
export async function onMessageCreate(bot: LLMCordBot, message: Message): Promise<void> {
    // ADDED LOG: Track entry into the handler
    bot.logger.debug(`[EventHandler][${message.id}] onMessageCreate entered.`);

    // 1. Basic Checks
    if (message.author.bot) {
        // ADDED LOG: Track ignored bot message
        bot.logger.debug(`[EventHandler][${message.id}] Ignoring message: Author is a bot.`);
        return;
    }
    if (!message.content) {
        // ADDED LOG: Track ignored empty message
        bot.logger.debug(`[EventHandler][${message.id}] Ignoring message: No content.`);
        return;
    }

    // 1.5 Strict Filtering: Process only DMs (if allowed), mentions, or replies
    const isDM = !message.guild;
    const isMentioned = message.mentions.has(bot.client.user!.id);
    const isReplyToBot = message.reference?.messageId ? 
        await message.channel.messages.fetch(message.reference.messageId)
            .then(repliedMsg => repliedMsg.author.id === bot.client.user!.id)
            .catch(() => false) // Ignore fetch errors (e.g., deleted message)
        : false;

    // ADDED LOG: Track filter conditions
    bot.logger.debug(`[EventHandler][${message.id}] Filter conditions: isDM=${isDM}, allowDMs=${bot.config.allowDms}, isMentioned=${isMentioned}, isReplyToBot=${isReplyToBot}`);

    if (!( (isDM && bot.config.allowDms) || isMentioned || isReplyToBot )) {
        // ADDED LOG: Track ignored message due to filter
        bot.logger.debug(`[EventHandler][${message.id}] Ignoring message: Did not meet DM/mention/reply criteria.`);
        return; // Ignore messages that don't meet criteria
    }

    // Log processed message details
    const logPrefix = isDM ? `[DM][${message.author.tag}]` : `[${message.guild.name}][#${(message.channel as any).name}]`;
    bot.logger.info(`${logPrefix} ${message.author.tag}: ${message.content}`);

    // 2. Rate Limiting Check
    const [allowed, reason] = bot.rateLimiter.checkRateLimit(message.author.id);
    if (!allowed) {
        const cooldown = bot.rateLimiter.getCooldownRemaining(message.author.id);
        const limitType = reason === 'global' ? 'Global' : 'User';
        bot.logger.warn(`${limitType} rate limit hit for user ${message.author.id}. Cooldown: ${cooldown.toFixed(2)}s`);

        // Set temporary status when rate limited
        const tempStatusDuration = 5; // seconds
        bot.statusManager.setTemporaryStatus(
            `${limitType} Rate Limited`,
            tempStatusDuration,
            undefined, // Default type (Playing)
            'idle' // Set presence to idle
        );

        try {
            await message.reply(
                `⏳ ${limitType} rate limit reached. Please wait ${cooldown.toFixed(1)} seconds.`,
                // mention_author=False equivalent is not directly available, default is true
                // delete_after is not available in discord.js v14 message.reply
            ).then(replyMsg => {
                // Manually delete after timeout
                setTimeout(() => replyMsg.delete().catch(err => bot.logger.error(`Failed to delete rate limit reply: ${err}`)), Math.max(5000, Math.min(cooldown * 1000, 15000)));
            });
        } catch (err) {
            bot.logger.error(`Failed to send rate limit message: ${err}`);
        }
        // ADDED LOG: Track rate limit return
        bot.logger.debug(`[EventHandler][${message.id}] Returning due to rate limit.`);
        return; // Stop processing
    }

    // 3. Permissions Check (Only for guild messages)
    if (!isDM && !checkPermissions(message, bot.config)) {
        bot.logger.info(`User ${message.author.tag} (ID: ${message.author.id}) lacks permission in channel ${message.channel.id}.`);
        // Optionally send a message, but often better to just ignore
        // await message.reply("You don't have permission to use this bot here.");
        // ADDED LOG: Track permission return
        bot.logger.debug(`[EventHandler][${message.id}] Returning due to permissions check.`);
        return; // Stop processing
    }

    // 4. Placeholder: Command Handling (Simple Prefix Example - Adapt for Slash Commands later)
    // const prefix = bot.config.commandPrefix || '!'; // Example prefix
    // if (message.content.startsWith(prefix)) {
    //     const args = message.content.slice(prefix.length).trim().split(/ +/);
    //     const commandName = args.shift()?.toLowerCase();
    //     console.log(`Placeholder: Handling command '${commandName}' with args: ${args.join(', ')}`);
    //     // await bot.commandHandler.handle(message, commandName, args); // Example future call
    //     return; // Don't process as a regular message if it's a command
    // }

    // Legacy prefix command handling removed (use slash commands instead)

    // 5. Placeholder: Check if bot is mentioned or if it should respond in the channel
    // const isMentioned = message.mentions.has(bot.client.user!.id); // Removed unused variable
    // const shouldRespond = checkChannelConfig(bot, message.channel.id); // Example future check
    // if (!isMentioned && !shouldRespond) {
    //     return; // Only respond if mentioned or in configured channels (adjust logic as needed)
    // }

    // 6. Call Core Message Processing Logic (Placeholder)
    // 6. Call Core Message Processing Logic
    try {
        // ADDED LOG: Track call to processMessage
        bot.logger.debug(`[EventHandler][${message.id}] Calling bot.processMessage...`);
        await bot.processMessage(message);
        // ADDED LOG: Track return from processMessage
        bot.logger.debug(`[EventHandler][${message.id}] Returned from bot.processMessage.`);
    } catch (error) {
        bot.logger.error(`Error processing message ID ${message.id}:`, error);
        // Optionally reply to the user about the error
        // await message.reply("Sorry, I encountered an error trying to process your message.");
    }
    // ADDED LOG: Track exit from the handler
    bot.logger.debug(`[EventHandler][${message.id}] onMessageCreate finished.`);
}

// Placeholder for channel configuration check
// function checkChannelConfig(bot: LLMCordBot, channelId: string): boolean {
//     // Implement logic to check if the bot should be active in this channel
//     return true; // Default to true for now
// }