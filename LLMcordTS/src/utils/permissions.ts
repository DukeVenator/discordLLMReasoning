import { Message, ChannelType } from 'discord.js';
import { Config } from '@/types/config';
import { logger } from '@/core/logger';

/**
 * Checks if a user has permission to interact with the bot based on the configuration.
 * Implements a comprehensive check including admin bypass, block lists (user, role, channel, category),
 * and allow lists (channel, category, role, user).
 *
 * Precedence Order (Applied Logic):
 * 1. Admin User Check (Bypass)
 * 2. User Block Check
 * 3. DM Channel Logic (Handles implicit denies)
 * 4. Guild Channel Logic:
 *    a. Role Block Check
 *    b. Channel Block Check
 *    c. Category Block Check (with Channel/Parent override)
 *    d. Allow List Check (only if specific allows configured)
 *    e. Default Grant (if no blocks hit and no specific allows)
 *
 * @param message The discord.js Message object.
 * @param config The loaded application configuration.
 * @returns True if the user has permission, false otherwise.
 */
export function checkPermissions(message: Message, config: Config): boolean {
    const permissionsConfig = config.permissions ?? {};
    const authorId = message.author.id;
    const channel = message.channel;
    const member = message.member; // Might be null in DMs or if uncached

    // --- 1. Check Admin Users (Bypass all checks) ---
    const adminUsers = permissionsConfig.adminUsers ?? [];
    if (adminUsers.includes(authorId)) {
        logger.debug(`[Permissions] Granted for ${authorId} in channel ${channel.id} (Admin User)`);
        return true;
    }

    // --- Block/Allow List Declarations ---
    const blockUsers = permissionsConfig.blockUsers ?? [];
    const allowedUsers = permissionsConfig.allowedUsers ?? [];
    const allowedChannels = permissionsConfig.allowedChannels ?? [];
    const allowedCategories = permissionsConfig.allowedCategories ?? [];
    const allowedRoles = permissionsConfig.allowedRoles ?? [];
    const blockRoles = permissionsConfig.blockRoles ?? [];
    const blockedChannels = permissionsConfig.blockedChannels ?? [];
    const blockedCategories = permissionsConfig.blockedCategories ?? [];

    // --- 2. Check User Block ---
    if (blockUsers.includes(authorId)) {
        logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (User Blocked)`);
        return false;
    }

    // --- 3. Separate DM and Guild Logic ---
    if (channel.type === ChannelType.DM) {
        // --- DM Logic ---
        // No Role/Channel/Category blocks apply in DMs.
        // Check Allow lists specific to DMs (User Allow)
        const hasUserAllows = allowedUsers.length > 0;
        const hasChannelCategoryAllows = allowedChannels.length > 0 || allowedCategories.length > 0;

        // Default allow for DMs unless specific rules deny
        let dmAllowed = true;

        if (hasUserAllows) {
            // If user allows are set, the user MUST be in the list
            dmAllowed = allowedUsers.includes(authorId);
            if (!dmAllowed) {
                 logger.debug(`[Permissions] Denied DM for ${authorId} (Not in allowedUsers)`);
                 return false;
            }
        } else if (hasChannelCategoryAllows) {
            // If only channel/category allows exist, DMs are implicitly denied
            // (No user allows to potentially grant access)
            dmAllowed = false;
            logger.debug(`[Permissions] Denied DM for ${authorId} (Implicitly denied by channel/category allows)`);
            return false;
        }

        // If we reach here, either no specific rules denied DM access, or user was explicitly allowed.
        logger.debug(`[Permissions] Granted DM for ${authorId}`);
        return true;

    } else if (member) { // --- 4. Guild Logic ---

        // --- 4a. Role Block Check ---
        if (blockRoles.length > 0 && member.roles?.cache?.some(role => blockRoles.includes(role.id))) {
            logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (Role Blocked)`);
            return false;
        }

        // --- 4b. Channel Block Check ---
        if (blockedChannels.includes(channel.id)) {
            logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (Channel Blocked)`);
            return false;
        }
        if (channel.isThread() && channel.parentId && blockedChannels.includes(channel.parentId)) {
             logger.debug(`[Permissions] Denied for ${authorId} in thread ${channel.id} (Parent Channel ${channel.parentId} Blocked)`);
             return false;
        }

        // --- 4c. Category Block Check (with Channel/Parent override) ---
        let actualCategoryId: string | null = null;
        if ('parentId' in channel && channel.parentId) {
            // For threads, the parent is the channel it resides in. Get category from that channel.
             actualCategoryId = (channel.isThread() ? channel.parent?.parentId : channel.parentId) ?? null;
        }

        if (actualCategoryId && blockedCategories.includes(actualCategoryId)) {
            // Category is blocked. Check for channel-specific overrides.
            let isOverridden = false;
            const allowedChannelsList = allowedChannels ?? []; // Use cached list

            // Check 1: Is the specific channel allowed?
            if (allowedChannelsList.includes(channel.id)) {
                 isOverridden = true;
                 logger.debug(`[Permissions] Category ${actualCategoryId} block overridden by direct channel allow (${channel.id}).`);
            }
            // Check 2: If it's a thread, is the parent channel allowed?
            else if (channel.isThread() && channel.parentId && allowedChannelsList.includes(channel.parentId)) {
                 isOverridden = true;
                 logger.debug(`[Permissions] Category ${actualCategoryId} block overridden by parent channel allow (${channel.parentId}) for thread ${channel.id}.`);
            }

            // If the category is blocked AND it wasn't overridden by a specific channel/parent allow, deny access.
            if (!isOverridden) {
                logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (Category ${actualCategoryId} Blocked, no channel/parent override)`);
                return false; // Enforce category block
            }
            // If we reach here, the category block was overridden. Log it and continue execution.
            logger.debug(`[Permissions] Category ${actualCategoryId} block was overridden. Continuing checks.`);
        }
        // --- End of Block Checks for Guild ---

        // --- 4d. Allow List Check (only if specific allows configured) ---
        const specificAllowsConfigured =
            allowedChannels.length > 0 ||
            allowedCategories.length > 0 ||
            allowedRoles.length > 0 ||
            allowedUsers.length > 0;

        if (!specificAllowsConfigured) {
            // --- 4e. Default Grant ---
            logger.debug(`[Permissions] Granted for ${authorId} in channel ${channel.id} (Passed blocks, no specific allows configured)`);
            return true; // Allow if no specific rules and passed blocks
        }

        // --- Evaluate Specific Allows ---
        let passesChannelAllow = false;
        if (allowedChannels.length > 0) {
            if (allowedChannels.includes(channel.id)) {
                passesChannelAllow = true;
            } else if (channel.isThread() && channel.parentId && allowedChannels.includes(channel.parentId)) {
                passesChannelAllow = true;
            }
        }

        let passesCategoryAllow = false;
        // Use actualCategoryId calculated earlier for consistency
        if (allowedCategories.length > 0 && actualCategoryId && allowedCategories.includes(actualCategoryId)) {
            passesCategoryAllow = true;
        }

        let passesUserAllow = false;
        if (allowedUsers.length > 0 && allowedUsers.includes(authorId)) {
            passesUserAllow = true;
        }

        let passesRoleAllow = false;
        if (allowedRoles.length > 0 && member.roles?.cache?.some(role => allowedRoles.includes(role.id))) {
            passesRoleAllow = true;
        }

        // Combine flags based on configuration
        const hasChannelCategoryAllows = allowedChannels.length > 0 || allowedCategories.length > 0;
        const hasUserRoleAllows = allowedUsers.length > 0 || allowedRoles.length > 0;

        // If channel/category allows are configured, one must pass. Otherwise, it passes by default.
        const channelOrCategoryAllowed = !hasChannelCategoryAllows || passesChannelAllow || passesCategoryAllow;
        // If user/role allows are configured, one must pass. Otherwise, it passes by default.
        const userOrRoleAllowed = !hasUserRoleAllows || passesUserAllow || passesRoleAllow;

        // Final decision for Guild with specific allows
        if (channelOrCategoryAllowed && userOrRoleAllowed) {
            logger.debug(`[Permissions] Granted for ${authorId} in channel ${channel.id} (Passed specific allow checks)`);
            return true;
        } else {
            let reason = "Failed specific allow checks";
            if (!channelOrCategoryAllowed) {
               reason = "Not in allowed Channel/Category";
           } else if (!userOrRoleAllowed) {
               reason = "Not an allowed User/Role";
           }
            logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (${reason})`);
            return false;
        }

    } else { // --- 5. Error/Edge Case ---
         // Member object is somehow missing in a non-DM channel context
         logger.warn(`[Permissions] Could not determine permissions for ${authorId} in channel ${channel.id} (Member object not available in non-DM channel)`);
         return false;
    }
}