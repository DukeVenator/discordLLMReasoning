import asyncio
import logging

from .bot import LLMCordBot

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

async def main():
    """Main entry point for the application."""
    bot = LLMCordBot()
    success = await bot.initialize()
    
    if success:
        await bot.run()
    else:
        log.critical("Failed to initialize bot. Exiting.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Shutdown requested by user.")