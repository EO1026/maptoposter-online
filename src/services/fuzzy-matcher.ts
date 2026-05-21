import Fuse from "fuse.js";
import { pinyin } from "pinyin-pro";

interface IndexedItem {
  name: string;
  pinyin: string;
  original: unknown;
}

/**
 * 创建一个带拼音索引的 Fuse 实例
 */
export function createFuse<T extends { name: string }>(items: T[]): Fuse<IndexedItem> {
  const indexed: IndexedItem[] = items.map((item) => {
    const py = pinyin(item.name, {
      toneType: "none",
      separator: "",
    });
    return { name: item.name, pinyin: py, original: item };
  });

  return new Fuse(indexed, {
    keys: [
      { name: "name", weight: 1 },
      { name: "pinyin", weight: 0.6 },
    ],
    threshold: 0.35,
    includeScore: true,
  });
}

/**
 * 模糊搜索单项最佳匹配
 * @param fuse Fuse 实例
 * @param query 搜索词
 * @param threshold 容错度上限，0=精确 1=全匹配，超过此分数视为不匹配
 * @returns 找到的最佳匹配项，或 null
 */
export function fuzzySearchOne<T>(
  fuse: Fuse<IndexedItem>,
  query: string,
  threshold: number = 0.35
): T | null {
  const trimmed = query?.trim();
  if (!trimmed) return null;

  const results = fuse.search(trimmed);

  // 取第一个结果（分数最低的）
  for (const result of results) {
    if (result.score !== undefined && result.score <= threshold) {
      return result.item.original as T;
    }
  }

  return null;
}
