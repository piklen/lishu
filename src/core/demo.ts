// 内置示例预览:不读取真实书签,不调用 LLM,不写入 Chrome 书签
import type { Progress } from '../types';

export function buildDemoProgress(): Progress {
  return {
    status: 'preview',
    total: 18,
    processed: 18,
    categories: [
      { name: '工程开发', description: '编程、构建、测试和系统设计资料' },
      { name: 'AI Provider', description: '大模型 provider、API 和本地模型服务' },
      { name: '产品设计', description: '产品、隐私和用户体验资料' },
      { name: '金融学习', description: '财报、估值和投资学习资料' },
      { name: '阅读参考', description: '长期阅读、知识库和参考资料' },
      { name: '工具效率', description: '日常工具、检查清单和发布辅助' },
    ],
    classifications: [
      { bookmarkId: 'demo-1', category: '工程开发', confidence: 0.95 },
      { bookmarkId: 'demo-2', category: '工程开发', confidence: 0.92 },
      { bookmarkId: 'demo-3', category: '工程开发', confidence: 0.88 },
      { bookmarkId: 'demo-4', category: 'AI Provider', confidence: 0.96 },
      { bookmarkId: 'demo-5', category: 'AI Provider', confidence: 0.91 },
      { bookmarkId: 'demo-6', category: 'AI Provider', confidence: 0.84 },
      { bookmarkId: 'demo-7', category: '产品设计', confidence: 0.86 },
      { bookmarkId: 'demo-8', category: '产品设计', confidence: 0.62 },
      { bookmarkId: 'demo-9', category: '金融学习', confidence: 0.93 },
      { bookmarkId: 'demo-10', category: '金融学习', confidence: 0.89 },
      { bookmarkId: 'demo-11', category: '阅读参考', confidence: 0.82 },
      { bookmarkId: 'demo-12', category: '阅读参考', confidence: 0.77 },
      { bookmarkId: 'demo-13', category: '工具效率', confidence: 0.9 },
      { bookmarkId: 'demo-14', category: '工具效率', confidence: 0.87 },
      { bookmarkId: 'demo-15', category: '工具效率', confidence: 0.64 },
      { bookmarkId: 'demo-16', category: '工具效率', confidence: 0.59 },
      { bookmarkId: 'demo-17', category: '工具效率', confidence: 0.72 },
    ],
  };
}
