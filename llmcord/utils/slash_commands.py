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
            # Deferral will be handled within the MemoryCommandHandler methods if needed
            # await interaction.response.defer(ephemeral=True) # Removed deferral here

            if not self.bot.memory_command_handler or not self.bot.memory_command_handler.memory_store.enabled:
                 # Need to check if handler exists and is enabled
                 # Use response.send_message if not deferred yet
                if not interaction.response.is_done():
                    await interaction.response.send_message("Memory feature is disabled.", ephemeral=True)
                else:
                    await interaction.followup.send("Memory feature is disabled.", ephemeral=True)
                return

            # Delegate to the shared handler
            handler = self.bot.memory_command_handler
            if action == "view":
                await handler.handle_view(interaction)
            elif action == "update":
                if content is not None: # Check content exists
                    await handler.handle_update(interaction, content)
                else:
                    # Use response.send_message if not deferred yet
                    if not interaction.response.is_done():
                         await interaction.response.send_message("Please provide content to update your notes.", ephemeral=True)
                    else:
                        await interaction.followup.send("Please provide content to update your notes.", ephemeral=True)
            elif action == "clear":
                await handler.handle_clear(interaction)
        

        # Memory Edit command (Interactive)
        @self.tree.command(
            name="memory_edit",
            description="Interactively edit or delete lines from your memory notes"
        )
        # No parameters needed for interactive session start
        async def memory_edit_command(interaction: discord.Interaction):
            # Deferral will be handled within the MemoryCommandHandler methods if needed
            # await interaction.response.defer(ephemeral=True) # Removed deferral here

            if not self.bot.memory_command_handler or not self.bot.memory_command_handler.memory_store.enabled:
                 # Need to check if handler exists and is enabled
                if not interaction.response.is_done():
                    await interaction.response.send_message("Memory feature is disabled.", ephemeral=True)
                else:
                    await interaction.followup.send("Memory feature is disabled.", ephemeral=True)
                return

            # Delegate to the shared handler to start the interactive session
            await self.bot.memory_command_handler.start_interactive_session(interaction)


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

