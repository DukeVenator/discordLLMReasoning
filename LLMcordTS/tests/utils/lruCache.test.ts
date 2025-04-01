import { describe, it, expect } from 'vitest';
import { LRUCache } from '../../src/utils/lruCache'; // Import from our utility file

describe('LRUCache Utility', () => {
  it('should set and get values', () => {
    const cache = new LRUCache<string, number>({ max: 5 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('should return undefined for non-existent keys', () => {
    const cache = new LRUCache<string, number>({ max: 5 });
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should evict least recently used item when max size is reached', () => {
    const cache = new LRUCache<string, number>({ max: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.size).toBe(3);

    // Access 'a' to make it most recently used
    cache.get('a');

    // Add 'd', which should evict 'b' (least recently used)
    cache.set('d', 4);
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined(); // 'b' should be evicted
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('should handle different types of keys and values', () => {
    const cache = new LRUCache<number, { data: string }>({ max: 2 });
    const obj1 = { data: 'value1' };
    const obj2 = { data: 'value2' };
    const obj3 = { data: 'value3' };

    cache.set(1, obj1);
    cache.set(2, obj2);
    expect(cache.get(1)).toBe(obj1);
    expect(cache.get(2)).toBe(obj2);

    cache.set(3, obj3); // Evicts key 1
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBe(obj2);
    expect(cache.get(3)).toBe(obj3);
    expect(cache.size).toBe(2);
  });
});