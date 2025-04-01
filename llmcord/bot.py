import asyncio
import re
import logging
from datetime import datetime as dt
from base64 import b64encode
from dataclasses import dataclass, field
from typing import Dict, List, Set, Optional, Any, Tuple, Literal
import traceback
import json

import discord
import httpx

from .config import Config
from .providers import ProviderFactory
from .memory.storage import MemoryStorage
from .utils.slash_commands import SlashCommandHandler
from .utils.rate_limit import RateLimiter
from .reasoning.manager import ReasoningManager
from .commands.memory_commands import MemoryCommandHandler
from .status import StatusManager


log = logging.getLogger(__name__)

# --- Constants ---
VISION_MODEL_TAGS = ("gpt-4", "claude-3", "gemini", "gemma", "pixtral", "mistral-small", "llava", "vision", "vl")
PROVIDERS_SUPPORTING_USERNAMES = ("openai", "x-ai")

EMBED_COLOR_COMPLETE = discord.Color.dark_green()
EMBED_COLOR_INCOMPLETE = discord.Color.orange()
EMBED_COLOR_ERROR = discord.Color.red()

STREAMING_INDICATOR = " ⚪"
EDIT_DELAY_SECONDS = 1.3
MAX_MESSAGE_NODES = 100
COMMAND_PREFIX = "!"

# --- Message Node Dataclass ---
@dataclass
class MsgNode:
    text: Optional[str] = None
    images: list = field(default_factory=list)
    role: Literal["user", "assistant", "system"] = "assistant"
    user_id: Optional[int] = None
    has_bad_attachments: bool = False
    fetch_parent_failed: bool = False
    parent_msg: Optional[discord.Message] = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

class LLMCordBot:
    """Main Discord bot class for LLMCord."""
    
    def __init__(self):
        """Initialize the bot instance."""
        self.config = Config()
        self.discord_client = None
        self.httpx_client = None
        self.msg_nodes: Dict[int, MsgNode] = {}
        self.last_task_time: float = 0
        self.memory_store = None
        self.memory_processor = None
        self.llm_provider = None
    
        self.status_manager = None
        self.reasoning_manager: Optional[ReasoningManager] = None
        self.slash_handler = None
        self.rate_limiter: Optional[RateLimiter] = None
        self.memory_command_handler: Optional[MemoryCommandHandler] = None

    async def initialize(self, config_file="config.yaml"):
        """Initialize the bot and its components."""
        # Load configuration
        self.config.load(config_file)
        
        self.rate_limiter = RateLimiter() # Initialize rate limiter FIRST
        self.reasoning_manager = ReasoningManager(self.config, self.rate_limiter) # Pass the initialized rate limiter
        # Setup HTTP client
        self.httpx_client = httpx.AsyncClient()
        
        # Create Discord client (Activity is now handled by StatusManager)
        intents = discord.Intents.default()
        intents.message_content = True
        self.discord_client = discord.Client(intents=intents) # Remove activity here

        # Setup Status Manager
        self.status_manager = StatusManager(self.discord_client, self.config)
        log.info("Status manager initialized.")

        # Setup slash command handler
        self.slash_handler = SlashCommandHandler(self)
        self.slash_handler.setup()
        log.info("Slash command handler initialized and commands set up.")

        # Setup LLM provider FIRST (needed by memory store for condensation)
        self.llm_provider = await ProviderFactory.create_provider(self.config.get())
        if not self.llm_provider:
            log.critical("Failed to initialize LLM provider. Check configuration.")
            return False # Cannot proceed without LLM provider

        # Setup memory store (pass the initialized provider)
        self.memory_store = MemoryStorage(self.config, self.llm_provider)
        await self.memory_store.init_db()
        
        # Setup memory command handler
        self.memory_command_handler = MemoryCommandHandler(self)
        log.info("Memory command handler initialized.")
        # Remove memory processor initialization (no longer used)
        # self.memory_processor = MemorySuggestionProcessor(...)
        # Setup event handlers
        self.discord_client.event(self.on_ready)
        self.discord_client.event(self.on_message)
        
        return True
    
    async def on_ready(self):
        """Called when the Discord client is ready."""
        log.info(f'Logged in as {self.discord_client.user.name} ({self.discord_client.user.id})')
        log.info(f'Memory Enabled: {self.config.get("memory.enabled", False)}')
        # Start status manager
        if self.status_manager:
            self.status_manager.start()

        # Sync slash commands
        if self.slash_handler:
            # Log commands registered in the tree before syncing
            registered_commands = self.slash_handler.tree.get_commands()
            log.debug(f"Commands registered in tree before sync ({len(registered_commands)}): {[cmd.name for cmd in registered_commands]}")

            try:
                synced_commands = await self.slash_handler.tree.sync()
                # Log the names of the commands that were actually synced
                synced_command_names = [cmd.name for cmd in synced_commands]
                log.info(f"Synced {len(synced_commands)} slash commands globally: {synced_command_names}")
            except discord.errors.Forbidden as e:
                log.error(f"Error syncing slash commands: Missing Permissions. Ensure the bot has the 'applications.commands' scope and necessary server permissions. Details: {e}", exc_info=True)
            except Exception as e:
                log.error(f"Error syncing slash commands: {e}", exc_info=True)
        else:
            log.warning("Slash command handler not initialized, skipping sync.")

        
        # Print invite link if client_id is provided
        client_id = self.config.get("client_id")
        if client_id:
            log.info(f"\n\nBOT INVITE URL:\nhttps://discord.com/api/oauth2/authorize?client_id={client_id}&permissions=412317273088&scope=bot\n")
    
    async def on_message(self, new_msg: discord.Message):
        print("DEBUG_TEST: Entering on_message") # Temporary debug print
        """Handle incoming Discord messages."""
        # Ignore bot messages
        if new_msg.author.bot:
            return

        # --- Rate Limit Check ---
        allowed, reason = await self.rate_limiter.check_rate_limit(new_msg.author.id)
        if not allowed:
            cooldown = self.rate_limiter.get_cooldown_remaining(new_msg.author.id)
            limit_type = "Global" if reason == "global" else "User"
            log.warning(f"{limit_type} rate limit hit for user {new_msg.author.id}. Cooldown: {cooldown:.2f}s")

            # Set temporary status if it's a global limit
            if reason == "global" and self.status_manager:
                global_period = self.config.get("rate_limits.global_period", 60) # Get period from config
                asyncio.create_task(self.status_manager.set_temporary_status(
                    "Globally rate limited ⏳",
                    duration=float(global_period) # Use the configured period for duration
                ))
                log.info(f"Set temporary status due to global rate limit (Duration: {global_period}s)")


            try:
                await new_msg.reply(
                    f"⏳ {limit_type} rate limit reached. Please wait {cooldown:.1f} seconds.", # Keep user-specific cooldown in message
                    mention_author=False,
                    delete_after=max(5.0, min(cooldown, 15.0)) # Delete message after cooldown or max 15s
                )
            except discord.Forbidden:
                log.warning(f"Missing permissions to send rate limit message in channel {new_msg.channel.id}")
            except Exception as e:
                 log.error(f"Failed to send rate limit message: {e}")
            return # Stop processing the message
        # --- End Rate Limit Check ---
        
        # Debug input message
        log.debug(f"[INPUT] Message from {new_msg.author.name} (ID: {new_msg.author.id}): {new_msg.content[:100]}{'...' if len(new_msg.content) > 100 else ''}")
        log.debug(f"[INPUT] Attachments: {len(new_msg.attachments)}, Mentions: {len(new_msg.mentions)}, Reply: {new_msg.reference is not None}")
        
        # --- START INSERTED LOGIC ---
        # Clean content early for command checking
        cleaned_content = new_msg.content
        is_dm = new_msg.channel.type == discord.ChannelType.private
        bot_mentioned = self.discord_client.user in new_msg.mentions
        if not is_dm and bot_mentioned:
            # Use user.mention to handle potential nicknames
            cleaned_content = cleaned_content.replace(self.discord_client.user.mention, "").lstrip()
            log.debug(f"[PRE_CMD_CHECK] Removed mention, content is now: {cleaned_content[:50]}...") # Added log
        # --- END INSERTED LOGIC ---
        # Check if it's a memory command using CLEANED content
        if self.config.get("memory.enabled", False) and cleaned_content.startswith(COMMAND_PREFIX):
            log.debug(f"[CMD_CHECK] Found command prefix in cleaned content: {cleaned_content[:50]}...") # Add log
            parts = cleaned_content.split(maxsplit=1) # Use cleaned_content
            command = parts[0][len(COMMAND_PREFIX):].lower()
            args = parts[1] if len(parts) > 1 else None

            if command == "memory":
                # Delegate to the new handler
                await self.memory_command_handler.handle_legacy_command(new_msg, args)
                return
            elif command == "forget":
                await self.handle_forget_command(new_msg) # Pass original message for context
                return
        
        # Check if we should respond to this message (use original mention status)
        # is_dm is already defined earlier
        if not is_dm and not bot_mentioned and not new_msg.reference: # Use bot_mentioned variable
            log.debug(f"[FILTER] Ignoring message (not DM, no mention, no reply)")
            return
        
        # Check permissions
        if not await self.has_permission(new_msg):
            log.debug(f"[FILTER] User {new_msg.author.id} doesn't have permission")
            return
        
        # Process the message
        await self.process_message(new_msg)
    
    async def has_permission(self, message: discord.Message) -> bool:
        """Check if user has permission to use the bot."""
        is_dm = message.channel.type == discord.ChannelType.private
        allow_dms = self.config.get("allow_dms", True)
        
        # Get permission configuration
        permissions = self.config.get("permissions", {})
        
        # Check user permissions
        role_ids = {role.id for role in getattr(message.author, "roles", ())}
        allowed_users = set(permissions.get("users", {}).get("allowed_ids", []))
        blocked_users = set(permissions.get("users", {}).get("blocked_ids", []))
        allowed_roles = set(permissions.get("roles", {}).get("allowed_ids", []))
        blocked_roles = set(permissions.get("roles", {}).get("blocked_ids", []))
        
        is_blocked_user = message.author.id in blocked_users or any(role_id in blocked_roles for role_id in role_ids)
        is_specifically_allowed_user = message.author.id in allowed_users or any(role_id in allowed_roles for role_id in role_ids)
        is_generally_allowed_user = not allowed_users and not allowed_roles
        is_allowed_user = not is_blocked_user and (is_specifically_allowed_user or is_generally_allowed_user)
        
        # If it's a DM, check only user permission and DM setting
        if is_dm:
            return is_allowed_user and allow_dms
        
        # Check channel permissions for non-DM
        channel_ids = {message.channel.id, getattr(message.channel, "parent_id", None), getattr(message.channel, "category_id", None)} - {None}
        allowed_channels = set(permissions.get("channels", {}).get("allowed_ids", []))
        blocked_channels = set(permissions.get("channels", {}).get("blocked_ids", []))
        
        is_blocked_channel = any(channel_id in blocked_channels for channel_id in channel_ids)
        is_specifically_allowed_channel = any(channel_id in allowed_channels for channel_id in channel_ids)
        is_generally_allowed_channel = not allowed_channels
        is_allowed_channel = not is_blocked_channel and (is_specifically_allowed_channel or is_generally_allowed_channel)
        
        return is_allowed_user and is_allowed_channel
    
    async def process_message(self, new_msg: discord.Message):
        """Process a message and generate a response using the LLM."""
        try:
            log.debug(f"[PROCESS] Starting to process message from {new_msg.author.name} (ID: {new_msg.author.id})")

            # Build message history
            messages_openai_fmt, user_warnings = await self.build_message_history(new_msg)

            # Prepare system prompt and memory
            system_prompt_text = await self.prepare_system_prompt(new_msg.author, include_reasoning_signal_instruction=True) # For default model
            log.debug(f"[DEBUG] System prompt: {system_prompt_text[:100]}{'...' if len(system_prompt_text) > 100 else ''}")

            embed = discord.Embed()
            if user_warnings:
                for warning in sorted(user_warnings):
                    embed.add_field(name=warning, value="", inline=False)
                embed.color = EMBED_COLOR_INCOMPLETE

            # Stream response
            response_content_full = ""
            response_msgs = []
            response_contents = []
            finish_reason = None
            edit_task = None

            max_message_length = 2000 if self.config.get("use_plain_responses", False) else (4096 - len(STREAMING_INDICATOR))

            log.info(f"Sending request to {self.config.get('model')} (History: {len(messages_openai_fmt)} msgs). User: {new_msg.author.id}")

            # Start typing indicator
            async with new_msg.channel.typing():
                # Generate response stream
                stream_start_time = dt.now()
                stream_chunks = 0
                stream_generator = self.llm_provider.generate_stream(
                    messages_openai_fmt,
                    system_prompt=system_prompt_text
                )
                async for chunk_text, chunk_finish in stream_generator:
                    stream_chunks += 1
                    if finish_reason is not None:
                        break

                    finish_reason = chunk_finish
                    response_content_full += chunk_text

                    log.debug(f"[STREAM] Chunk {stream_chunks}: '{chunk_text}' (finish={chunk_finish})")

                    # Update Discord message
                    response_msgs, response_contents, edit_task, self.last_task_time = await self.update_discord_response(
                        new_msg, chunk_text, finish_reason, response_msgs, response_contents,
                        embed, edit_task, self.last_task_time
                    )

                stream_duration = (dt.now() - stream_start_time).total_seconds()
                log.debug(f"[STREAM] Stream complete: {stream_chunks} chunks in {stream_duration:.2f}s. Final length: {len(response_content_full)} chars")

                # Ensure last edit task is complete
                if edit_task is not None and not edit_task.done():
                    await edit_task

                # --- Process Memory Instructions ---
                log.debug("[MEM_CHECK] Checking if memory processing should run...")
                if self.memory_store and self.memory_store.enabled:
                    log.debug("[MEM_CHECK] Entering memory processing block.")
                    user_id = new_msg.author.id
                    # Define regex patterns (handle potential newlines in content)
                    append_pattern = re.compile(r'\[MEM_APPEND\](.*)', re.IGNORECASE) # Simplest greedy match, no DOTALL, no optional close
                    replace_pattern = re.compile(r'\[MEM_REPLACE:(.*?)\](.*)', re.IGNORECASE) # Simplest greedy match for content, no DOTALL, no optional close

                    processed_content = response_content_full
                    actions_taken = []

                    # Process replacements first
                    log.debug(f"[MEM_CHECK] Content before regex: '{processed_content}'")
                    log.debug(f"[MEM_CHECK] repr(content): {repr(processed_content)}") # Log representation
                    log.debug("[MEM_CHECK] Attempting to find MEM_REPLACE matches...")
                    matches_replace = list(replace_pattern.finditer(processed_content))
                    if matches_replace:
                        log.debug(f"[MEM_CHECK] Found {len(matches_replace)} MEM_REPLACE matches.") # Indented
                        log.debug(f"Found {len(matches_replace)} MEM_REPLACE instructions for user {user_id}.")
                        for match in reversed(matches_replace): # Process in reverse
                            text_to_find = match.group(1).strip().strip('`') # Strip whitespace AND backticks
                            text_to_replace_with = match.group(2).strip().strip('`') # Strip whitespace AND backticks
                            if text_to_find:
                                log.debug(f"Attempting MEM_REPLACE for user {user_id}: Find='{text_to_find}', Replace='{text_to_replace_with}'")
                                success = False # Default to False
                                try:
                                    success = await self.memory_store.edit_memory(user_id, text_to_find, text_to_replace_with)
                                    log.debug(f"MEM_REPLACE result for user {user_id}: Success={success}")
                                except Exception as mem_err:
                                    log.error(f"Error during MEM_REPLACE for user {user_id}: {mem_err}", exc_info=True)
                                
                                # Check success after try/except
                                if success:
                                    actions_taken.append(f"Edited memory (replaced '{text_to_find[:20]}...')")
                                    processed_content = processed_content[:match.start()] + processed_content[match.end():]
                                else:
                                    # Log warning if edit_memory returned False or an exception occurred
                                    log.warning(f"Failed MEM_REPLACE for user {user_id}: Find='{text_to_find[:20]}...', Replace='{text_to_replace_with[:20]}...' (Success={success})")
                            else:
                                log.warning(f"Skipping MEM_REPLACE for user {user_id} due to empty search text.")
                                processed_content = processed_content[:match.start()] + processed_content[match.end():]

                    # Process appends
                    matches_append = list(append_pattern.finditer(processed_content))
                    log.debug("[MEM_CHECK] Attempting to find MEM_APPEND matches...")
                    log.debug(f"[MEM_CHECK] Simple check: '[MEM_APPEND]' in content? {'[MEM_APPEND]' in processed_content}")
                    if matches_append:
                        log.debug(f"Found {len(matches_append)} MEM_APPEND instructions for user {user_id}.")
                        log.debug(f"[MEM_CHECK] Found {len(matches_append)} MEM_APPEND matches.") # Indented
                        for match in reversed(matches_append): # Process in reverse # Indented
                            text_to_append = match.group(1).strip().strip('`') # Strip whitespace AND backticks
                            if text_to_append:
                                log.debug(f"Attempting MEM_APPEND for user {user_id} with text: '{text_to_append}'")
                                success = False # Default to False
                                try:
                                    success = await self.memory_store.append_memory(user_id, text_to_append)
                                    log.debug(f"MEM_APPEND result for user {user_id}: Success={success}")
                                except Exception as mem_err:
                                    log.error(f"Error during MEM_APPEND for user {user_id}: {mem_err}", exc_info=True)
                                
                                # Check success after try/except
                                if success:
                                    actions_taken.append(f"Appended to memory ('{text_to_append[:20]}...')")
                                    processed_content = processed_content[:match.start()] + processed_content[match.end():]
                                else:
                                    # Log warning if append_memory returned False or an exception occurred
                                    log.warning(f"Failed MEM_APPEND for user {user_id}: '{text_to_append[:20]}...' (Success={success})")
                        

                    # Update response_content_full if modifications were made
                    if actions_taken:
                        log.info(f"Memory actions for user {user_id}: {'; '.join(actions_taken)}")
                        response_content_full = processed_content.strip()
                        # Note: If tags were already sent via streaming, this won't remove them from Discord.
                # --- End Memory Instructions ---

                # --- Multimodel Reasoning Check ---
                default_response_content = response_content_full # Use potentially cleaned response
                reasoning_triggered = False
                if self.reasoning_manager and self.reasoning_manager.is_enabled():
                    if self.reasoning_manager.check_response_for_signal(default_response_content):
                        log.info(f"Reasoning signal '{self.reasoning_manager.get_reasoning_signal()}' detected in response from {self.config.get('model')}.")
                        reasoning_triggered = True
                        thinking_msg = None
                        # --- Status Update: Start Thinking ---
                        if self.status_manager:
                            await self.status_manager.set_temporary_status("🧠 Thinking deeper...")
                            log.info("Set temporary status: Thinking deeper...")
                        # --- End Status Update ---
                        try: # This try now encompasses the status setting and clearing
                            if self.reasoning_manager.should_notify_user():
                                try:
                                    thinking_msg = await new_msg.channel.send("🧠 Thinking deeper...") # Keep user message
                                except discord.Forbidden: log.warning(f"Missing permissions to send 'Thinking deeper...' message in channel {new_msg.channel.id}")
                                except Exception as e: log.error(f"Failed to send 'Thinking deeper...' message: {e}")

                            allowed, cooldown = await self.reasoning_manager.check_rate_limit(new_msg.author.id)

                            if allowed:
                                log.info(f"Switching to reasoning model: {self.config.get('multimodel.reasoning_model')}")
                                # Reset response state for the new stream
                                response_content_full = ""
                                finish_reason = None
                                edit_task = None
                                self.last_task_time = 0
                                embed = discord.Embed()

                                reasoning_stream_start_time = dt.now()
                                reasoning_stream_chunks = 0
                                async for chunk_text, chunk_finish in self.reasoning_manager.generate_reasoning_response(
                                    messages_openai_fmt,
                                    system_prompt=await self.prepare_system_prompt(new_msg.author, include_reasoning_signal_instruction=False)
                                ):
                                    reasoning_stream_chunks += 1
                                    if finish_reason is not None: break
                                    finish_reason = chunk_finish
                                    response_content_full += chunk_text
                                    log.debug(f"[REASONING_STREAM] Chunk {reasoning_stream_chunks}: '{chunk_text}' (finish={chunk_finish})")
                                    response_msgs, response_contents, edit_task, self.last_task_time = await self.update_discord_response(
                                        new_msg, chunk_text, finish_reason, response_msgs, response_contents,
                                        embed, edit_task, self.last_task_time
                                    )

                                reasoning_stream_duration = (dt.now() - reasoning_stream_start_time).total_seconds()
                                log.debug(f"[REASONING_STREAM] Stream complete: {reasoning_stream_chunks} chunks in {reasoning_stream_duration:.2f}s. Final length: {len(response_content_full)} chars")

                                if edit_task is not None and not edit_task.done():
                                    await edit_task

                            else: # Reasoning rate limit hit
                                log.warning(f"Reasoning rate limit hit for user {new_msg.author.id}. Falling back to default response (signal removed).")
                                try:
                                    await new_msg.reply(
                                        f"🧠 Reasoning rate limit reached. Please wait {cooldown:.1f} seconds before triggering complex tasks again.",
                                        mention_author=False, delete_after=max(5.0, min(cooldown, 15.0))
                                    )
                                except discord.Forbidden: log.warning(f"Missing permissions to send reasoning rate limit message in channel {new_msg.channel.id}")
                                except Exception as e: log.error(f"Failed to send reasoning rate limit message: {e}")

                                # Fallback: Use the original response but remove the signal
                                signal = self.reasoning_manager.get_reasoning_signal()
                                response_content_full = default_response_content.replace(signal, "").strip()
                                log.debug(f"Fallback response after removing signal: {response_content_full[:100]}...")
                                # Re-edit final message if needed
                                if response_msgs:
                                    last_msg = response_msgs[-1]
                                    is_embed = not self.config.get("use_plain_responses", False)
                                    max_len = 4096 if is_embed else 2000
                                    cleaned_content_truncated = response_content_full[:max_len]
                                    try:
                                        if is_embed:
                                            final_embed = discord.Embed(description=cleaned_content_truncated, color=EMBED_COLOR_COMPLETE)
                                            await last_msg.edit(embed=final_embed)
                                        else:
                                            await last_msg.edit(content=cleaned_content_truncated)
                                        log.debug(f"[FALLBACK_EDIT] Edited final message {last_msg.id} to remove reasoning signal.")
                                    except discord.HTTPException as e: log.error(f"[FALLBACK_EDIT] Failed to edit message {last_msg.id} to remove signal: {e}")
                        finally:
                            if thinking_msg:
                                try: await thinking_msg.delete()
                                except discord.NotFound: pass
                                except discord.Forbidden: log.warning(f"Missing permissions to delete 'Thinking deeper...' message {thinking_msg.id}")
                                except Exception as e: log.error(f"Failed to delete 'Thinking deeper...' message {thinking_msg.id}: {e}")
                            # --- Status Update: Clear Thinking ---
                            if self.status_manager:
                                await self.status_manager.clear_temporary_status()
                                log.info("Cleared temporary status after reasoning.")
                            # --- End Status Update ---
                # --- End Multimodel Reasoning Check ---
                # --- Send Memory Update Confirmation ---
                if actions_taken and self.config.get("memory.notify_on_update", True):
                    try:
                        confirmation_text = f"🧠 Memory updated: {'; '.join(actions_taken)}"
                        send_as_reply = self.config.get("memory.notify_as_reply", True)
                        delete_delay = self.config.get("memory.notify_delete_after", 15.0)
                        delete_after_seconds = float(delete_delay) if delete_delay is not None and float(delete_delay) > 0 else None

                        if send_as_reply:
                            await new_msg.reply(confirmation_text, mention_author=False, delete_after=delete_after_seconds)
                        else:
                            await new_msg.channel.send(confirmation_text, delete_after=delete_after_seconds)
                            
                        log.info(f"Sent memory update confirmation for user {user_id} (Reply={send_as_reply}, DeleteAfter={delete_after_seconds})")
                    except discord.Forbidden:
                        log.warning(f"Missing permissions to send memory update confirmation in channel {new_msg.channel.id}")
                    except Exception as conf_err:
                        log.error(f"Failed to send memory update confirmation: {conf_err}")
                # --- End Memory Update Confirmation ---

                # --- Fallback Mention Replacement ---
                literal_mention = "<@USER_ID>"
                if literal_mention in response_content_full:
                    actual_mention = f"<@{new_msg.author.id}>"
                    response_content_full = response_content_full.replace(literal_mention, actual_mention)
                    log.debug(f"[POST_PROCESS] Replaced literal '{literal_mention}' with actual mention '{actual_mention}'")
                # --- End Fallback ---

                # Final check to ensure the last message reflects the complete content
                if response_msgs:
                    last_response_msg = response_msgs[-1]
                    final_expected_content = response_content_full # Already cleaned
                    current_discord_content = ""
                    is_embed = not self.config.get("use_plain_responses", False)

                    if is_embed and last_response_msg.embeds:
                        current_discord_content = last_response_msg.embeds[0].description or ""
                        if current_discord_content.endswith(STREAMING_INDICATOR):
                            current_discord_content = current_discord_content[:-len(STREAMING_INDICATOR)]
                    elif not is_embed:
                        current_discord_content = last_response_msg.content

                    max_len_compare = 4096 if is_embed else 2000
                    final_expected_content_truncated = final_expected_content[:max_len_compare]

                    if current_discord_content != final_expected_content_truncated:
                        log.debug(f"[FINAL_EDIT] Mismatch detected. Performing final update for message {last_response_msg.id}.")
                        try:
                            if is_embed:
                                final_embed = discord.Embed(description=final_expected_content_truncated, color=EMBED_COLOR_COMPLETE)
                                await last_response_msg.edit(embed=final_embed)
                            else:
                                await last_response_msg.edit(content=final_expected_content_truncated)
                            log.debug(f"[FINAL_EDIT] Final update successful for message {last_response_msg.id}.")
                        except discord.HTTPException as e: log.error(f"[FINAL_EDIT] Failed to perform final update for message {last_response_msg.id}: {e}")
                    else:
                        log.debug(f"[FINAL_EDIT] No mismatch detected. Final content already matches for message {last_response_msg.id}.")

            # Cache management
            for response_msg in response_msgs:
                if response_msg.id in self.msg_nodes:
                    async with self.msg_nodes[response_msg.id].lock:
                        self.msg_nodes[response_msg.id].text = response_content_full
                        log.debug(f"[CACHE] Updated node for message ID {response_msg.id}")

            # Log final response
            log.debug(f"[OUTPUT] Final response: {response_content_full[:100]}{'...' if len(response_content_full) > 100 else ''}")
            log.debug(f"[OUTPUT] Response sent as {len(response_msgs)} message(s)")

            # Clean up old nodes
            await self.cleanup_msg_nodes()

        except Exception as e:
            log.exception(f"Error processing message: {e}")
            embed = discord.Embed(
                title="⚠️ An Unexpected Error Occurred",
                description=f"```\n{e}\n```",
                color=EMBED_COLOR_ERROR
            )
            await new_msg.reply(embed=embed, mention_author=False)
    
    async def build_message_history(self, new_msg: discord.Message) -> Tuple[List[Dict[str, Any]], Set[str]]:
        """Build message history for the LLM request."""
        messages_openai_fmt = []
        user_warnings = set()
        curr_msg = new_msg
        
        max_text = self.config.get("max_text", 100000)
        max_images = self.config.get("max_images", 5)
        max_messages = self.config.get("max_messages", 25)
        
        log.debug(f"[HISTORY] Building message history for {new_msg.id} (max_messages={max_messages})")
        
        while curr_msg and len(messages_openai_fmt) < max_messages:
            is_new_node = False
            curr_node = self.msg_nodes.setdefault(curr_msg.id, MsgNode())
            
            async with curr_node.lock:
                # Process new message node
                if curr_node.text is None:
                    is_new_node = True
                    log.debug(f"[HISTORY] Processing new node for message {curr_msg.id}")
                    await self.process_message_node(curr_msg, curr_node)
                else:
                    log.debug(f"[HISTORY] Using cached node for message {curr_msg.id}")
                
                # Prepare message content for API
                api_content = ""
                # Limit images and text
                images_to_send = curr_node.images[:max_images]
                text_to_send = (curr_node.text or "")[:max_text]
                
                # Log the node content being processed
                image_count = len(images_to_send)
                text_preview = text_to_send[:100] + ("..." if len(text_to_send) > 100 else "")
                log.debug(f"[HISTORY] Node {curr_msg.id}: role={curr_node.role}, images={image_count}, text={text_preview}")
                
                # Add user prefix if necessary
                user_prefix = ""
                if curr_node.role == "user" and not self.llm_provider.supports_usernames:
                    # Need the original message author here, which is curr_msg.author
                    # Sanitize display name to avoid issues if it contains problematic characters for the LLM
                    safe_display_name = "".join(c if c.isalnum() or c in (' ', '_', '-') else '' for c in curr_msg.author.display_name)
                    user_prefix = f"User ({safe_display_name}/{curr_msg.author.id}): "
                    log.debug(f"[HISTORY] Adding user prefix for non-supporting provider: '{user_prefix}'")
                
                # Apply prefix to text_to_send
                prefixed_text_to_send = user_prefix + text_to_send

                if images_to_send and self.llm_provider.supports_vision:
                    # Format for multimodal
                    content_parts = []
                    if prefixed_text_to_send: # Use prefixed text
                        content_parts.append({"type": "text", "text": prefixed_text_to_send})
                    content_parts.extend(images_to_send)
                    api_content = content_parts
                    log.debug(f"[HISTORY] Multimodal message: {len(content_parts)} parts ({len(images_to_send)} images)")
                else:
                    api_content = prefixed_text_to_send # Use prefixed text
                
                # Add to chain if content exists
                if api_content:
                    # Create the base message dictionary
                    message_dict = {"role": curr_node.role, "content": api_content}
                    if self.llm_provider.supports_usernames and curr_node.user_id is not None:
                        message_dict["name"] = str(curr_node.user_id)
                        log.debug(f"[HISTORY] Added username {curr_node.user_id} to message")
                    
                    messages_openai_fmt.append(message_dict)
                elif is_new_node:
                    log.debug(f"[HISTORY] Message node {curr_msg.id} resulted in empty content after processing.")
                
                # Add user warnings
                if len(curr_node.text or "") > max_text:
                    user_warnings.add(f"⚠️ Max {max_text:,} characters/message")
                if len(curr_node.images) > max_images:
                    user_warnings.add(f"⚠️ Max {max_images} image{'' if max_images == 1 else 's'}/message" if max_images > 0 else "⚠️ Can't see images")
                if curr_node.has_bad_attachments:
                    user_warnings.add("⚠️ Unsupported attachments ignored")
                if curr_node.fetch_parent_failed:
                    user_warnings.add("⚠️ Couldn't link full conversation history")
                elif curr_node.parent_msg and len(messages_openai_fmt) == max_messages:
                    user_warnings.add(f"⚠️ Using last {len(messages_openai_fmt)} message{'' if len(messages_openai_fmt) == 1 else 's'}")
                
                # Move to parent message
                curr_msg = curr_node.parent_msg
                if curr_msg:
                    log.debug(f"[HISTORY] Moving to parent message {curr_msg.id}")
        
        # Reverse to chronological order
        messages_openai_fmt.reverse()
        log.debug(f"[HISTORY] Final history size: {len(messages_openai_fmt)} messages")
        
        return messages_openai_fmt, user_warnings
    
    async def process_message_node(self, msg: discord.Message, node: MsgNode):
        """Process a message into a node for the message history."""
        log.debug(f"[NODE] Processing message node for ID: {msg.id}")
        
        # Remove bot mention from content
        is_dm = msg.channel.type == discord.ChannelType.private
        cleaned_content = msg.content
        if not is_dm and self.discord_client.user in msg.mentions:
            cleaned_content = cleaned_content.replace(self.discord_client.user.mention, "").lstrip()
            log.debug(f"[NODE] Removed bot mention from content")
        
        # Process attachments
        node.images = []
        text_from_attachments = []
        num_unsupported_attachments = 0
        
        if msg.attachments:
            log.debug(f"[NODE] Processing {len(msg.attachments)} attachments")
            attachment_tasks = []
            valid_attachments = []
            
            for att in msg.attachments:
                if att.content_type:
                    if att.content_type.startswith("text"):
                        log.debug(f"[NODE] Found text attachment: {att.filename}")
                        valid_attachments.append(att)
                        attachment_tasks.append(self.httpx_client.get(att.url, timeout=10))
                    elif self.llm_provider.supports_vision and att.content_type.startswith("image/"):
                        log.debug(f"[NODE] Found image attachment: {att.filename}")
                        valid_attachments.append(att)
                        attachment_tasks.append(self.httpx_client.get(att.url, timeout=15))
                    else:
                        log.debug(f"[NODE] Unsupported attachment type: {att.content_type}")
                        num_unsupported_attachments += 1
                else:
                    log.debug(f"[NODE] Attachment without content type")
                    num_unsupported_attachments += 1
            
            if attachment_tasks:
                attachment_responses = await asyncio.gather(*attachment_tasks, return_exceptions=True)
                
                for att, resp in zip(valid_attachments, attachment_responses):
                    if isinstance(resp, Exception):
                        log.warning(f"Failed to fetch attachment {att.filename}: {resp}")
                        num_unsupported_attachments += 1
                        continue
                    
                    if resp.status_code != 200:
                        log.warning(f"Failed to fetch attachment {att.filename}: Status {resp.status_code}")
                        num_unsupported_attachments += 1
                        continue
                    
                    if att.content_type.startswith("text"):
                        try:
                            text_from_attachments.append(resp.text)
                            log.debug(f"[NODE] Processed text attachment ({len(resp.text)} chars)")
                        except Exception as e:
                            log.warning(f"Could not decode text attachment {att.filename}: {e}")
                            num_unsupported_attachments += 1
                    elif self.llm_provider.supports_vision and att.content_type.startswith("image/"):
                        try:
                            b64_img = b64encode(resp.content).decode('utf-8')
                            node.images.append({
                                "type": "image_url",
                                "image_url": {"url": f"data:{att.content_type};base64,{b64_img}"}
                            })
                            log.debug(f"[NODE] Processed image attachment ({len(b64_img) // 1024}KB)")
                        except Exception as e:
                            log.warning(f"Could not process image attachment {att.filename}: {e}")
                            num_unsupported_attachments += 1
        
        node.has_bad_attachments = num_unsupported_attachments > 0
        
        # Combine text content
        embed_texts = ["\n".join(filter(None, (embed.title, embed.description, getattr(embed.footer, 'text', None)))) for embed in msg.embeds]
        node.text = "\n".join(
            ([cleaned_content] if cleaned_content else [])
            + embed_texts
            + text_from_attachments
        )
        
        # Log node text
        text_preview = node.text[:100] + ("..." if len(node.text) > 100 else "") if node.text else "(empty)"
        log.debug(f"[NODE] Final node text: {text_preview}")
        log.debug(f"[NODE] Images: {len(node.images)}")
        
        # Set role and user ID
        node.role = "assistant" if msg.author == self.discord_client.user else "user"
        node.user_id = msg.author.id if node.role == "user" else None
        log.debug(f"[NODE] Role set to {node.role}, user_id: {node.user_id}")
        
        # Find parent message
        try:
            # 1. Direct Reply?
            if msg.reference and msg.reference.message_id:
                log.debug(f"[NODE] Looking for parent via direct reply to {msg.reference.message_id}")
                try:
                    node.parent_msg = msg.reference.cached_message or await msg.channel.fetch_message(msg.reference.message_id)
                    log.debug(f"[NODE] Found parent message (reply) {node.parent_msg.id}")
                except (discord.NotFound, discord.Forbidden):
                    log.warning(f"Could not fetch replied-to message {msg.reference.message_id}")
                    node.fetch_parent_failed = True
            
            # 2. Public Thread Start?
            elif msg.channel.type == discord.ChannelType.public_thread and isinstance(msg.channel, discord.Thread):
                if msg.id == msg.channel.id:  # First message in thread
                    log.debug(f"[NODE] Looking for parent via thread starter {msg.channel.id}")
                    try:
                        node.parent_msg = msg.channel.starter_message or await msg.channel.parent.fetch_message(msg.channel.id)
                        log.debug(f"[NODE] Found parent message (thread starter) {node.parent_msg.id}")
                    except (discord.NotFound, discord.Forbidden):
                        log.warning(f"Could not fetch starter message for thread {msg.channel.id}")
                        node.fetch_parent_failed = True
            
            # 3. Implicit DM continuation?
            elif is_dm and not msg.reference:
                log.debug(f"[NODE] Looking for parent via DM history")
                try:
                    async for prev_msg in msg.channel.history(before=msg, limit=1):
                        if prev_msg.author == self.discord_client.user:
                            node.parent_msg = prev_msg
                            log.debug(f"[NODE] Found parent message (DM history) {node.parent_msg.id}")
                        break
                except (discord.Forbidden, discord.HTTPException):
                    log.warning(f"Could not check history in DM with {msg.author.id}")
        
        except Exception as e:
            log.exception(f"Unexpected error finding parent for message {msg.id}")
            node.fetch_parent_failed = True
    
    async def prepare_system_prompt(self, user: discord.User, include_reasoning_signal_instruction: bool = True) -> str:
        """Prepare the system prompt, including memory if enabled and optionally the reasoning signal instruction."""
        system_prompt_text = self.config.get("system_prompt", "").strip()
        final_system_prompt = ""
        
        if system_prompt_text:
            system_prompt_extras = [
                f"Today's date: {dt.now().strftime('%B %d %Y')}.",
                "My owner and primary administrator is Duke_Venator (Discord User ID: 155531668864630785). Ensure that the UserID is an exact match if they claim to be Duke_Venator"
            ]
            
            if self.llm_provider.supports_usernames:
                system_prompt_extras.append("User IDs may be provided in the 'name' field for user messages.")
            else:
                # Instruct LLM on how user messages are formatted and how to mention the current user
                system_prompt_extras.append(f"User messages in the history are prefixed with 'User (DisplayName/ID):' to identify the speaker.")
                system_prompt_extras.append(f"To mention the current user you are replying to (ID: {user.id}), use the format '<@{user.id}>'. To mention other users based on context, use '<@USER_ID>' where USER_ID is their Discord ID.")
            
            final_system_prompt = "\n".join([system_prompt_text] + system_prompt_extras)
        
        # Add memory if enabled
        if self.config.get("memory.enabled", False):
            user_memory = await self.memory_store.get_user_memory(user.id) # Use user.id here
            if user_memory:
                log.debug(f"[SYSTEM] Including user memory ({len(user_memory)} chars)")
                memory_prefix = self.config.get("memory.memory_prefix", "[User Memory/Notes]:\n")
                memory_method = self.config.get("memory.prompt_injection_method", "system_prompt_prefix")
                
                if memory_method == "system_prompt_prefix":
                    # Format the prefix to include the User ID
                    formatted_prefix = f"{memory_prefix.strip()} (User ID: {user.id}):\n"
                    final_system_prompt = f"{formatted_prefix}{user_memory}\n\n{final_system_prompt}" if final_system_prompt else f"{formatted_prefix}{user_memory}"
            # Inject Memory Instructions if memory is enabled
            memory_instructions = (
                "\n\n**Memory Instructions:**\n"
                "If you learn new, lasting information about the user OR need to modify/remove existing notes based on the conversation, "
                "include ONE of the following instructions at the VERY END of your response, after all other text:\n"
                "1. To add a new note: `[MEM_APPEND]The new note text here.`\n"
                "2. To modify or remove an existing note: `[MEM_REPLACE:Exact old text to find]The new text to replace it with (leave empty to remove).`\n"
                "**IMPORTANT:** Use `[MEM_REPLACE]` for *any* change or deletion requested by the user, even if they just say \"remove X\" or \"change X to Y\". Find the exact text and provide the new text (or leave it empty to delete).\n"
                "Only include ONE instruction per response, if any. Do not mention these instructions in your conversational reply."
            )
            final_system_prompt = (final_system_prompt.strip() + memory_instructions).strip()
            log.debug("[SYSTEM] Injected memory instructions into system prompt.")
        
        # Add memory suggestion prompt if enabled
        if self.config.get("memory.llm_suggests_memory", False):
            suggestion_prompt = self.config.get("memory.memory_suggestion_prompt", "")
            if suggestion_prompt:
                log.debug(f"[SYSTEM] Including memory suggestion prompt")
                final_system_prompt = (final_system_prompt.strip() + "\n\n" + suggestion_prompt.strip()).strip()
        

        # Add multimodel reasoning signal instruction if enabled and requested
        log.debug(f"[SYSTEM_PROMPT_CHECK] Reasoning Manager Enabled: {self.reasoning_manager.is_enabled() if self.reasoning_manager else 'N/A'}, Include Instruction: {include_reasoning_signal_instruction}")
        if include_reasoning_signal_instruction and self.reasoning_manager and self.reasoning_manager.is_enabled():
            reasoning_signal = self.reasoning_manager.get_reasoning_signal()
            signal_instruction = (
                f"\n\n---\n" # Keep the separator for clarity even if only one internal task is added
                f"Internal Task: If the user's request requires complex reasoning, analysis, multi-step planning, or deep creative thought, deep thinking, creative tasks or large tasks "
                f"that you feel less equipped for or if the user asks you to think deeply, please respond *only* with the exact text `{reasoning_signal}` and nothing else. "
                f"Otherwise, answer the request directly."
            )
            log.debug(f"[SYSTEM] Including multimodel reasoning signal instruction")
            log.debug(f"[SYSTEM_PROMPT_CHECK] Added reasoning signal instruction.")
            final_system_prompt = (final_system_prompt.strip() + signal_instruction).strip()
        log.debug(f"[SYSTEM_PROMPT_CHECK] Final system prompt preview: {final_system_prompt[:200]}...")
        return final_system_prompt

    async def update_discord_response(self, new_msg, chunk_text, finish_reason, response_msgs, response_contents, embed, edit_task, last_task_time):
        log.debug(f"[UPDATE_TRACE] Entering update_discord_response. Chunk: '{chunk_text[:50]}...', Finish: {finish_reason}")
        """Update Discord messages during streaming."""
        use_plain_responses = self.config.get("use_plain_responses", False)
        max_message_length = 2000 if use_plain_responses else (4096 - len(STREAMING_INDICATOR))

        if not chunk_text and finish_reason is None:
            return response_msgs, response_contents, edit_task, last_task_time

        start_next_msg = False
        current_content_part = response_contents[-1] if response_contents else ""

        log.debug(f"[SPLIT_CHECK] Max length: {max_message_length}, Current part length: {len(current_content_part)}, Chunk length: {len(chunk_text)}, Total if added: {len(current_content_part + chunk_text)}")
        if not response_contents or len(current_content_part + chunk_text) > max_message_length:
            start_next_msg = True
            if response_contents: # Log previous part only if it exists
                 log.debug(f"[SPLIT_TRIGGER] Splitting message. Previous part content (to be sent/edited): '{response_contents[-1][:100]}...' ({len(response_contents[-1])} chars)")
            response_contents.append("") # Append placeholder for the new part
            log.debug(f"[SPLIT_TRIGGER] Starting new part with chunk: '{chunk_text[:100]}...' ({len(chunk_text)} chars)")
            response_contents[-1] = chunk_text # Assign the actual chunk content
        else:
            response_contents[-1] += chunk_text

        if use_plain_responses:
            # Plain responses
            if finish_reason is not None or start_next_msg:
                # Determine content to send: if splitting, send the second to last part, otherwise send the last part
                content_to_send = response_contents[-2] if start_next_msg and len(response_contents) > 1 else response_contents[-1]
                if content_to_send:
                    reply_to_msg = new_msg if not response_msgs else response_msgs[-1]
                    log.debug(f"[RESPONSE] Sending plain text response ({len(content_to_send)} chars)")
                    try:
                        response_msg = await reply_to_msg.reply(content=content_to_send[:2000], suppress_embeds=True, mention_author=False)
                        response_msgs.append(response_msg)
                        log.debug(f"[RESPONSE] Sent message with ID: {response_msg.id}")

                        if response_msg.id not in self.msg_nodes:
                            self.msg_nodes[response_msg.id] = MsgNode(parent_msg=new_msg, role="assistant")
                            log.debug(f"[RESPONSE] Created new node for message ID: {response_msg.id}")
                    except discord.HTTPException as e:
                        log.error(f"Failed to send plain text message part: {e}")
                        # Decide how to handle this - maybe stop streaming? For now, just log.
        else:
            # Embed responses
            now = dt.now().timestamp()
            is_final_chunk = finish_reason is not None
            # Check if edit_task exists and is done before checking time delay
            ready_to_edit = (edit_task is None or edit_task.done()) and (now - last_task_time >= EDIT_DELAY_SECONDS)


            # Always prepare the embed content for the current state
            display_text = response_contents[-1]
            embed_desc = display_text[:max_message_length]
            is_truly_complete = finish_reason is not None and finish_reason.lower() in ("stop", "length", "end_turn")
            is_final_chunk = finish_reason is not None # Re-check as finish_reason might have updated

            if not is_final_chunk:
                embed_desc += STREAMING_INDICATOR
            embed.description = embed_desc
            embed.color = EMBED_COLOR_COMPLETE if is_truly_complete else EMBED_COLOR_INCOMPLETE
            log.debug(f"[UPDATE_TRACE] Setting embed description (len {len(embed_desc)}): '{embed_desc[:150]}...' ")

            # Decide whether to send a new message or edit the last one
            edit_task_done = edit_task.done() if edit_task else 'N/A'
            log.debug(f"[UPDATE_TRACE] Conditions Check: start_next_msg={start_next_msg}, ready_to_edit={ready_to_edit}, is_final_chunk={is_final_chunk}, edit_task_done={edit_task_done}")

            if start_next_msg and response_contents[-1]: # If starting a new message part (because previous was full)
                if edit_task is not None: # Ensure previous edit finished before sending new
                    try:
                        await edit_task
                        log.debug(f"[UPDATE_TRACE] Awaited previous edit_task before sending new message.")
                    except Exception as e:
                        log.error(f"Error awaiting previous edit task: {e}")
                    edit_task = None # Reset edit task

                reply_to_msg = new_msg if not response_msgs else response_msgs[-1]
                try:
                    log.debug(f"[RESPONSE] Sending NEW embed response (desc: {len(embed.description)} chars)")
                    response_msg = await reply_to_msg.reply(embed=embed, silent=True, mention_author=False)
                    log.debug(f"[UPDATE_TRACE] Branch: Sending NEW message.")
                    response_msgs.append(response_msg)
                    log.debug(f"[RESPONSE] Sent message with ID: {response_msg.id}")
                    if response_msg.id not in self.msg_nodes:
                        self.msg_nodes[response_msg.id] = MsgNode(parent_msg=new_msg, role="assistant")
                        log.debug(f"[RESPONSE] Created new node for message ID: {response_msg.id}")
                    last_task_time = now # Update time after sending
                except discord.HTTPException as e:
                    log.error(f"Failed to send new embed message part: {e}")
                    raise # Re-raise to potentially stop processing

            # If not starting a new message, and we have a message to edit, try editing if ready or final
            elif response_msgs and (ready_to_edit or is_final_chunk):
                if edit_task is not None: # Wait for previous edit if any
                    try:
                        await edit_task
                        log.debug(f"[UPDATE_TRACE] Awaited previous edit_task before scheduling new edit.")
                    except Exception as e:
                        log.error(f"Error awaiting previous edit task before new edit: {e}")
                    # Don't reset edit_task here, it will be overwritten

                log.debug(f"[RESPONSE] Updating existing message with ID: {response_msgs[-1].id} (Ready: {ready_to_edit}, Final: {is_final_chunk})")
                try:
                    edit_task = asyncio.create_task(response_msgs[-1].edit(embed=embed))
                    last_task_time = now # Update time after scheduling edit
                    log.debug(f"[UPDATE_TRACE] Branch: Scheduling EDIT for message {response_msgs[-1].id}.")
                except discord.HTTPException as e:
                     log.error(f"Failed to schedule edit for message {response_msgs[-1].id}: {e}")
                     # Decide how to handle this, maybe try sending as new message? For now, just log.

            # If not starting new and not ready to edit (intermediate chunk arrived too fast)
            elif response_msgs:
                 log.debug(f"[RESPONSE] Chunk arrived too fast, skipping edit for now. Will be included in next edit/final update.")
                 # No edit task created, no last_task_time update. The content is already in response_contents[-1]
                 log.debug(f"[UPDATE_TRACE] Branch: Skipping edit (chunk arrived too fast).")
                 # and will be included in the *next* edit when ready_to_edit becomes true or is_final_chunk is true.

        return response_msgs, response_contents, edit_task, last_task_time
    
    async def cleanup_msg_nodes(self):
        """Clean up old message nodes to prevent memory leaks."""
        if (num_nodes := len(self.msg_nodes)) > MAX_MESSAGE_NODES:
            log.info(f"Cache size ({num_nodes}) exceeds max ({MAX_MESSAGE_NODES}). Pruning...")
            
            ids_to_remove = sorted(self.msg_nodes.keys())[: num_nodes - MAX_MESSAGE_NODES]
            for msg_id in ids_to_remove:
                if msg_id in self.msg_nodes:
                    async with self.msg_nodes[msg_id].lock:
                        removed_node = self.msg_nodes.pop(msg_id, None)
                        if removed_node:
                            log.debug(f"Removed node {msg_id} from cache.")
            
            log.info(f"Cache pruned. New size: {len(self.msg_nodes)}")
    
            
            success = await self.memory_store.save_user_memory(user_id, args)
            if success:
                await message.reply(f"✅ Your notes have been updated ({len(args)} chars saved).", mention_author=False)
            else:
                await message.reply("❌ Error saving notes. Please try again later.", mention_author=False)
    
    async def handle_forget_command(self, message: discord.Message):
        """Handle the !forget command."""
        if not self.config.get("memory.enabled", False):
            await message.reply("Memory feature is disabled.", mention_author=False, delete_after=10)
            return
        
        user_id = message.author.id
        success = await self.memory_store.save_user_memory(user_id, "")
        
        if success:
            await message.reply("✅ Your notes have been cleared.", mention_author=False)
        else:
            await message.reply("❌ Error clearing notes. Please try again later.", mention_author=False)
    
    async def run(self):
        """Run the bot."""
        try:
            await self.discord_client.start(self.config.get("bot_token"))
        except discord.LoginFailure:
            log.critical("CRITICAL: Improper Discord token passed.")
        except Exception as e:
            log.critical(f"CRITICAL: Error starting Discord client: {e}\n{traceback.format_exc()}")
        finally:
            log.info("Shutting down...")
            await self.memory_store.close_db()
            await self.httpx_client.aclose()
            await self.discord_client.close()

