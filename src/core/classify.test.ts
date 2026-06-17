import { describe, expect, it } from 'vitest';
import { chunk, sample } from './classify';

describe('sample', () => {
  it('短数组直接返回副本', () => {
    const source = [1, 2, 3];
    const result = sample(source, 5);

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });

  it('长数组做均匀采样', () => {
    expect(sample([0, 1, 2, 3, 4, 5], 3)).toEqual([0, 2, 4]);
  });
});

describe('chunk', () => {
  it('按指定大小切批', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('非法批大小兜底为 1,避免死循环', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});
