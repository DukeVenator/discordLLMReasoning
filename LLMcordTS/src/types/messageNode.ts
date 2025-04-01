/**
 * @fileoverview Defines the TypeScript interface for a MessageNode,
 * representing a processed message in the conversation history cache.
 */
import { Message } from 'discord.js';
import { ChatMessageContentPartImageBase64 } from '../providers/baseProvider'; // Import the correct type

/**
 * Represents the processed data for a single message in the conversation history.
 * Used for caching and building the final history for the LLM.
 */
export interface MessageNode {
    /** The processed text content of the message. */
    text: string | null;
    /**
     * Array of image objects formatted for the LLM provider using base64 encoding.
     */
    images: ChatMessageContentPartImageBase64[]; // Use the imported type
    /** The role of the message author ('user' or 'assistant'). */
    role: 'user' | 'assistant';
    /** The Discord ID of the user who sent the message (if role is 'user'). */
    userId: string | null;
    /** Flag indicating if the message had unsupported attachments that were ignored. */
    hasBadAttachments: boolean;
    /** Flag indicating if fetching the parent message in the reply chain failed. */
    fetchParentFailed: boolean;
    /** The fetched discord.js Message object for the parent message, if applicable. */
    parentMessage: Message | null;
    /** The original message ID this node represents. */
    messageId: string;
}