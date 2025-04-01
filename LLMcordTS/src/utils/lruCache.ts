/**
 * Re-exports the LRUCache class from the 'lru-cache' library.
 * This provides a central point for accessing the LRU cache implementation
 * throughout the LLMcordTS project.
 *
 * Example Usage:
 * import { LRUCache } from './lruCache';
 *
 * // Create a cache that holds up to 100 items
 * const cache = new LRUCache<string, any>({ max: 100 });
 *
 * cache.set('myKey', { data: 'someValue' });
 * const value = cache.get('myKey');
 */

import { LRUCache } from 'lru-cache';

export { LRUCache };