/**
 * Contrato compartido entre Main, Preload y Renderer.
 * Solo tipos y constantes puras (sin dependencias de Node ni del DOM en runtime).
 */

export const IPC = {
  selectFiles: 'dialog:select-files',
  selectFolder: 'dialog:select-folder',
  probe: 'video:probe',
  compress: 'video:compress',
  cancel: 'video:cancel',
  progress: 'video:progress',
  systemInfo: 'system:info',
  showItem: 'shell:show-item'
} as const

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi'] as const

export type Engine = 'nvenc' | 'x264'
export type CompressionLevel = 'high' | 'balanced' | 'max'
export type OutputMode = 'same' | 'custom'

/** Valor CRF (x264) / CQ (NVENC) por nivel y motor. */
export const LEVEL_QUALITY: Record<Engine, Record<CompressionLevel, number>> = {
  nvenc: {
    high: 20,
    balanced: 24,
    max: 28
  },
  x264: {
    high: 20,
    balanced: 23,
    max: 28
  }
}

export interface CompressionSettings {
  engine: Engine
  level: CompressionLevel
  outputMode: OutputMode
  outputDir: string | null
  /** Reescala a 1080p (lado corto) si el origen es mayor, igual que el export 1080p de Clipchamp. */
  limitTo1080p: boolean
}

export interface VideoInfo {
  path: string
  name: string
  size: number
  duration: number
  width: number
  height: number
  codec: string
}

export type ProbeResult =
  | { ok: true; info: VideoInfo }
  | { ok: false; path: string; name: string; size: number; error: string }

export interface CompressRequest {
  jobId: string
  inputPath: string
  settings: CompressionSettings
}

export type CompressResult =
  | { ok: true; outputPath: string; inputSize: number; outputSize: number }
  | { ok: false; cancelled: boolean; error: string }

export interface ProgressPayload {
  jobId: string
  percent: number
  fps: number | null
  etaSeconds: number | null
}

export interface SystemInfo {
  ffmpegPath: string
  ffmpegVersion: string
  nvencAvailable: boolean
  /** true si el binario soporta los presets modernos p1..p7 (FFmpeg >= 4.3). */
  nvencModernPresets: boolean
}

/** API expuesta en `window.api` mediante contextBridge. */
export interface ClipDietAPI {
  selectFiles(): Promise<string[]>
  selectFolder(): Promise<string | null>
  probeFiles(paths: string[]): Promise<ProbeResult[]>
  compress(request: CompressRequest): Promise<CompressResult>
  cancel(): Promise<boolean>
  getSystemInfo(): Promise<SystemInfo>
  showInFolder(path: string): Promise<void>
  getPathForFile(file: File): string
  onProgress(callback: (payload: ProgressPayload) => void): () => void
}
