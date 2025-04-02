// LLMcordTS/src/processing/MessageProcessor.ts
import { Message, ChannelType } from 'discord.js'; // Removed unused Collection
import { AxiosInstance } from 'axios'; // Added AxiosInstance
import { Config } from '../types/config';
import { Logger } from '../core/logger';
import {
    BaseProvider,
    ChatMessage,
    ChatMessageContentPart,
    // ChatMessageContentPartText, // Removed unused import
    ChatMessageContentPartImageBase64, // Added for image processing
} from '../providers/baseProvider';
import {
    // IMessageProcessor, // Removed unused import (class implements it implicitly via structure)
    IMessageNode,
    IMessageHistory,
    IWarning,
} from '../types/message';

export class MessageProcessor /* implements IMessageProcessor - Temporarily remove during refactor */ {
    private readonly config: Config;
    private readonly logger: Logger;
    private readonly provider: BaseProvider;
    private readonly httpClient: AxiosInstance; // Added
    private readonly messageNodeCache: Map<string, IMessageNode>; // Added
    private readonly clientId: string; // Added

    constructor(
        config: Config,
        logger: Logger,
        provider: BaseProvider,
        httpClient: AxiosInstance, // Added
        messageNodeCache: Map<string, IMessageNode>, // Added
        clientId: string, // Added
    ) {
        this.config = config;
        this.logger = logger;
        this.provider = provider;
        this.httpClient = httpClient; // Added
        this.messageNodeCache = messageNodeCache; // Added
        this.clientId = clientId; // Added
        this.logger.debug('MessageProcessor initialized.');
    }

    /**
     * Processes a single Discord message to extract relevant information for the LLM history.
     * Populates an IMessageNode object with details like role, user ID, cleaned text content,
     * image attachments (if supported), and fetches the parent message if it's a reply.
     * Handles potential errors during parent message fetching.
     * (Moved from LLMCordBot.ts)
     * @param message - The discord.js Message object to process.
     * @returns {Promise<IMessageNode>} - The processed message node.
     * @private - Making this private as it's likely called by buildMessageHistory internally now
     */
    private async processMessageNode(message: Message): Promise<IMessageNode> {
        // Create the node object here instead of taking it as input
        const node: IMessageNode = {
            messageId: message.id,
            text: null,
            images: [],
            role: 'user', // Default role, will be updated
            userId: null,
            hasBadAttachments: false,
            fetchParentFailed: false,
            parentMessage: null,
        };

        node.role =
            message.author.bot && message.author.id === this.clientId // Use stored clientId
                ? 'assistant'
                : 'user';
        node.userId = node.role === 'user' ? message.author.id : null;

        // Clean content - remove bot mention if applicable
        let cleanedContent = message.content;
        // Construct mention string using stored clientId
        const botMention = `<@${this.clientId}>`;
        if (
            message.channel.type !== ChannelType.DM &&
            cleanedContent.startsWith(botMention)
        ) {
            cleanedContent = cleanedContent.substring(botMention.length).trim();
        }
        node.text = cleanedContent || null; // Ensure null if empty string

        // Process attachments
        node.images = [];
        node.hasBadAttachments = false;
        // Use dynamic provider capability check
        const providerSupportsVision = this.provider // Use this.provider
            ? this.provider.supportsVision()
            : false; // Check provider capability dynamically
        const maxAttachmentSize =
            this.config.llm?.maxAttachmentSizeBytes ?? 10 * 1024 * 1024; // Default 10MB, make configurable

        if (message.attachments.size > 0 && providerSupportsVision) {
            const supportedImageTypes = ['png', 'jpeg', 'jpg', 'gif', 'webp']; // Common supported types
            this.logger.debug(
                `[Node ${message.id}] Processing ${message.attachments.size} attachments...`,
            );

            for (const attachment of message.attachments.values()) {
                const fileExtension = attachment.name?.split('.').pop()?.toLowerCase();
                const isSupportedType =
                    attachment.contentType?.startsWith('image/') &&
                    fileExtension &&
                    supportedImageTypes.includes(fileExtension);
                const isWithinSizeLimit = attachment.size <= maxAttachmentSize;

                if (isSupportedType && isWithinSizeLimit) {
                    try {
                        // Ensure contentType is not null before proceeding
                        if (!attachment.contentType) {
                            node.hasBadAttachments = true;
                            this.logger.warn(
                                `[Node ${message.id}] Ignoring attachment ${attachment.name} due to missing content type.`,
                            );
                            continue; // Skip to the next attachment
                        }

                        this.logger.debug(
                            `[Node ${message.id}] Fetching image: ${attachment.name} (${attachment.contentType}, ${attachment.size} bytes) from ${attachment.url}`,
                        );
                        const response = await this.httpClient.get(attachment.url, { // Use this.httpClient
                            responseType: 'arraybuffer', // Fetch as raw bytes
                            timeout: this.config.llm?.requestTimeoutMs || 15000, // Use configured timeout or default
                        });

                        if (response.status === 200 && response.data) {
                            const base64Data = Buffer.from(response.data, 'binary').toString(
                                'base64',
                            );
                            // Use a structure compatible with multimodal APIs (like Anthropic)
                            // Ensure the pushed object matches ChatMessageContentPartImageBase64
                            node.images.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: attachment.contentType, // Now guaranteed to be string
                                    data: base64Data,
                                },
                            });
                            this.logger.debug(
                                `[Node ${message.id}] Successfully fetched and encoded image: ${attachment.name}`,
                            );
                        } else {
                            throw new Error(`Received status ${response.status}`);
                        }
                    } catch (error: any) {
                        node.hasBadAttachments = true;
                        this.logger.warn(
                            `[Node ${message.id}] Failed to fetch or encode image ${attachment.name} from ${attachment.url}: ${error.message}`,
                        );
                    }
                } else {
                    node.hasBadAttachments = true;
                    if (!isSupportedType) {
                        this.logger.debug(
                            `[Node ${message.id}] Ignoring unsupported attachment type: ${attachment.name} (${attachment.contentType ?? 'N/A'})`,
                        );
                    } else if (!isWithinSizeLimit) {
                        this.logger.debug(
                            `[Node ${message.id}] Ignoring attachment due to size limit: ${attachment.name} (${attachment.size} > ${maxAttachmentSize} bytes)`,
                        );
                    }
                }
            }
        } else if (message.attachments.size > 0 && !providerSupportsVision) {
            node.hasBadAttachments = true; // Mark as bad if provider doesn't support vision
            this.logger.debug(
                `[Node ${message.id}] Ignoring ${message.attachments.size} attachments as provider does not support vision.`,
            );
        }

        // Fetch parent message if it's a reply
        node.parentMessage = null;
        node.fetchParentFailed = false;
        if (message.reference?.messageId) {
            try {
                // Fetch directly from the channel, assuming the processor has access or it's passed in
                // This might need adjustment depending on how MessageProcessor gets channel context
                node.parentMessage = await message.channel.messages.fetch(
                    message.reference.messageId,
                );
            } catch (error) {
                node.fetchParentFailed = true;
                this.logger.warn(
                    `[Node ${message.id}] Failed to fetch parent message ${message.reference.messageId}: ${error}`,
                );
            }
        }
        this.logger.debug(
            `[Node ${message.id}] Processed: role=${node.role}, images=${node.images.length}, parent=${node.parentMessage?.id ?? 'None'}, text=${(node.text ?? '').substring(0, 50)}...`,
        );
        return node; // Return the created and populated node
    }

    /**
     * Builds the message history array in the format expected by the LLM provider.
     * Traverses the reply chain starting from the `latestMessage`, processing each message
     * using `processMessageNode` (utilizing cache) and formatting it for the LLM.
     * Enforces limits on the number of messages, text length, and images based on configuration.
     * Collects user-facing warnings about potential truncation or ignored content.
     * (Moved from LLMCordBot.ts - Signature differs from IMessageProcessor interface)
     * @param latestMessage - The most recent discord.js Message object in the conversation chain.
     * @returns {Promise<{ history: IMessageHistory; warnings: IWarning[] }>} A promise resolving to an object containing:
     *   - An array of formatted ChatMessage objects for the LLM.
     *   - An array of IWarning objects.
     */
    public async buildMessageHistory(
        latestMessage: Message,
    ): Promise<{ history: IMessageHistory; warnings: IWarning[] }> { // Adjusted return type
        const llmHistory: IMessageHistory = []; // Use IMessageHistory type
        const warnings: IWarning[] = []; // Use IWarning[] type
        let currentMessage: Message | null = latestMessage;

        // Get limits from config (using defaults if not specified)
        const maxMessages = this.config.memory.maxHistoryLength ?? 25;
        const maxTextLength = this.config.llm?.defaultMaxTokens ?? 4000; // Use defaultMaxTokens as proxy
        const maxImages = this.config.memory.maxImages ?? 2; // Use configured value or default to 2

        this.logger.debug(
            `[History] Building for ${latestMessage.id} (max_messages=${maxMessages}, max_images=${maxImages})`,
        );

        while (currentMessage && llmHistory.length < maxMessages) {
            const messageId: string = currentMessage.id; // Explicitly type messageId
            let node: IMessageNode | undefined = this.messageNodeCache.get(messageId); // Use this.messageNodeCache
            let isNewNode = false;

            if (!node) {
                isNewNode = true;
                // Call the internal processMessageNode method
                this.logger.debug(
                    `[History] Processing new node for message ${messageId}`,
                );
                node = await this.processMessageNode(currentMessage); // Await the promise
                this.messageNodeCache.set(messageId, node); // Use this.messageNodeCache
            } else {
                this.logger.debug(
                    `[History] Using cached node for message ${messageId}`,
                );
            }

            // --- Format node for LLM ---
            const imagesToSend = node.images.slice(0, maxImages);
            const textToSend = (node.text ?? '').substring(0, maxTextLength);
            // Type is now string | ChatMessageContentPart[]
            let apiContent: string | ChatMessageContentPart[] = '';
            let userName: string | undefined = undefined;

            // Check provider capabilities dynamically
            const providerSupportsUsernames = this.provider // Use this.provider
                ? this.provider.supportsUsernames()
                : false;
            const providerSupportsVision = this.provider // Use this.provider
                ? this.provider.supportsVision()
                : false; // Use dynamic check
            let userPrefix = '';
            if (node.role === 'user' && !providerSupportsUsernames) {
                const safeDisplayName = currentMessage.author.displayName.replace(
                    /[^a-zA-Z0-9 _-]/g,
                    '',
                );
                userPrefix = `User (${safeDisplayName}/${node.userId}): `;
            }
            const prefixedTextToSend = userPrefix + textToSend;

            if (node.role === 'user' && providerSupportsUsernames && node.userId) {
                userName = node.userId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64);
            }

            if (imagesToSend.length > 0 && providerSupportsVision) {
                // Explicitly type contentParts to match ChatMessageContentPart[]
                const contentParts: ChatMessageContentPart[] = [];
                if (prefixedTextToSend) {
                    contentParts.push({ type: 'text', text: prefixedTextToSend });
                }
                // Ensure imagesToSend elements match ChatMessageContentPartImageBase64 structure
                contentParts.push(...imagesToSend as ChatMessageContentPartImageBase64[]);
                apiContent = contentParts;
                this.logger.debug(
                    `[History] Formatted node ${messageId} as multimodal (${imagesToSend.length} images)`,
                );
            } else {
                // No images or provider doesn't support vision
                if (prefixedTextToSend) {
                    apiContent = prefixedTextToSend;
                } else if (
                    node.role === 'assistant' &&
                    currentMessage?.embeds[0]?.description
                ) {
                    // If assistant message text is empty, try using the first embed's description
                    const embedText = currentMessage.embeds[0].description.substring(
                        0,
                        maxTextLength,
                    );
                    apiContent = embedText; // Use embed description as content
                    this.logger.debug(
                        `[History] Using embed description for assistant node ${messageId}`,
                    );
                } else {
                    apiContent = ''; // Ensure it's an empty string if no text or embed description
                }
            }

            // Determine if the message has actual content (text or parts)
            const hasContent = (typeof apiContent === 'string' && apiContent.trim()) || (Array.isArray(apiContent) && apiContent.length > 0);

            // Push user messages ONLY if they have actual content.
            // Push ALL assistant messages to maintain conversation flow, using extracted embed text or empty string.
            if (node.role === 'assistant' || (node.role === 'user' && hasContent)) {
                const messageEntry: ChatMessage = {
                    role: node.role,
                    // Use the determined apiContent (could be embed text or empty string for assistant)
                    content: apiContent // apiContent is already guaranteed to be string or Part[] here
                };
                if (userName) { messageEntry.name = userName; } // Add name for user messages if supported
                llmHistory.push(messageEntry);
            } else if (isNewNode) {
                // Log only if a new user node is skipped due to no content
                this.logger.debug(
                    `[History] User node ${messageId} resulted in empty content after formatting. Skipping.`,
                );
            }

            // --- Collect Warnings ---
            // Convert Set<string> warnings to IWarning[]
            if ((node.text?.length ?? 0) > maxTextLength) {
                warnings.push({
                    type: 'HistoryTruncation',
                    message: `Message ${messageId} text truncated to ${maxTextLength} characters.`,
                    messageId: messageId
                });
            }
            if (node.images.length > maxImages) {
                warnings.push({
                    type: 'HistoryTruncation',
                    message: `Message ${messageId} images truncated to ${maxImages}.`,
                    messageId: messageId
                });
            }
            if (node.hasBadAttachments) {
                warnings.push({
                    type: 'BadAttachment',
                    message: `Message ${messageId} had unsupported attachments that were ignored.`,
                    messageId: messageId
                });
            }
            if (node.fetchParentFailed) {
                warnings.push({
                    type: 'FetchParentFailed',
                    message: `Failed to fetch parent for message ${messageId}. History may be incomplete.`,
                    messageId: messageId
                });
            }

            // Check for overall history truncation *after* potentially adding the current node
            if (node.parentMessage && llmHistory.length >= maxMessages) {
                 // Check if this is the last message we can add AND there's a parent
                 // Add this warning only once when the limit is first hit
                 if (!warnings.some(w => w.type === 'HistoryTruncation' && w.message.startsWith('History truncated'))) {
                     warnings.push({
                         type: 'HistoryTruncation',
                         message: `History truncated to the last ${maxMessages} messages.`,
                         // No specific messageId for this global warning
                     });
                 }
            }


            // Move to parent
            currentMessage = node.parentMessage;
            if (currentMessage) {
                this.logger.debug(
                    `[History] Moving to parent message ${currentMessage.id}`,
                );
            }
        } // End while loop

        llmHistory.reverse();
        this.logger.debug(
            `[History] Final history size: ${llmHistory.length} messages`,
        );
        return { history: llmHistory, warnings }; // Return object matching adjusted signature
    }

    // Add any private helper methods needed for the above functions here later
    // (None identified as solely used by these two methods in the original code)
}