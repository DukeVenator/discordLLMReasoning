# llmcord/utils/slash_commands.py
import logging
import discord
from discord import app_commands
from typing import List, Optional

log = logging.getLogger(__name__)
class SlashCommandHandler:
    """Handle Discord slash commands."""
    
    def __init__(self, bot):
        """Initialize slash command handler."""
        self.bot = bot
        self.tree = app_commands.CommandTree(bot.discord_client)
    
    @staticmethod
    async def send_in_chunks(interaction, text, chunk_size=1900):
        """Sends long text in multiple ephemeral messages."""
        if not text:
            return
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            # Ensure code blocks aren't broken mid-chunk if possible, though unlikely with large chunks
            await interaction.followup.send(content=f"```\n{chunk}\n```", ephemeral=True)
            start = end


    def setup(self):
        """Set up slash commands."""
        # Memory command
        @self.tree.command(
            name="memory",
            description="View or update your memory notes"
        )
        @app_commands.describe(
            action="View or update your notes",
            content="New content for your notes (only used with 'update')"
        )
        @app_commands.choices(action=[
            app_commands.Choice(name="view", value="view"),
            app_commands.Choice(name="update", value="update"),
            app_commands.Choice(name="clear", value="clear")
        ])
        async def memory_command(
            interaction: discord.Interaction,
            action: str,
            content: Optional[str] = None
        ):
            await interaction.response.defer(ephemeral=True)
            
            if not self.bot.config.get("memory.enabled", False):
                await interaction.followup.send("Memory feature is disabled.", ephemeral=True)
                return
            
            user_id = interaction.user.id
            
            if action == "view":
                current_memory = await self.bot.memory_store.get_user_memory(user_id)
                if current_memory:
                    max_len = self.bot.config.get("memory.max_memory_length", 1500)
                    header = f"Your current notes ({len(current_memory)} chars / {max_len} max):"
                    # Approximate length check, accounting for header, code ticks, newlines
                    full_message_approx_len = len(header) + len(current_memory) + 10

                    MAX_SINGLE_MESSAGE_LEN = 1950 # Keep well under Discord's 2000 char limit for ephemeral messages

                    if full_message_approx_len <= MAX_SINGLE_MESSAGE_LEN:
                        # Memory fits in a single message
                        reply_content = f"{header}\n```\n{current_memory}\n```"
                        await interaction.followup.send(content=reply_content, ephemeral=True)
                    else:
                        # Memory is too long, send header then chunks
                        await interaction.followup.send(content=header, ephemeral=True)
                        # Calculate chunk size leaving room for ```\n \n``` formatting
                        CHUNK_SIZE = MAX_SINGLE_MESSAGE_LEN - 10
                        await self.send_in_chunks(interaction, current_memory, CHUNK_SIZE)
                else:
                    # No memory saved
                    await interaction.followup.send("You have no saved notes.", ephemeral=True)
            
            elif action == "update":
                if not content:
                    await interaction.followup.send("Please provide content to update your notes.", ephemeral=True)
                    return
                
                max_len = self.bot.config.get("memory.max_memory_length", 1500)
                if len(content) > max_len:
                    await interaction.followup.send(f"❌ Error: Notes too long (max {max_len} chars). **Not saved.**", ephemeral=True)
                    return
                
                success = await self.bot.memory_store.save_user_memory(user_id, content)
                if success:
                    await interaction.followup.send(f"✅ Your notes have been updated ({len(content)} chars saved).", ephemeral=True)
                else:
                    await interaction.followup.send("❌ Error saving notes. Please try again later.", ephemeral=True)
            
            elif action == "clear":
                success = await self.bot.memory_store.save_user_memory(user_id, "")
                if success:
                    await interaction.followup.send("✅ Your notes have been cleared.", ephemeral=True)
                else:
                    await interaction.followup.send("❌ Error clearing notes. Please try again later.", ephemeral=True)
            # Condense action removed (now automatic in MemoryStorage.save_user_memory)
        

        # Memory Edit command
        @self.tree.command(
            name="memory_edit",
            description="Edit your memory notes by replacing text"
        )
        @app_commands.describe(
            search_text="The exact text to find in your notes",
            replace_text="The text to replace it with"
        )
        async def memory_edit_command(
            interaction: discord.Interaction,
            search_text: str,
            replace_text: str
        ):
            await interaction.response.defer(ephemeral=True)
            
            if not self.bot.config.get("memory.enabled", False):
                await interaction.followup.send("Memory feature is disabled.", ephemeral=True)
                return
            
            user_id = interaction.user.id
            log.info(f"User {user_id} initiated memory edit. Searching for: '{search_text}'")

            try:
                current_memory = await self.bot.memory_store.get_user_memory(user_id)
                
                if not current_memory:
                    await interaction.followup.send("You have no saved notes to edit.", ephemeral=True)
                    return

                if search_text not in current_memory:
                    await interaction.followup.send(f'Could not find the text "{search_text}" in your notes.', ephemeral=True)
                    return
                
                # Perform replacement
                original_length = len(current_memory)
                modified_memory = current_memory.replace(search_text, replace_text)
                modified_length = len(modified_memory)
                replacements_made = current_memory.count(search_text) # Count occurrences

                if modified_memory == current_memory:
                     # This case should technically be caught by 'search_text not in current_memory'
                     # but added as a safeguard.
                    await interaction.followup.send(f'Could not find the text "{search_text}" in your notes.', ephemeral=True)
                    return

                # Check length limit
                max_len = self.bot.config.get("memory.max_memory_length", 1500)
                if modified_length > max_len:
                    await interaction.followup.send(
                        f"❌ Error: Making that change would exceed the maximum note length ({modified_length}/{max_len} chars). **Edit not saved.**", 
                        ephemeral=True
                    )
                    return

                # Save the modified memory
                success = await self.bot.memory_store.save_user_memory(user_id, modified_memory)
                if success:
                    log.info(f"Successfully edited memory for user {user_id}. New length: {modified_length}. Replacements: {replacements_made}")
                    await interaction.followup.send(
                        f'✅ Successfully replaced {replacements_made} instance(s) of "{search_text}". New note length: {modified_length} chars.', 
                        ephemeral=True
                    )
                else:
                    raise RuntimeError("Failed to save edited memory to database.")

            except Exception as e:
                log.error(f"Error during memory edit for user {user_id}: {e}", exc_info=True)
                await interaction.followup.send(f"❌ An error occurred while editing your notes: {str(e)}.", ephemeral=True)


        # Admin command to force sync commands
        @self.tree.command(
            name="debug_sync_commands",
            description="[Admin Only] Force sync slash commands with Discord."
        )
        @app_commands.checks.has_permissions(administrator=True) # Admin check
        async def debug_sync_commands(interaction: discord.Interaction):
            """Forces a sync of all slash commands."""
            await interaction.response.defer(ephemeral=True)
            try:
                synced_commands = await self.tree.sync()
                await interaction.followup.send(f"✅ Successfully synced {len(synced_commands)} commands globally.", ephemeral=True)
                print(f"Admin {interaction.user} triggered manual command sync. Synced {len(synced_commands)} commands.")
            except discord.errors.Forbidden as e:
                 await interaction.followup.send(f"❌ Error: Missing permissions to sync commands. Details: {e}", ephemeral=True)
                 print(f"Error during manual command sync triggered by {interaction.user}: {e}")
            except Exception as e:
                await interaction.followup.send(f"❌ An unexpected error occurred during command sync: {e}", ephemeral=True)
                print(f"Unexpected error during manual command sync triggered by {interaction.user}: {e}")

        # Error handler for permission check failure on debug_sync_commands
        @debug_sync_commands.error
        async def debug_sync_commands_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
            if isinstance(error, app_commands.MissingPermissions):
                await interaction.response.send_message("❌ You do not have permission to use this command.", ephemeral=True)
            else:
                # Send generic error for other cases, log the details
                await interaction.response.send_message(f"❌ An unexpected error occurred while running the command.", ephemeral=True)
                print(f"Error in debug_sync_commands decorator chain: {error}")

