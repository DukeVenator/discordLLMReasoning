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
    // Ensure IDs are strings and trimmed for comparison
    const allowedChannels = (permissionsConfig.allowedChannels ?? []).map(id => String(id).trim());
    const allowedCategories = (permissionsConfig.allowedCategories ?? []).map(id => String(id).trim());
    const allowedRoles = (permissionsConfig.allowedRoles ?? []).map(id => String(id).trim());
    const blockRoles = (permissionsConfig.blockRoles ?? []).map(id => String(id).trim());
    const blockedChannels = (permissionsConfig.blockedChannels ?? []).map(id => String(id).trim());
    const blockedCategories = (permissionsConfig.blockedCategories ?? []).map(id => String(id).trim());

    // --- 2. Check User Block ---
    if (blockUsers.includes(authorId)) {
        logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (User Blocked)`);
        return false;
    }

    // --- 3. Separate DM and Guild Logic ---
    if (channel.type === ChannelType.DM) {
        // --- DM Logic ---
        const hasUserAllows = allowedUsers.length > 0;
        const hasChannelCategoryAllows = allowedChannels.length > 0 || allowedCategories.length > 0;
        let dmAllowed = true;
        if (hasUserAllows) {
            dmAllowed = allowedUsers.includes(authorId);
            if (!dmAllowed) {
                 logger.debug(`[Permissions] Denied DM for ${authorId} (Not in allowedUsers)`);
                 return false;
            }
        } else if (hasChannelCategoryAllows) {
            dmAllowed = false;
            logger.debug(`[Permissions] Denied DM for ${authorId} (Implicitly denied by channel/category allows)`);
            return false;
        }
        logger.debug(`[Permissions] Granted DM for ${authorId}`);
        return true;

    } else if (member) { // --- 4. Guild Logic ---

        // --- 4a. Role Block Check ---
        const isRoleBlocked = blockRoles.length > 0 && member.roles?.cache?.some(role => blockRoles.includes(role.id));
        if (isRoleBlocked) {
            logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (Role Blocked)`);
            return false;
        }

        // --- 4b. Channel Block Check ---
        const isChannelBlocked = blockedChannels.includes(channel.id);
        if (isChannelBlocked) {
            logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (Channel Blocked)`);
            return false;
        }
        const isThreadParentBlocked = channel.isThread() && channel.parentId && blockedChannels.includes(channel.parentId);
        if (isThreadParentBlocked) {
             logger.debug(`[Permissions] Denied for ${authorId} in thread ${channel.id} (Parent Channel ${channel.parentId} Blocked)`);
             return false;
        }

        // --- 4c. Category Block Check (with Channel/Parent override) ---
        let actualCategoryId: string | null = null;
        if ('parentId' in channel && channel.parentId) {
             actualCategoryId = (channel.isThread() ? channel.parent?.parentId : channel.parentId) ?? null;
        }
        if (actualCategoryId && blockedCategories.includes(actualCategoryId)) {
            let isOverridden = false;
            const allowedChannelsList = allowedChannels ?? []; // Use cached list (already trimmed strings)
            if (allowedChannelsList.includes(channel.id)) {
                 isOverridden = true;
                 logger.debug(`[Permissions] Category ${actualCategoryId} block overridden by direct channel allow (${channel.id}).`);
            } else if (channel.isThread() && channel.parentId && allowedChannelsList.includes(channel.parentId)) {
                 isOverridden = true;
                 logger.debug(`[Permissions] Category ${actualCategoryId} block overridden by parent channel allow (${channel.parentId}) for thread ${channel.id}.`);
            }
            if (!isOverridden) {
                logger.debug(`[Permissions] Denied for ${authorId} in channel ${channel.id} (Category ${actualCategoryId} Blocked, no channel/parent override)`);
                return false; // Enforce category block
            }
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
            // Manual loop check instead of .includes()
            const currentChannelId = channel.id.trim(); // Ensure channel ID is trimmed

            // Revert to standard .includes() check as the config/data issue is resolved
            const isDirectChannelAllowed = allowedChannels.includes(currentChannelId); // Use the trimmed variable
            const isParentChannelAllowed = channel.isThread() && channel.parentId && allowedChannels.includes(channel.parentId); // Keep .includes for parent check for now
            // Note: .includes() checks compare strings (allowedChannels are trimmed, currentChannelId is trimmed)
            if (isDirectChannelAllowed || isParentChannelAllowed) {
                passesChannelAllow = true;
            }
        }

        let passesCategoryAllow = false;
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
        const channelOrCategoryAllowed = !hasChannelCategoryAllows || passesChannelAllow || passesCategoryAllow;
        const userOrRoleAllowed = !hasUserRoleAllows || passesUserAllow || passesRoleAllow; // Corrected potential typo passesRoleAllow used here

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
         logger.warn(`[Permissions] Could not determine permissions for ${authorId} in channel ${channel.id} (Member object not available in non-DM channel)`);
         return false;
    }
}