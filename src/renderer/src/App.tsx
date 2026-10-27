import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { CompressionSettings, ProbeResult, SystemInfo } from '@shared/types'
import type { Job } from '@/types'
import { createId, isVideoFile } from '@/lib/format'
import { getApi, isElectron } from '@/lib/browserApi'
import { TitleBar } from '@/components/TitleBar'
import { DropZone } from '@/components/DropZone'
import { QueueList } from '@/components/QueueList'
import { SettingsPanel } from '@/components/SettingsPanel'
import { ActionPanel } from '@/components/ActionPanel'
import { Toast } from '@/components/Toast'

const SETTINGS_KEY = 'clipdiet.settings.v1'

const DEFAULT_SETTINGS: CompressionSettings = {
  engine: 'nvenc',
  level: 'balanced',
  outputMode: 'same',
  outputDir: null,
  limitTo1080p: true
}

function loadSettings(): CompressionSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<CompressionSettings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function jobFromProbe(result: ProbeResult): Job {
  const base = { id: createId(), progress: 0, fps: null, etaSeconds: null }
  if (result.ok) {
    return { ...base, ...result.info, status: 'pending' }
  }
  return {
    ...base,
    path: result.path,
    name: result.name,
    size: result.size,
    duration: 0,
    width: 0,
    height: 0,
    codec: '',
    status: 'error',
    error: `No se pudo analizar el archivo: ${result.error}`
  }
}

export default function App(): JSX.Element {
  // Instancia segura de API: nativa en Electron o simulador en navegador
  const api = useMemo(() => getApi(), [])

  /* ── Cola ──────────────────────────────────────────────────────────────────
   * jobsRef es la fuente de verdad síncrona (el bucle de procesamiento la lee
   * entre `await`s); el estado de React solo se usa para renderizar. */
  const [jobs, setJobsState] = useState<Job[]>([])
  const jobsRef = useRef<Job[]>([])
  const setJobs = useCallback((updater: (prev: Job[]) => Job[]) => {
    jobsRef.current = updater(jobsRef.current)
    setJobsState(jobsRef.current)
  }, [])
  const patchJob = useCallback(
    (id: string, patch: Partial<Job>) => setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j))),
    [setJobs]
  )

  /* ── Configuración y sistema ─────────────────────────────────────────────── */
  const [settings, setSettings] = useState<CompressionSettings>(loadSettings)
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const updateSettings = useCallback((patch: Partial<CompressionSettings>) => setSettings((s) => ({ ...s, ...patch })), [])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    api.getSystemInfo().then((info) => {
      setSystem(info)
      if (!info.nvencAvailable) setSettings((s) => (s.engine === 'nvenc' ? { ...s, engine: 'x264' } : s))
    })
  }, [api])

  /* ── UI ──────────────────────────────────────────────────────────────────── */
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const dragDepth = useRef(0)
  const cancelRequested = useRef(false)
  const toastTimer = useRef<number>()

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }, [])

  // Progreso en tiempo real emitido por el proceso principal
  useEffect(
    () =>
      api.onProgress(({ jobId, percent, fps, etaSeconds }) => {
        patchJob(jobId, { progress: percent, fps, etaSeconds })
      }),
    [api, patchJob]
  )

  /* ── Añadir archivos ─────────────────────────────────────────────────────── */
  const addPaths = useCallback(
    async (paths: string[]) => {
      const known = new Set(jobsRef.current.map((j) => j.path.toLowerCase()))
      const videos = [...new Set(paths)].filter(isVideoFile)
      const fresh = videos.filter((p) => !known.has(p.toLowerCase()))

      const unsupported = paths.length - videos.length
      const duplicates = videos.length - fresh.length
      if (unsupported > 0) notify(`${unsupported} archivo(s) ignorado(s): formato no soportado`)
      else if (duplicates > 0) notify(`${duplicates} archivo(s) ya estaban en la cola`)
      if (fresh.length === 0) return

      setAnalyzing(true)
      try {
        const results = await api.probeFiles(fresh)
        setJobs((prev) => [...prev, ...results.map(jobFromProbe)])
      } finally {
        setAnalyzing(false)
      }
    },
    [api, notify, setJobs]
  )

  const browseFiles = useCallback(async () => {
    const paths = await api.selectFiles()
    if (paths.length) await addPaths(paths)
  }, [api, addPaths])

  /* ── Drag & drop a nivel de ventana ──────────────────────────────────────── */
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

  const onDragEnter = (e: DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setIsDragging(true)
  }
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: DragEvent): void => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => api.getPathForFile(file))
      .filter(Boolean)
    if (paths.length) void addPaths(paths)
  }

  /* ── Procesamiento secuencial ────────────────────────────────────────────── */
  const pickFolder = useCallback(async (): Promise<string | null> => {
    const dir = await api.selectFolder()
    if (dir) updateSettings({ outputDir: dir, outputMode: 'custom' })
    return dir
  }, [api, updateSettings])

  const startQueue = useCallback(async () => {
    if (running) return

    let effective = settings
    if (settings.outputMode === 'custom' && !settings.outputDir) {
      const dir = await pickFolder()
      if (!dir) return notify('Elige una carpeta de destino para continuar')
      effective = { ...settings, outputDir: dir }
    }

    cancelRequested.current = false
    setRunning(true)
    let completed = 0

    try {
      // Uno por uno para no saturar la GPU/CPU.
      while (!cancelRequested.current) {
        const next = jobsRef.current.find((j) => j.status === 'pending')
        if (!next) break

        patchJob(next.id, { status: 'compressing', progress: 0, fps: null, etaSeconds: null, error: undefined })
        const result = await api.compress({ jobId: next.id, inputPath: next.path, settings: effective })

        if (result.ok) {
          completed += 1
          patchJob(next.id, {
            status: 'done',
            progress: 100,
            size: result.inputSize,
            outputSize: result.outputSize,
            outputPath: result.outputPath,
            etaSeconds: 0
          })
        } else if (result.cancelled) {
          patchJob(next.id, { status: 'cancelled', etaSeconds: null, fps: null })
        } else {
          patchJob(next.id, { status: 'error', error: result.error, etaSeconds: null, fps: null })
        }
      }
    } finally {
      setRunning(false)
      setStopping(false)
    }

    if (cancelRequested.current) {
      notify('Proceso cancelado. Los videos restantes siguen en espera.')
    } else if (completed > 0 && typeof Notification !== 'undefined' && document.hidden) {
      new Notification('ClipDiet', { body: `${completed} video(s) comprimido(s) correctamente.` })
    }
  }, [running, settings, pickFolder, notify, patchJob, api])

  const cancelCurrent = useCallback(async () => {
    cancelRequested.current = true
    setStopping(true)
    await api.cancel()
  }, [api])

  /* ── Acciones de la lista ────────────────────────────────────────────────── */
  const removeJob = useCallback((id: string) => setJobs((prev) => prev.filter((j) => j.id !== id || j.status === 'compressing')), [setJobs])
  const retryJob = useCallback(
    (id: string) => patchJob(id, { status: 'pending', progress: 0, error: undefined, outputPath: undefined, outputSize: undefined }),
    [patchJob]
  )
  const clearCompleted = useCallback(() => setJobs((prev) => prev.filter((j) => j.status !== 'done')), [setJobs])
  const reveal = useCallback((p: string) => void api.showInFolder(p), [api])

  return (
    <div
      className="app-bg flex h-full flex-col text-zinc-200"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TitleBar system={system} />

      {!isElectron && (
        <aside aria-label="Aviso de vista previa" className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Vista previa web:</strong> Estás visualizando la interfaz en el navegador. Para comprimir con <strong>FFmpeg</strong> y tu GPU <strong>RTX</strong>, usa la ventana de <strong>Electron</strong> que abre <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-amber-100">npm run dev</code>.
            </span>
          </div>
          <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            Modo Simulación
          </span>
        </aside>
      )}

      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-1">
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <DropZone compact={jobs.length > 0} isDragging={isDragging} busy={analyzing} onBrowse={browseFiles} />
          {jobs.length > 0 && (
            <QueueList jobs={jobs} onRemove={removeJob} onRetry={retryJob} onReveal={reveal} onClearCompleted={clearCompleted} />
          )}
        </main>

        <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto">
          <SettingsPanel
            settings={settings}
            system={system}
            disabled={running}
            onChange={updateSettings}
            onPickFolder={() => void pickFolder()}
          />
          <ActionPanel
            jobs={jobs}
            running={running}
            stopping={stopping}
            onStart={() => void startQueue()}
            onCancel={() => void cancelCurrent()}
            onClearCompleted={clearCompleted}
          />
        </aside>
      </div>

      <Toast message={toast} />
    </div>
  )
}
