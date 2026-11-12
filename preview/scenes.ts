export const SCENES = [
  { id: 'decisions', label: '正常 · Decisions', description: '配置、保存、统计和合成测试均成功。' },
  { id: 'session', label: '正常 · 跟随会话', description: '会话引擎使用相同配置界面，冒烟测试按真实业务规则禁用。' },
  {
    id: 'slow',
    label: '慢响应 · 加载与保存中',
    description: '加载、保存和测试延迟 2 秒，统计延迟 1 秒，可在等待时编辑或切换场景。',
  },
  { id: 'load-error', label: '配置加载失败', description: '配置接口返回 HTTP 503；恢复接口后重新加载。' },
  { id: 'save-error', label: '保存失败', description: '保存返回 HTTP 503；恢复接口后可保留草稿重试。' },
  {
    id: 'invalid',
    label: '无效配置 · 修复',
    description: '跟随会话下保留损坏的 Decisions 地址和模型，真实校验要求修复后才能保存。',
  },
  {
    id: 'multiline',
    label: '多行规则',
    description: '包含空行、缩进、中文与英文的规则；保存和重新加载后内容应逐字保留。',
  },
  { id: 'test-error', label: '测试接口失败', description: '测试请求返回 HTTP 503，可恢复接口后重试。' },
  { id: 'test-mixed', label: '测试结果含失败', description: '合成结果包括放行、拒绝和单个场景失败。' },
  { id: 'stats-error', label: '统计接口失败', description: '统计请求返回 HTTP 503；恢复后下次轮询显示统计。' },
  { id: 'stats-empty', label: '暂无统计', description: '评审次数为零，真实统计组件保持隐藏。' },
] as const

export type SceneId = (typeof SCENES)[number]['id']
export type PreviewLanguage = 'zh' | 'en'
export type PreviewTheme = 'light' | 'dark'
export type PreviewWidth = 'wide' | 'narrow'

export function isSceneId(value: unknown): value is SceneId {
  return SCENES.some((scene) => scene.id === value)
}

export interface PreviewSession {
  id: string
  scene: SceneId
}
