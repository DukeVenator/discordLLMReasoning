/**
 * @fileoverview Manages the lifecycle of sending and updating Discord responses,
 * handling streaming, formatting, truncation, and errors.
 */

import { MessageEditOptions, MessagePayload, EmbedBuilder, MessageCreateOptions, DiscordAPIError } from 'discord.js'; // Added DiscordAPIError
import { Config } from '../types/config';
import { Logger } from '../core/logger';
import { IResponseManager, ResponseManagerOptions, DiscordMessage } from '../types/discord';

const DEFAULT_INITIAL_CONTENT = '🧠 Thinking...';
const DISCORD_MESSAGE_LIMIT = 2000; // Discord's character limit per message

export class ResponseManager implements IResponseManager {
    private readonly originalMessage: DiscordMessage;
    private readonly config: Config;
    private readonly logger: Logger;
    private readonly initialContent: string;
    private readonly streamingUpdateInterval: number;
    private readonly usePlainResponses: boolean;

    private botResponse: DiscordMessage | null = null;
    private buffer: string = '';
    private lastUpdateTime: number = 0;
    private updateTimeout: NodeJS.Timeout | null = null;
    private isFinalized: boolean = false; // Renamed flag
    private totalSentLength: number = 0;
    private currentMessageContent: string = ''; // Accumulated content for the current message

    constructor(options: ResponseManagerOptions) {
        this.originalMessage = options.originalMessage;
        this.config = options.config;
        this.logger = options.logger.getSubLogger({
            name: 'ResponseManager',
            messageId: this.originalMessage.id,
            userId: this.originalMessage.author.id,
        });
        this.initialContent = options.initialContent ?? DEFAULT_INITIAL_CONTENT;
        this.streamingUpdateInterval = this.config.discord.streamingUpdateIntervalMs ?? 1500;
        this.usePlainResponses = this.config.discord.usePlainResponses ?? false;
        this.logger.debug(`ResponseManager initialized for message ${this.originalMessage.id}`);
    }

    async sendInitialResponse(): Promise<void> {
        if (this.botResponse) {
            this.logger.warn('Initial response already sent.');
            return;
        }
        try {
            this.logger.debug(`Sending initial response: "${this.initialContent}"`);
            this.botResponse = await this.originalMessage.reply(this.initialContent);
            this.lastUpdateTime = Date.now();
            this.totalSentLength = this.initialContent.length;
            this.logger.info(`Initial response sent (ID: ${this.botResponse.id})`);
        } catch (error: any) {
            this.logger.error(`Failed to send initial response: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * Updates the response message with a new chunk of content.
     * Handles buffering and schedules updates based on interval.
     */
    async updateResponse(chunk: string): Promise<void> { // Removed isFinal parameter
        if (this.isFinalized) {
            this.logger.warn('Attempted to update response after it was finalized.');
            return;
        }
        if (!this.botResponse) {
            // Log error, but don't throw, allow finalize to potentially send error
            this.logger.error('Cannot update response: Initial response not sent or failed.');
            return;
        }

        this.buffer += chunk;
        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastUpdateTime;

        // If interval passed, send immediately
        if (timeSinceLastUpdate >= this.streamingUpdateInterval) {
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
                this.updateTimeout = null;
            }
            await this._sendBufferedUpdate(false); // Not the final segment yet
        } else if (!this.updateTimeout) {
            // Otherwise, schedule an update if one isn't already scheduled
            const timeUntilNextUpdate = this.streamingUpdateInterval - timeSinceLastUpdate;
            this.updateTimeout = setTimeout(async () => {
                if (this.updateTimeout && !this.isFinalized) { // Check finalized flag
                    await this._sendBufferedUpdate(false).catch(err => this.logger.error('Error in scheduled update:', err));
                    this.updateTimeout = null;
                }
            }, timeUntilNextUpdate);
        }
    }

     /**
     * Finalizes the response process. Sends any remaining buffered content
     * and applies final formatting. Sets the internal finalized flag.
     */
     public async finalize(): Promise<void> {
        if (this.isFinalized) {
            this.logger.warn('Response already finalized.');
            return;
        }
        this.isFinalized = true; // Set flag immediately
        this.logger.info(`Finalizing response for message ${this.originalMessage.id}.`);

        // Clear any pending timeout
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
            this.logger.debug('Cleared pending update timeout during finalization.');
        }

        // Send any remaining buffered content as the final segment
        try {
            // Removed debug log
            // Removed redundant log line
            if (this.buffer.length > 0) {
                this.logger.debug(`Sending final buffered content (length: ${this.buffer.length}).`);
                // Pass true because this is the last segment being sent by finalize()
                await this._sendBufferedUpdate(true);
            } else if (this.botResponse) {
                 // If buffer is empty, still apply final formatting (e.g., remove streaming indicator)
                 await this._applyFinalFormatting();
            } else {
                 this.logger.warn('Finalizing response, but no initial message exists and buffer is empty.');
            }
        } catch (error) {
             this.logger.error('Error during final update/formatting:', error);
             // Optionally call handleError here if finalization itself fails critically
             // await this.handleError(new Error('Failed during finalization step.'));
        }

        this.logger.info(`Response finalized for message ${this.originalMessage.id}.`);
    }

    /**
     * Replaces the entire content of the managed message with new content.
     * Useful for status updates that should overwrite previous content.
     * @param {string} newContent - The new content to display.
     */
    public async replaceContent(newContent: string): Promise<void> {
        if (!this.botResponse) {
            this.logger.error("Cannot replace content: Initial response doesn't exist.");
            return;
        }
        if (this.isFinalized) {
            this.logger.warn('Attempted to replace content after finalization.');
            return;
        }

        this.logger.debug(`Replacing message content with: "${newContent}"`);

        // Clear any pending stream updates
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }
        this.buffer = ''; // Clear stream buffer

        // Update internal state
        this.currentMessageContent = newContent;
        this.totalSentLength = newContent.length;
        this.lastUpdateTime = Date.now(); // Update time

        try {
            // Create payload (mark as not final, like a stream update)
            const payload = this._createPayload(this.currentMessageContent, false);
            await this.botResponse.edit(payload);
            this.logger.debug(`Message content replaced successfully.`);
        } catch (error: any) {
            this.logger.error(`Failed to replace message content: ${error.message}`, error);
            // Decide if we need to re-throw or handle differently
            // For now, just log the error.
        }
    }



    /**
     * Handles errors during the response lifecycle. Can be called externally or internally.
     */
    async handleError(error: Error): Promise<void> {
        // Avoid handling errors if already finalized, unless it's a finalization error itself?
        // For simplicity, allow error handling even if finalized, it will just try to edit/reply once.
        this.logger.error(`Handling error during response management: ${error.message}`, error);

        // Ensure future updates are stopped
        this.isFinalized = true;
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }

        try {
            const errorMessage = `❌ An error occurred: ${error.message}`;
            const truncatedError = errorMessage.substring(0, DISCORD_MESSAGE_LIMIT);

            if (this.botResponse) {
                // Try editing existing message
                await this.botResponse.edit(truncatedError);
                this.logger.info(`Edited message ${this.botResponse.id} with error.`);
            } else {
                // If initial send failed, try replying with the error
                await this.originalMessage.reply(truncatedError);
                this.logger.info(`Replied to message ${this.originalMessage.id} with error as initial send failed.`);
            }
        } catch (sendError: any) {
            // Log secondary error if sending the error message fails
            this.logger.error(`Failed to send error message to Discord: ${sendError.message}`, sendError);
        }
    }

    /**
     * Internal method to process and send the buffered content.
     * @param {boolean} isFinalSegment - Indicates if this is the last segment for the *current* message being edited/sent.
     */
    private async _sendBufferedUpdate(isFinalSegment: boolean): Promise<void> {
        if (!this.botResponse) {
             this.logger.error("Attempted to send update but initial response doesn't exist.");
             return;
        }
        if (this.buffer.length === 0) {
            // If buffer is empty, only proceed if this is marked as the final segment
            // to apply final formatting (e.g. remove streaming indicator)
            if (isFinalSegment) {
                 await this._applyFinalFormatting();
            }
            return;
        }

        const contentChunk = this.buffer; // The new chunk to process
        this.buffer = ''; // Clear buffer now that chunk is being processed
        this.lastUpdateTime = Date.now();

        let contentForThisEdit = this.currentMessageContent; // Start with what's already in the message
        let remainingContentForNextMessage: string | null = null;
        let needsFollowUp = false;
        const isPotentiallyFinal = isFinalSegment; // Store original final flag

        // --- Truncation and Splitting ---
        const potentialFullLength = this.currentMessageContent.length + contentChunk.length;
        if (potentialFullLength > DISCORD_MESSAGE_LIMIT) {
            const availableSpace = DISCORD_MESSAGE_LIMIT - this.currentMessageContent.length;
            if (availableSpace > 10) { // Can fit part of the chunk
                const partOfChunkToFit = contentChunk.substring(0, availableSpace - 3);
                contentForThisEdit += partOfChunkToFit + '...';
                remainingContentForNextMessage = contentChunk.substring(availableSpace - 3);
                this.logger.warn(`Segment truncated. Splitting message.`);
                needsFollowUp = true;
                isFinalSegment = true; // This message part is now considered done, even if the whole response isn't
            } else { // Cannot fit any reasonable part of the chunk
                this.logger.warn(`Current message full. Moving chunk to next message.`);
                // contentForThisEdit remains unchanged (what was already there)
                remainingContentForNextMessage = contentChunk; // Whole chunk moves
                needsFollowUp = true;
                isFinalSegment = true; // This message part is also done
            }
        } else {
            // No truncation needed for this message part
            contentForThisEdit += contentChunk;
            isFinalSegment = isPotentiallyFinal; // Use the original final flag
        }

        // Update the accumulated content state *after* figuring out truncation
        // Store the actual content that will be in the message after the edit
        this.currentMessageContent = contentForThisEdit.endsWith('...')
            ? contentForThisEdit.slice(0, -3) // Remove trailing '...' if truncated
            : contentForThisEdit;


        // --- Send/Edit Current Message ---
        // Only edit if there's new content to show or if it's the final formatting pass
        if (contentForThisEdit.length > 0 && (contentForThisEdit !== this.botResponse.content || (isFinalSegment && !needsFollowUp))) {
             try {
                 // Apply final formatting if this message part is considered complete (either end of stream or needs follow-up)
                 const useFinalFormat = isFinalSegment;
                 const payload = this._createPayload(contentForThisEdit, useFinalFormat);
                 this.logger.trace('Payload before edit',{ contentForThisEdit, useFinalFormat, needsFollowUp, payload }); // Updated trace log
                 // Removed debug log
                 await this.botResponse.edit(payload);
                 // Update totalSentLength based on the *actual* length of the edited message content
                 this.totalSentLength = contentForThisEdit.length;
                 this.logger.debug(`Edited message ${this.botResponse.id}. Use Final Format: ${useFinalFormat}. Total length: ${this.totalSentLength}`);
             } catch (error: any) {
                 this.logger.error(`Failed to edit message ${this.botResponse.id}: ${error.message}`, error);
                 // Re-buffer the unprocessed chunk on failure
                 this.buffer = contentChunk + this.buffer;
                 // Revert accumulation for the failed chunk
                 this.currentMessageContent = this.currentMessageContent.slice(0, -(contentChunk.length)); // Approximate reversal
                if (error instanceof DiscordAPIError && (error.code === 429 || error.code === 50035)) {
                    this.logger.warn(`Re-buffered content due to Discord API error (${error.code}).`);
                } else {
                    // For other errors, maybe throw or call handleError?
                    this.logger.error('Unhandled error during message edit, content re-buffered.');
                }
                return; // Stop processing this update cycle
            }
        } else if (isPotentiallyFinal && !needsFollowUp && contentForThisEdit.length === 0) { // Check original final flag here for empty final segment case
             this.logger.debug('Final segment resulted in empty content after truncation.');
             await this._applyFinalFormatting(); // Apply final formatting if needed
        }

        // --- Handle Follow-up Message ---
        if (needsFollowUp && remainingContentForNextMessage !== null) { // Use renamed variable
            // Removed trace log
            this.logger.debug(`Sending follow-up message for remaining content (length: ${remainingContentForNextMessage.length})`); // Use renamed variable
            this.totalSentLength = 0; // Reset length counter for the *new* message
            this.currentMessageContent = ''; // Reset accumulated content for the *new* message
            // Put the remaining content into the buffer for the *next* _sendBufferedUpdate cycle
            this.buffer = remainingContentForNextMessage + this.buffer;

            try {
                // Removed trace log
                const newMsgPayload: string | MessagePayload | MessageCreateOptions = this.usePlainResponses
                    ? { content: '...' }
                    : { embeds: [new EmbedBuilder().setDescription('...').setColor(0xffa500)] };

                 if (this.originalMessage.channel.isTextBased() && 'send' in this.originalMessage.channel) {
                    // Reply to the *current* bot message to create a thread/chain
                    // Removed trace log
                    const newBotResponse = await this.botResponse.reply(newMsgPayload);
                    if (newBotResponse) {
                        this.botResponse = newBotResponse; // Update the message we are editing
                        this.logger.info(`Sent new follow-up message ${this.botResponse.id}`);
                        // Immediately trigger update for the buffered remaining content
                        // Pass false as this new message part isn't necessarily the final one overall
                        // Pass the original final flag from the outer scope
                        // Removed trace log
                        await this._sendBufferedUpdate(isPotentiallyFinal);
                    } else {
                        this.logger.error('Failed to send follow-up message (send returned null/undefined).');
                        this.buffer = ''; // Discard buffer
                    }
                 } else {
                     this.logger.error(`Cannot send follow-up message in channel ${this.originalMessage.channelId}`);
                     this.buffer = '';
                 }
            } catch (sendError: any) {
                this.logger.error(`Failed to send follow-up message: ${sendError.message}`, sendError);
                this.buffer = '';
            }
        }
        // Final formatting is now handled explicitly by finalize() or implicitly if buffer empty on finalize
    }

    /** Creates the payload for sending/editing */
    // Takes the full intended content for the message being edited
    private _createPayload(fullContentForThisMessage: string, isFinalSegment: boolean): string | MessagePayload | MessageEditOptions {
        // Ensure we don't exceed limit in the description itself (redundant check, but safe)
        const truncatedContent = fullContentForThisMessage.length > DISCORD_MESSAGE_LIMIT
            ? fullContentForThisMessage.substring(0, DISCORD_MESSAGE_LIMIT - 3) + '...'
            : fullContentForThisMessage;
        const descriptionText = this._formatContent(truncatedContent || (isFinalSegment ? '' : '...'));
        const finalDescription = isFinalSegment ? descriptionText : `${descriptionText} ⚪`;
        const finalColor = isFinalSegment ? 0x00ff00 : 0xffa500;

        if (isFinalSegment && !descriptionText.trim()) {
            this.logger.debug(`Creating final empty payload.`);
            return this.usePlainResponses
                ? { content: '✅' }
                : { embeds: [new EmbedBuilder().setDescription('✅').setColor(0x00ff00)] };
        } else {
            return this.usePlainResponses
                ? { content: descriptionText || '...' }
                : { embeds: [new EmbedBuilder().setDescription(finalDescription).setColor(finalColor)] };
        }
    }

     /** Applies final formatting touches */
    private async _applyFinalFormatting(): Promise<void> {
        // Ensure we only apply formatting if the response is truly finalized and we have a message
        if (!this.botResponse || !this.isFinalized) {
             this.logger.debug('Skipping final formatting: Response not finalized or no message exists.');
             return;
        }

        try {
            // Use the final accumulated content for the *last* message part
            // Removed trace log
            let finalFormattedContent = this.currentMessageContent;

            // Get current embed state only for comparison later
            const currentEmbed = this.botResponse.embeds[0];
            const currentEmbedDesc = currentEmbed?.description;
            const currentEmbedColor = currentEmbed?.color;

            // --- Code Block Cleanup ---
            // (Simplified - assumes cleanup should happen on finalFormattedContent)
            if (finalFormattedContent) {
                const codeBlockRegex = /```(\w*\n)?([\s\S]*?)```/g;
                let match;
                let lastMatchEnd = 0;
                let balanced = true;
                 while ((match = codeBlockRegex.exec(finalFormattedContent)) !== null) {
                    lastMatchEnd = match.index + match[0].length;
                }
                if (lastMatchEnd < finalFormattedContent.length && finalFormattedContent.slice(lastMatchEnd).includes('```')) {
                    const backtickCount = (finalFormattedContent.match(/```/g) || []).length;
                    if (backtickCount % 2 !== 0) {
                        this.logger.warn('Detected potentially unclosed code block. Appending closing backticks.');
                        finalFormattedContent += '\n```';
                        balanced = false;
                    }
                }
                 // If code blocks were fixed, we definitely need to edit
                 if (!balanced) {
                     // Recreate payload with potentially fixed content
                     // Use the potentially fixed final content
                     const finalPayload = this._createPayload(finalFormattedContent, true);
                     this.logger.debug(`Applying final formatting adjustments (code blocks) to message ${this.botResponse.id}.`);
                     await this.botResponse.edit(finalPayload);
                     return; // Exit after fixing code blocks
                 }
            }
            // --- End Code Block Cleanup ---

            // Check if current state already matches final state (no streaming indicator, final color)
            // Create the final payload based on the accumulated (and potentially code-block-fixed) content
            const finalPayloadCheck = this._createPayload(finalFormattedContent ?? '', true);

            let needsFinalEdit = false;
            if (this.usePlainResponses) {
                // Compare current message content with the *content* part of the final payload if using plain responses
                needsFinalEdit = this.botResponse.content !== (finalPayloadCheck as { content?: string }).content;
            } else {
                const finalEmbed = (finalPayloadCheck as MessageEditOptions).embeds?.[0];
                // Cast finalEmbed to any to bypass strict type checking for comparison
                const finalEmbedAny = finalEmbed as any;
                needsFinalEdit = currentEmbedDesc !== finalEmbedAny?.description || currentEmbedColor !== finalEmbedAny?.color; // Keep the any cast here
            }

            if (needsFinalEdit) {
                 this.logger.trace('Final formatting payload before edit',{ finalFormattedContent, finalPayloadCheck }, );
                 this.logger.debug(`Applying final formatting adjustments (indicator/color) to message ${this.botResponse.id}.`);
                 // Removed debug log
                 await this.botResponse.edit(finalPayloadCheck);
            } else {
                 this.logger.debug(`No final formatting adjustments needed for message ${this.botResponse.id}.`);
            }

        } catch (error: any) {
            this.logger.error(`Failed during final formatting adjustments for message ${this.botResponse.id}: ${error.message}`, error);
        }
    }

    /** Formats the content segment. */
    private _formatContent(content: string): string { // Removed unused isFinalSegment
        return content;
    }
}