# llmcord/utils/slash_commands.py
import discord
from discord import app_commands
from typing import List, Optional

class SlashCommandHandler:
    """Handle Discord slash commands."""
    
    def __init__(self, bot):
        """Initialize slash command handler."""
        self.bot = bot
        self.tree = app_commands.CommandTree(bot.discord_client)
    
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
                    reply_content = f"Your current notes ({len(current_memory)} chars / {max_len} max):\n```\n{current_memory}\n```"
                    await interaction.followup.send(content=reply_content[:2000], ephemeral=True)
                else:
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

