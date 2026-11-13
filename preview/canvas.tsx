import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

const MINIMUM = { width: 520, height: 600 }
const DESKTOP = { width: 1280, height: 820 }
type Size = typeof MINIMUM
type Drag = { pointerId: number; x: number; y: number; size: Size; scale: number }

function clampDimension(axis: keyof Size, value: number) {
  return Math.max(MINIMUM[axis], Math.round(value))
}

export function PreviewCanvas({ children }: { children: ReactNode }) {
  const [size, setSize] = useState(DESKTOP)
  const [zoom, setZoom] = useState('fit')
  const [space, setSpace] = useState<Size | null>(null)
  const [dragScale, setDragScale] = useState<number | null>(null)
  const workspace = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const fit = space ? Math.min(1, space.width / size.width, space.height / size.height) : 1
  const scale = dragScale ?? (zoom === 'fit' ? fit || 1 : Number(zoom))

  useEffect(() => {
    const element = workspace.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSpace({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current || !frame.current) return
    event.preventDefault()
    const measuredScale = frame.current.getBoundingClientRect().width / size.width
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, size, scale: measuredScale }
    setDragScale(scale)
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current
    if (!origin || origin.pointerId !== event.pointerId) return
    setSize({
      width: clampDimension('width', origin.size.width + (event.clientX - origin.x) / origin.scale),
      height: clampDimension('height', origin.size.height + (event.clientY - origin.y) / origin.scale),
    })
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragScale(null)
  }

  return (
    <main className="preview-workbench">
      <div className="preview-canvas-tools">
        <span className="preview-canvas-title">画布</span>
        <DimensionInput
          label="宽度"
          axis="width"
          value={size.width}
          onCommit={(width) => setSize((current) => ({ ...current, width }))}
        />
        <span aria-hidden="true">×</span>
        <DimensionInput
          label="高度"
          axis="height"
          value={size.height}
          onCommit={(height) => setSize((current) => ({ ...current, height }))}
        />
        <span aria-hidden="true">px</span>
        <div className="preview-canvas-presets">
          <button onClick={() => setSize(DESKTOP)} title="1280 × 820 px">
            桌面尺寸
          </button>
          <button onClick={() => setSize(MINIMUM)} title="520 × 600 px">
            最小窗口
          </button>
        </div>
        <label className="preview-zoom">
          缩放
          <select value={zoom} onChange={(event) => setZoom(event.target.value)}>
            <option value="fit">适应空间</option>
            <option value="1">100%</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
          </select>
        </label>
        <output className="preview-scale" aria-label="实际显示比例" aria-live="off">
          {Math.round(scale * 100)}%
        </output>
      </div>
      <div className="preview-workspace" ref={workspace}>
        <div className="preview-stage" role="region" tabIndex={0} aria-label="宿主窗口画布">
          <div className="preview-window" ref={frame} style={{ width: size.width, height: size.height, zoom: scale }}>
            {children}
            <div
              className="preview-resize"
              aria-hidden="true"
              title="拖动以调整窗口大小，也可输入宽度和高度"
              onPointerDown={startResize}
              onPointerMove={resize}
              onPointerUp={finishResize}
              onPointerCancel={finishResize}
              onLostPointerCapture={finishResize}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

function DimensionInput({
  label,
  axis,
  value,
  onCommit,
}: {
  label: string
  axis: keyof Size
  value: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="preview-dimension"
      aria-label={label}
      type="number"
      min={MINIMUM[axis]}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (Number.isFinite(event.target.valueAsNumber)) onCommit(clampDimension(axis, event.target.valueAsNumber))
        setDraft(null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(null)
      }}
    />
  )
}
