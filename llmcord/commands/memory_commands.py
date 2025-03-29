import asyncio
import logging
import re
from typing import Optional, List, Tuple, Union, Dict

import discord
from discord.ui import View, Button, Select, Modal, TextInput # Added Modal, TextInput
from discord import ButtonStyle, Interaction, Message # For type hinting

# Assuming MemoryStorage and other necessary types are importable
# from ..memory.storage import MemoryStorage # Adjust path as needed
# from ..bot import LLMCordBot # Type hinting, avoid circular import if possible

log = logging.getLogger(__name__)

# Constants for reactions (can be moved to config or constants file later)
REACTION_CONFIRM = "✅"
REACTION_CANCEL = "❌"
REACTION_DELETE = "🗑️"
REACTION_TIMEOUT = 60.0 # Increased timeout for interactive session

NUMBER_REACTIONS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

# Constants for message splitting
MAX_MESSAGE_LEN = 1950 # Keep well under Discord's 2000 char limit for replies/ephemeral messages
CHUNK_SIZE = MAX_MESSAGE_LEN - 10 # Leave room for code block formatting ```\n \n```
MAX_INTERACTIVE_LINES = 10 # Limit number of lines shown for interactive edit/delete
MAX_SELECT_OPTIONS = 25 # Discord limit for Select Menus

# --- UI Views ---

class MemoryEditSelectView(View):
    """View with a Select menu for choosing a line to edit/delete."""
    def __init__(self, handler, original_interaction: Interaction, lines: List[str], timeout=REACTION_TIMEOUT):
        super().__init__(timeout=timeout)
        self.handler = handler
        self.original_interaction = original_interaction
        self.lines = lines
        self.selected_option = None # Stores the selected line index or 'delete'/'cancel'

        options = []
        for i, line in enumerate(lines):
            if i >= MAX_SELECT_OPTIONS - 2: # Reserve space for delete/cancel
                break
            label = f"Line {i+1}: {line[:80]}{'...' if len(line) > 80 else ''}"
            options.append(discord.SelectOption(label=label, value=str(i)))

        options.append(discord.SelectOption(label="🗑️ Delete a line...", value="delete", emoji="🗑️"))
        options.append(discord.SelectOption(label="❌ Cancel", value="cancel", emoji="❌"))

        select_menu = Select(
            placeholder="Choose an action or line to edit...",
            options=options,
            custom_id="memory_edit_select"
        )
        select_menu.callback = self.select_callback
        self.add_item(select_menu)

    async def select_callback(self, interaction: Interaction):
        # Ensure only the original user can interact
        if interaction.user.id != self.original_interaction.user.id:
            await interaction.response.send_message("You cannot interact with this menu.", ephemeral=True)
            return

        self.selected_option = interaction.data['values'][0]
        await interaction.response.defer() # Acknowledge interaction
        self.stop() # Stop the view from listening

    async def on_timeout(self):
        # Edit the original message on timeout
        try:
            await self.original_interaction.edit_original_response(content="Memory edit session timed out.", view=None)
        except discord.NotFound:
            pass # Message might have been deleted
        except discord.HTTPException as e:
            log.warning(f"Failed to edit memory edit message on timeout: {e}")
        # Release lock via handler
        self.handler._release_session_lock(self.original_interaction.user.id)

class MemoryDeleteSelectView(View):
    """View with a Select menu specifically for choosing a line to delete."""
    def __init__(self, handler, original_interaction: Interaction, lines: List[str], timeout=REACTION_TIMEOUT):
        super().__init__(timeout=timeout)
        self.handler = handler
        self.original_interaction = original_interaction
        self.lines = lines
        self.selected_index = -1 # Stores the selected line index

        options = []
        for i, line in enumerate(lines):
            if i >= MAX_SELECT_OPTIONS -1: # Reserve space for cancel
                break
            label = f"Line {i+1}: {line[:80]}{'...' if len(line) > 80 else ''}"
            options.append(discord.SelectOption(label=label, value=str(i)))

        options.append(discord.SelectOption(label="❌ Cancel", value="cancel", emoji="❌"))

        select_menu = Select(
            placeholder="Choose a line to DELETE...",
            options=options,
            custom_id="memory_delete_select"
        )
        select_menu.callback = self.select_callback
        self.add_item(select_menu)

    async def select_callback(self, interaction: Interaction):
        if interaction.user.id != self.original_interaction.user.id:
            await interaction.response.send_message("You cannot interact with this menu.", ephemeral=True)
            return

        value = interaction.data['values'][0]
        if value == "cancel":
            self.selected_index = -1 # Indicate cancellation
        else:
            self.selected_index = int(value)

        await interaction.response.defer()
        self.stop()

    async def on_timeout(self):
        try:
            await self.original_interaction.edit_original_response(content="Memory delete selection timed out.", view=None)
        except discord.NotFound: pass
        except discord.HTTPException as e: log.warning(f"Failed to edit memory delete message on timeout: {e}")
        self.handler._release_session_lock(self.original_interaction.user.id)


class MemoryEditModal(Modal, title="Edit Memory Line"):
    """Modal for entering the new text for a memory line."""
    new_content = TextInput(
        label="New content for the selected line",
        style=discord.TextStyle.paragraph,
        placeholder="Enter the new text here...",
        required=True,
        max_length=1000 # Keep modal input reasonable, full check later
    )

    def __init__(self, handler, original_interaction: Interaction, line_index: int, original_line: str):
        super().__init__(timeout=REACTION_TIMEOUT * 2) # Longer timeout for modal
        self.handler = handler
        self.original_interaction = original_interaction
        self.line_index = line_index
        self.original_line = original_line
        self.submitted = False

    async def on_submit(self, interaction: Interaction):
        self.submitted = True
        await interaction.response.defer(ephemeral=True) # Defer followup
        # Let the handler process the edit
        await self.handler._process_modal_edit(interaction, self.line_index, self.original_line, self.new_content.value)
        self.stop()

    async def on_error(self, interaction: Interaction, error: Exception):
        log.error(f"Error in MemoryEditModal: {error}", exc_info=True)
        await interaction.followup.send("An error occurred submitting the edit.", ephemeral=True)
        self.handler._release_session_lock(interaction.user.id)
        self.stop()

    async def on_timeout(self):
         if not self.submitted:
            try:
                # Try to edit the original interaction message if modal timed out without submission
                await self.original_interaction.edit_original_response(content="Memory edit timed out waiting for input.", view=None)
            except discord.NotFound: pass
            except discord.HTTPException as e: log.warning(f"Failed to edit original message on modal timeout: {e}")
            self.handler._release_session_lock(self.original_interaction.user.id)


class MemoryConfirmDeleteView(View):
    """Simple Yes/No confirmation view for deleting."""
    def __init__(self, handler, original_interaction: Interaction, timeout=REACTION_TIMEOUT):
        super().__init__(timeout=timeout)
        self.handler = handler
        self.original_interaction = original_interaction
        self.confirmed = None # True for yes, False for no/timeout

    @discord.ui.button(label="Yes, Delete", style=ButtonStyle.danger, custom_id="mem_del_yes")
    async def confirm_button(self, interaction: Interaction, button: Button):
        if interaction.user.id != self.original_interaction.user.id:
            await interaction.response.send_message("You cannot confirm this action.", ephemeral=True)
            return
        self.confirmed = True
        await interaction.response.defer()
        self.stop()

    @discord.ui.button(label="No, Cancel", style=ButtonStyle.secondary, custom_id="mem_del_no")
    async def cancel_button(self, interaction: Interaction, button: Button):
        if interaction.user.id != self.original_interaction.user.id:
            await interaction.response.send_message("You cannot confirm this action.", ephemeral=True)
            return
        self.confirmed = False
        await interaction.response.defer()
        self.stop()

    async def on_timeout(self):
        self.confirmed = False # Treat timeout as cancellation
        try:
            await self.original_interaction.edit_original_response(content="Delete confirmation timed out.", view=None)
        except discord.NotFound: pass
        except discord.HTTPException as e: log.warning(f"Failed to edit delete confirm message on timeout: {e}")
        # Lock should be released by the calling function (_handle_interactive_delete_line)

# --- Command Handler Class ---

class MemoryCommandHandler:
    """Handles processing for both !memory and /memory commands."""

    def __init__(self, bot):
        """Initialize the handler with the main bot instance."""
        self.bot = bot
        self.config = bot.config
        self.memory_store = bot.memory_store
        self.discord_client = bot.discord_client
        self._active_sessions: Dict[int, asyncio.Lock] = {} # user_id: Lock

    async def _acquire_session_lock(self, user_id: int) -> bool:
        """Acquire lock for a user's interactive session."""
        if user_id not in self._active_sessions:
            self._active_sessions[user_id] = asyncio.Lock()

        lock = self._active_sessions[user_id]
        if lock.locked():
            return False # Session already active
        await lock.acquire()
        log.debug(f"Acquired session lock for user {user_id}")
        return True

    def _release_session_lock(self, user_id: int):
        """Release lock for a user's interactive session."""
        if user_id in self._active_sessions:
            lock = self._active_sessions[user_id]
            if lock.locked():
                lock.release()
                log.debug(f"Released session lock for user {user_id}")
            # Clean up lock entry? Maybe not, reuse lock object
            # del self._active_sessions[user_id]
        else:
             log.debug(f"Attempted to release lock for user {user_id}, but no lock found.")


    async def handle_legacy_command(self, message: Message, args: Optional[str]):
        """Processes legacy `!memory` commands."""
        if not self.memory_store or not self.memory_store.enabled:
            await message.reply("Memory feature is disabled.", mention_author=False, delete_after=10)
            return

        user_id = message.author.id

        if not args:
            await self.handle_view(message)
            return

        parts = args.lower().split(maxsplit=1)
        subcommand = parts[0]
        content = args[len(subcommand):].lstrip() if len(args) > len(subcommand) else None

        log.debug(f"Memory legacy command: User={user_id}, Subcommand='{subcommand}', Content='{content[:50] if content else None}...'")

        if subcommand == "view":
            await self.handle_view(message)
        elif subcommand == "update":
            if content is not None:
                await self.handle_update(message, content)
            else:
                await self._send_help(message, "Missing content for update.")
        elif subcommand == "clear":
            await self.handle_clear(message)
        elif subcommand == "add":
            if content:
                await self.handle_add(message, content)
            else:
                await self._send_help(message, "Missing content to add.")
        elif subcommand == "edit":
            await self.start_interactive_session(message)
        else:
            await self._send_help(message, f"Unknown subcommand: `{subcommand}`")

    # --- Core Logic Methods ---

    async def handle_view(self, context: Union[Message, Interaction]):
        """Handles viewing memory (shared logic)."""
        user_id = context.author.id if isinstance(context, Message) else context.user.id
        is_interaction = isinstance(context, Interaction)
        ephemeral = is_interaction

        current_memory = await self.memory_store.get_user_memory(user_id)

        if not current_memory:
            await self._reply_or_followup(context, "You have no saved notes.", ephemeral=ephemeral)
            return

        max_len_config = self.config.get("memory.max_memory_length", 1500)
        header = f"Your current notes ({len(current_memory)} chars / {max_len_config} max):"
        full_message_approx_len = len(header) + len(current_memory) + 10

        if full_message_approx_len <= MAX_MESSAGE_LEN:
            reply_content = f"{header}\n```\n{current_memory}\n```"
            await self._reply_or_followup(context, reply_content, ephemeral=ephemeral)
        else:
            await self._reply_or_followup(context, header, ephemeral=ephemeral)
            await self._send_text_in_chunks(context, current_memory, ephemeral=ephemeral)


    async def handle_update(self, context: Union[Message, Interaction], content: str):
        """Handles updating memory (shared logic)."""
        user_id = context.author.id if isinstance(context, Message) else context.user.id
        is_interaction = isinstance(context, Interaction)
        ephemeral = is_interaction

        max_len = self.config.get("memory.max_memory_length", 1500)
        if len(content) > max_len:
            await self._reply_or_followup(
                context,
                f"❌ Error: Notes too long ({len(content)}/{max_len} chars). **Not saved.**",
                ephemeral=ephemeral
            )
            return

        if isinstance(context, Message):
            confirmed = await self._confirm_action_with_reaction(
                context,
                f"This will **replace** your entire memory. Are you sure?"
            )
            if not confirmed: return

        success = await self.memory_store.save_user_memory(user_id, content)
        if success:
            await self._reply_or_followup(context, f"✅ Your notes have been updated ({len(content)} chars saved).", ephemeral=ephemeral)
        else:
            await self._reply_or_followup(context, "❌ Error saving notes. Please try again later.", ephemeral=ephemeral)


    async def handle_clear(self, context: Union[Message, Interaction]):
        """Handles clearing memory (shared logic)."""
        user_id = context.author.id if isinstance(context, Message) else context.user.id
        is_interaction = isinstance(context, Interaction)
        ephemeral = is_interaction

        if isinstance(context, Message):
            confirmed = await self._confirm_action_with_reaction(
                context,
                f"This will **clear** your entire memory. Are you sure?"
            )
            if not confirmed: return

        success = await self.memory_store.save_user_memory(user_id, "")
        if success:
            await self._reply_or_followup(context, "✅ Your notes have been cleared.", ephemeral=ephemeral)
        else:
            await self._reply_or_followup(context, "❌ Error clearing notes. Please try again later.", ephemeral=ephemeral)


    async def handle_add(self, context: Union[Message, Interaction], content: str):
        """Handles appending to memory (shared logic)."""
        user_id = context.author.id if isinstance(context, Message) else context.user.id
        is_interaction = isinstance(context, Interaction)
        ephemeral = is_interaction

        if not content:
             await self._reply_or_followup(context, "❌ Cannot add empty content.", ephemeral=ephemeral)
             return

        success = await self.memory_store.append_memory(user_id, content)
        if success:
            await self._reply_or_followup(context, f"✅ Added text to your notes.", ephemeral=ephemeral)
        else:
            await self._reply_or_followup(context, "❌ Error adding to notes. Please try again later.", ephemeral=ephemeral)

    # --- Interactive Session Methods ---

    async def start_interactive_session(self, context: Union[Message, Interaction]):
        """Starts the interactive edit/delete session."""
        user_id = context.author.id if isinstance(context, Message) else context.user.id
        is_interaction = isinstance(context, Interaction)
        ephemeral = is_interaction

        if not await self._acquire_session_lock(user_id):
            await self._reply_or_followup(context, "You already have an active memory edit session.", ephemeral=True)
            return

        session_message = None
        interaction_response_message = None # Store the message sent via interaction followup

        try:
            current_memory = await self.memory_store.get_user_memory(user_id)
            if not current_memory:
                await self._reply_or_followup(context, "You have no saved notes to edit.", ephemeral=ephemeral)
                self._release_session_lock(user_id)
                return

            lines = current_memory.splitlines()
            if not lines:
                 await self._reply_or_followup(context, "Your notes appear empty or contain only whitespace.", ephemeral=ephemeral)
                 self._release_session_lock(user_id)
                 return

            lines_to_show = lines[:MAX_INTERACTIVE_LINES]
            num_lines = len(lines_to_show)

            display_text = f"**Select an action or line to edit (1-{num_lines}):**\n"
            display_text += "```\n"
            for i, line in enumerate(lines_to_show):
                display_line = line[:100] + '...' if len(line) > 100 else line
                display_text += f"{i+1}: {display_line}\n"
            display_text += "```"
            if len(lines) > MAX_INTERACTIVE_LINES:
                display_text += f"\n*(Showing first {MAX_INTERACTIVE_LINES} lines)*"

            # --- Send message and add interactive elements ---
            if is_interaction:
                view = MemoryEditSelectView(self, context, lines_to_show)
                interaction_response_message = await self._reply_or_followup(context, display_text, ephemeral=True, view=view)
                if not interaction_response_message:
                    self._release_session_lock(user_id)
                    return

                await view.wait() # Wait for the view to stop (timeout or selection)

                # Process selection from the view
                selected_value = view.selected_option
                if selected_value is None: # Timeout occurred in view
                    # Message already edited by view timeout handler, lock released
                    return
                elif selected_value == "cancel":
                    await context.edit_original_response(content="Memory edit cancelled.", view=None)
                    self._release_session_lock(user_id)
                elif selected_value == "delete":
                    await self._handle_interactive_delete_via_select(context, lines)
                    # Lock release handled within delete flow or its timeout
                else: # Line number selected for edit
                    selected_index = int(selected_value)
                    original_line = lines[selected_index]
                    # Use Modal for editing in interactions
                    modal = MemoryEditModal(self, context, selected_index, original_line)
                    await context.response.send_modal(modal) # Send the modal
                    # Lock release handled by modal timeout/submit/error
            else: # Legacy command uses reactions
                session_message = await self._reply_or_followup(context, display_text)
                if not session_message:
                    self._release_session_lock(user_id)
                    return

                active_reactions = []
                for i in range(num_lines):
                    await session_message.add_reaction(NUMBER_REACTIONS[i])
                    active_reactions.append(NUMBER_REACTIONS[i])
                await session_message.add_reaction(REACTION_DELETE)
                active_reactions.append(REACTION_DELETE)
                await session_message.add_reaction(REACTION_CANCEL)
                active_reactions.append(REACTION_CANCEL)

                def check(reaction, user):
                    return user == context.author and str(reaction.emoji) in active_reactions and reaction.message.id == session_message.id

                try:
                    reaction, user = await self.discord_client.wait_for('reaction_add', timeout=REACTION_TIMEOUT, check=check)
                    emoji = str(reaction.emoji)

                    if emoji == REACTION_CANCEL:
                        await session_message.edit(content="Edit cancelled.", view=None)
                        self._release_session_lock(user_id)
                        return

                    selected_index = -1
                    is_delete = False
                    if emoji == REACTION_DELETE:
                        is_delete = True
                    else:
                        try: selected_index = NUMBER_REACTIONS.index(emoji)
                        except ValueError: pass

                    if is_delete:
                         await session_message.edit(content=f"Which line number do you want to delete? React with the number (1-{num_lines}) or {REACTION_CANCEL}.", view=None)
                         delete_check = lambda r, u: u == context.author and r.message.id == session_message.id and (str(r.emoji) in NUMBER_REACTIONS[:num_lines] or str(r.emoji) == REACTION_CANCEL)
                         try:
                             del_reaction, del_user = await self.discord_client.wait_for('reaction_add', timeout=REACTION_TIMEOUT, check=delete_check)
                             del_emoji = str(del_reaction.emoji)
                             if del_emoji == REACTION_CANCEL:
                                 await session_message.edit(content="Delete cancelled.", view=None)
                                 self._release_session_lock(user_id)
                             else:
                                 delete_index = NUMBER_REACTIONS.index(del_emoji)
                                 original_line_to_delete = lines[delete_index]
                                 # Pass original message context for confirmation reply
                                 await self._handle_interactive_delete_line(context, session_message, delete_index, original_line_to_delete)
                                 # Lock released within delete handler

                         except asyncio.TimeoutError:
                             await session_message.edit(content="Delete confirmation timed out.", view=None)
                             self._release_session_lock(user_id)

                    elif selected_index >= 0:
                        original_line = lines[selected_index]
                        await session_message.edit(content=f"Editing line {selected_index + 1}. Please reply with the new text for this line.", view=None)
                        # Pass original message context for reply waiting
                        await self._handle_interactive_edit_line(context, session_message, selected_index, original_line)
                        # Lock released within edit handler

                except asyncio.TimeoutError:
                    await session_message.edit(content="Edit session timed out.", view=None)
                    self._release_session_lock(user_id)

        except Exception as e:
            log.error(f"Error during interactive memory session for user {user_id}: {e}", exc_info=True)
            await self._reply_or_followup(context, "An error occurred during the interactive edit session.", ephemeral=ephemeral)
            if session_message:
                 try: await session_message.edit(content="Session ended due to error.", view=None)
                 except: pass
            elif interaction_response_message:
                 try: await context.edit_original_response(content="Session ended due to error.", view=None)
                 except: pass
            self._release_session_lock(user_id)


    async def _handle_interactive_edit_line(self, original_context: Message, prompt_msg: Message, line_index: int, original_line: str):
        """Handles waiting for the user's reply with the new line content (Legacy Commands)."""
        user_id = original_context.author.id
        try:
            def check(message: Message):
                return message.author == original_context.author and message.channel == original_context.channel

            reply_message = await self.discord_client.wait_for('message', timeout=REACTION_TIMEOUT * 2, check=check)
            new_line_content = reply_message.content

            # --- Validate length ---
            if await self._validate_edit_length(user_id, line_index, new_line_content, prompt_msg):
                # --- Perform Edit ---
                success = await self._perform_edit(user_id, line_index, new_line_content)
                if success:
                    await prompt_msg.edit(content=f"✅ Line {line_index + 1} updated successfully.", view=None)
                else:
                    await prompt_msg.edit(content=f"❌ Failed to save updated memory.", view=None)
            # Else: Validation failed, message already edited by validator

            try: await reply_message.delete() # Clean up user reply
            except: pass

        except asyncio.TimeoutError:
            await prompt_msg.edit(content="Edit timed out waiting for your reply.", view=None)
        except Exception as e:
             log.error(f"Error handling interactive edit reply for user {user_id}: {e}", exc_info=True)
             await prompt_msg.edit(content="An error occurred while processing your edit.", view=None)
        finally:
            self._release_session_lock(user_id)


    async def _process_modal_edit(self, interaction: Interaction, line_index: int, original_line: str, new_line_content: str):
        """Handles processing the edit after modal submission."""
        user_id = interaction.user.id
        try:
            # --- Validate length ---
            # Use interaction context for replying to validation errors
            if await self._validate_edit_length(user_id, line_index, new_line_content, interaction):
                # --- Perform Edit ---
                success = await self._perform_edit(user_id, line_index, new_line_content)
                if success:
                    await interaction.followup.send(f"✅ Line {line_index + 1} updated successfully.", ephemeral=True)
                    # Edit original interaction message to remove view
                    try: await interaction.edit_original_response(content="Memory edit complete.", view=None)
                    except: pass
                else:
                    await interaction.followup.send(f"❌ Failed to save updated memory.", ephemeral=True)
            # Else: Validation failed, followup already sent by validator

        except Exception as e:
            log.error(f"Error processing modal edit for user {user_id}: {e}", exc_info=True)
            await interaction.followup.send("An error occurred while processing the edit.", ephemeral=True)
        finally:
            self._release_session_lock(user_id)


    async def _validate_edit_length(self, user_id: int, line_index: int, new_line_content: str, context_or_msg: Union[Interaction, Message]) -> bool:
        """Checks if replacing a line keeps memory within limits. Sends error if not."""
        current_memory = await self.memory_store.get_user_memory(user_id) or ""
        memory_lines = current_memory.splitlines()
        if not (0 <= line_index < len(memory_lines)):
             await self._reply_or_followup(context_or_msg, "Error: Line index out of bounds (memory may have changed).", ephemeral=True)
             return False # Should not happen ideally

        memory_lines[line_index] = new_line_content
        potential_new_memory = "\n".join(memory_lines)
        max_len = self.config.get("memory.max_memory_length", 1500)

        if len(potential_new_memory) > max_len:
            error_msg = f"❌ Error: Making that change would exceed the maximum note length ({len(potential_new_memory)}/{max_len} chars). **Edit cancelled.**"
            if isinstance(context_or_msg, Interaction):
                 await context_or_msg.followup.send(error_msg, ephemeral=True)
                 try: await context_or_msg.edit_original_response(content="Memory edit cancelled (too long).", view=None)
                 except: pass
            elif isinstance(context_or_msg, Message):
                 await context_or_msg.edit(content=error_msg, view=None) # Edit the prompt message
            return False
        return True

    async def _perform_edit(self, user_id: int, line_index: int, new_line_content: str) -> bool:
        """Internal helper to reconstruct and save memory after an edit."""
        current_memory = await self.memory_store.get_user_memory(user_id) or ""
        memory_lines = current_memory.splitlines()
        if not (0 <= line_index < len(memory_lines)): return False # Safety check

        memory_lines[line_index] = new_line_content
        new_memory = "\n".join(memory_lines)
        return await self.memory_store.save_user_memory(user_id, new_memory)


    async def _handle_interactive_delete_line(self, original_context: Union[Message, Interaction], prompt_msg_or_interaction: Union[Message, Interaction], line_index: int, original_line: str):
        """Handles deleting a specific line after confirmation (used by both legacy and slash)."""
        user_id = original_context.author.id if isinstance(original_context, Message) else original_context.user.id
        is_interaction = isinstance(original_context, Interaction)
        ephemeral = is_interaction
        confirmed = False

        try:
            # --- Confirmation ---
            if is_interaction:
                confirm_view = MemoryConfirmDeleteView(self, original_context)
                prompt_text = f"Delete line {line_index + 1}: `{original_line[:50]}{'...' if len(original_line)>50 else ''}`?"
                # Edit the original interaction message to show confirmation
                await original_context.edit_original_response(content=prompt_text, view=confirm_view)
                await confirm_view.wait()
                confirmed = confirm_view.confirmed
            else: # Legacy uses reactions
                confirmed = await self._confirm_action_with_reaction(
                    original_context,
                    f"Delete line {line_index + 1}: `{original_line[:50]}{'...' if len(original_line)>50 else ''}`?"
                )

            # --- Process Confirmation Result ---
            edit_target = prompt_msg_or_interaction # Message or Interaction to edit final status on

            if not confirmed:
                content = "Delete cancelled."
                if isinstance(edit_target, Interaction): await edit_target.edit_original_response(content=content, view=None)
                elif isinstance(edit_target, Message): await edit_target.edit(content=content, view=None)
                # Lock released by confirmation view/reaction handler on cancel/timeout
                return # Exit if not confirmed

            # --- Perform Delete ---
            success = await self._perform_delete(user_id, line_index)

            if success:
                content = f"✅ Line {line_index + 1} deleted successfully."
                if isinstance(edit_target, Interaction): await edit_target.edit_original_response(content=content, view=None)
                elif isinstance(edit_target, Message): await edit_target.edit(content=content, view=None)
            else:
                content = f"❌ Failed to save memory after deletion."
                if isinstance(edit_target, Interaction): await edit_target.edit_original_response(content=content, view=None)
                elif isinstance(edit_target, Message): await edit_target.edit(content=content, view=None)

        except Exception as e:
             log.error(f"Error handling interactive delete for user {user_id}: {e}", exc_info=True)
             content = "An error occurred while processing the deletion."
             try:
                 if isinstance(prompt_msg_or_interaction, Interaction): await prompt_msg_or_interaction.edit_original_response(content=content, view=None)
                 elif isinstance(prompt_msg_or_interaction, Message): await prompt_msg_or_interaction.edit(content=content, view=None)
             except: pass # Ignore errors during error message sending
        finally:
             # Release lock here ONLY if confirmation succeeded or an error occurred after confirmation
             # If confirmation failed/timed out, the lock is released there.
             if confirmed: # Or if an exception happened after confirmation started
                 self._release_session_lock(user_id)


    async def _handle_interactive_delete_via_select(self, interaction: Interaction, lines: List[str]):
        """Handles the delete flow when initiated from the main Select menu (Slash Commands)."""
        user_id = interaction.user.id
        try:
            delete_view = MemoryDeleteSelectView(self, interaction, lines)
            await interaction.edit_original_response(content="Which line do you want to delete?", view=delete_view)
            await delete_view.wait()

            delete_index = delete_view.selected_index
            if delete_index == -1: # Cancelled or timed out
                if not delete_view.is_finished(): # If cancelled explicitly
                     await interaction.edit_original_response(content="Delete cancelled.", view=None)
                # Timeout message handled by view, lock released by view
                return

            # Line selected for deletion
            original_line_to_delete = lines[delete_index]
            # Call the common delete handler, passing the interaction as both contexts
            await self._handle_interactive_delete_line(interaction, interaction, delete_index, original_line_to_delete)
            # Lock release is handled within _handle_interactive_delete_line

        except Exception as e:
            log.error(f"Error in delete via select flow for user {user_id}: {e}", exc_info=True)
            await interaction.edit_original_response(content="An error occurred during delete selection.", view=None)
            self._release_session_lock(user_id)


    async def _perform_delete(self, user_id: int, line_index: int) -> bool:
        """Internal helper to reconstruct and save memory after a deletion."""
        current_memory = await self.memory_store.get_user_memory(user_id) or ""
        memory_lines = current_memory.splitlines()
        if not (0 <= line_index < len(memory_lines)): return False # Safety check

        del memory_lines[line_index]
        new_memory = "\n".join(memory_lines)
        return await self.memory_store.save_user_memory(user_id, new_memory)


    # --- Helper Methods ---

    async def _send_help(self, context: Union[Message, Interaction], error_msg: Optional[str] = None):
        """Sends a help message for memory commands."""
        is_interaction = isinstance(context, Interaction)
        ephemeral = is_interaction
        prefix = "/" if is_interaction else COMMAND_PREFIX

        help_text = "**Memory Commands:**\n" \
                    f"`{prefix}memory view` - Show your notes.\n" \
                    f"`{prefix}memory update <text>` - Replace notes with new text.\n" \
                    f"`{prefix}memory add <text>` - Add text to the end of your notes.\n" \
                    f"`{prefix}memory clear` - Clear all your notes.\n" \
                    f"`{prefix}memory edit` - Start interactive session to edit/delete notes."
        if error_msg:
            help_text = f"❌ {error_msg}\n\n{help_text}"
        await self._reply_or_followup(context, help_text, ephemeral=ephemeral)


    async def _reply_or_followup(self, context: Union[Message, Interaction], content: str, ephemeral: bool = False, view: Optional[View] = None, **kwargs):
        """Replies to a message or follows up an interaction, handling deferral."""
        try:
            if isinstance(context, Interaction):
                if not context.response.is_done():
                    # If sending a view, we cannot defer AND send initial response with view
                    # So, send the initial response directly if view is present
                    if view:
                         await context.response.send_message(content, ephemeral=ephemeral, view=view, **kwargs)
                         # Get the message object after sending
                         message = await context.original_response()
                         return message
                    else:
                         await context.response.defer(ephemeral=ephemeral)

                # If deferred or no view initially, use followup
                message = await context.followup.send(content, ephemeral=ephemeral, view=view, wait=True, **kwargs)
                return message
            elif isinstance(context, Message):
                message = await context.reply(content, mention_author=False, view=view, **kwargs)
                return message
            else:
                log.warning(f"Unsupported context type for reply/followup: {type(context)}")
                return None
        except discord.NotFound:
            log.warning(f"Interaction or message {getattr(context, 'id', 'N/A')} not found. Could not send reply/followup.")
            return None
        except discord.Forbidden:
            channel_id = getattr(context, 'channel_id', getattr(context.channel, 'id', 'N/A'))
            log.warning(f"Missing permissions to send reply/followup in channel {channel_id}")
            return None
        except discord.InteractionResponded:
             # If we deferred then tried to send_message with a view, this might happen
             # Try sending via followup instead
             log.warning("Interaction already responded, attempting followup.")
             try:
                 message = await context.followup.send(content, ephemeral=ephemeral, view=view, wait=True, **kwargs)
                 return message
             except Exception as followup_err:
                 log.error(f"Error sending followup after InteractionResponded: {followup_err}", exc_info=True)
                 return None
        except Exception as e:
            log.error(f"Error sending reply/followup: {e}", exc_info=True)
            return None


    async def _confirm_action_with_reaction(self, message: Message, prompt: str) -> bool:
        """Asks for confirmation using reactions on a legacy command message."""
        confirm_msg = None
        user_id = message.author.id
        # Lock acquisition moved to the calling function (handle_update/clear)
        # if not await self._acquire_session_lock(user_id): return False

        try:
            confirm_msg = await message.reply(f"{prompt} (React {REACTION_CONFIRM} or {REACTION_CANCEL} within {REACTION_TIMEOUT:.0f}s)", mention_author=False)
            if not confirm_msg: return False

            await confirm_msg.add_reaction(REACTION_CONFIRM)
            await confirm_msg.add_reaction(REACTION_CANCEL)

            def check(reaction, user):
                return user == message.author and str(reaction.emoji) in [REACTION_CONFIRM, REACTION_CANCEL] and reaction.message.id == confirm_msg.id

            reaction, user = await self.discord_client.wait_for('reaction_add', timeout=REACTION_TIMEOUT, check=check)

            try: await confirm_msg.delete()
            except: pass
            return str(reaction.emoji) == REACTION_CONFIRM

        except asyncio.TimeoutError:
            if confirm_msg:
                try: await confirm_msg.delete()
                except: pass
            await message.reply("Confirmation timed out.", mention_author=False, delete_after=10)
            return False
        except discord.Forbidden:
             log.warning(f"Missing permissions for reaction confirmation in channel {message.channel.id}")
             if confirm_msg:
                 try: await confirm_msg.clear_reactions()
                 except: pass
             await message.reply(f"Error: Missing permissions for reaction confirmation. Action cancelled.", mention_author=False)
             return False
        except Exception as e:
            log.error(f"Error during reaction confirmation: {e}", exc_info=True)
            if confirm_msg:
                try: await confirm_msg.delete()
                except: pass
            await message.reply("An error occurred during confirmation. Action cancelled.", mention_author=False)
            return False
        # Lock release moved to the calling function


    async def _send_text_in_chunks(self, context: Union[Message, Interaction], text: str, ephemeral: bool = False):
        """Sends long text in multiple messages, formatted as code blocks."""
        if not text:
            return
        start = 0
        messages_sent = []
        # Send first message using the helper (handles initial reply/response)
        first_chunk = text[start:CHUNK_SIZE]
        msg = await self._reply_or_followup(context, content=f"```\n{first_chunk}\n```", ephemeral=ephemeral)
        if msg: messages_sent.append(msg)
        start += CHUNK_SIZE

        # Send subsequent chunks using channel.send or followup.send
        while start < len(text):
            end = start + CHUNK_SIZE
            chunk = text[start:end]
            try:
                if isinstance(context, Interaction):
                    # Use followup for subsequent messages in an interaction
                    msg = await context.followup.send(content=f"```\n{chunk}\n```", ephemeral=ephemeral, wait=True)
                    if msg: messages_sent.append(msg)
                    await asyncio.sleep(0.1) # Avoid rate limits
                elif isinstance(context, Message):
                    # Use channel.send for subsequent messages for a legacy command
                    msg = await context.channel.send(content=f"```\n{chunk}\n```")
                    if msg: messages_sent.append(msg)
                else: break # Should not happen
            except discord.Forbidden:
                 channel_id = getattr(context, 'channel_id', getattr(context.channel, 'id', 'N/A'))
                 log.warning(f"Missing permissions to send chunk message in channel {channel_id}")
                 break # Stop sending if permissions fail
            except Exception as e:
                 log.error(f"Error sending text chunk: {e}", exc_info=True)
                 break # Stop sending on other errors
            start = end
        return messages_sent