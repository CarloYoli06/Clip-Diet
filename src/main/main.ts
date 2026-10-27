import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import ffmpeg from 'fluent-ffmpeg'
import type { FfmpegCommand, FfprobeData } from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import {
  IPC,
  LEVEL_QUALITY,
  VIDEO_EXTENSIONS,
  type CompressRequest,
  type CompressResult,
  type CompressionSettings,
  type ProbeResult,
  type ProgressPayload,
  type SystemInfo,
  type VideoInfo
} from '../shared/types'

/* ════════════════════════════════════════════════════════════════════════════
 * 1. Binarios de FFmpeg / FFprobe
 *    En producción los binarios están dentro de app.asar, pero un .exe no puede
 *    ejecutarse desde un asar: electron-builder los deja en app.asar.unpacked
 *    (ver "asarUnpack" en package.json), así que reescribimos la ruta.
 *
 *    Binario de FFmpeg: se prioriza `ffmpeg-static` (FFmpeg 6.x). El build que
 *    trae `@ffmpeg-installer/ffmpeg` es de 2018: no conoce los presets p1..p7 y
 *    su NVENC falla con drivers NVIDIA actuales ("unsupported param (12)").
 *    Se mantiene como respaldo por si ffmpeg-static no estuviera disponible.
 * ══════════════════════════════════════════════════════════════════════════ */
const toUnpacked = (p: string): string => p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')

function resolveFfmpegBinary(): string {
  const candidates = [ffmpegStatic, ffmpegInstaller.path]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map(toUnpacked)
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

const FFMPEG_PATH = resolveFfmpegBinary()
const FFPROBE_PATH = toUnpacked(ffprobeInstaller.path)

ffmpeg.setFfmpegPath(FFMPEG_PATH)
ffmpeg.setFfprobePath(FFPROBE_PATH)

/* ════════════════════════════════════════════════════════════════════════════
 * 2. Detección de capacidades (NVENC, versión, presets)
 * ══════════════════════════════════════════════════════════════════════════ */
interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
}

function runFfmpeg(args: string[], timeout = 20_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(FFMPEG_PATH, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) })
    )
  })
}

let systemInfoPromise: Promise<SystemInfo> | null = null

function getSystemInfo(): Promise<SystemInfo> {
  if (!systemInfoPromise) {
    systemInfoPromise = (async () => {
      const [version, encoderHelp, nvencTest] = await Promise.all([
        runFfmpeg(['-hide_banner', '-version']),
        runFfmpeg(['-hide_banner', '-h', 'encoder=h264_nvenc']),
        // Codifica 0.2 s de negro con NVENC: confirma GPU + driver + soporte real.
        runFfmpeg([
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=0.2',
          '-c:v', 'h264_nvenc', '-f', 'null', '-'
        ])
      ])

      const versionMatch = /ffmpeg version (\S+)/.exec(version.stdout)
      return {
        ffmpegPath: FFMPEG_PATH,
        ffmpegVersion: versionMatch?.[1] ?? 'desconocida',
        nvencAvailable: nvencTest.ok,
        // FFmpeg < 4.3 no conoce p1..p7; en ese caso usamos el preset legacy equivalente.
        nvencModernPresets: /\bp4\b/.test(encoderHelp.stdout + encoderHelp.stderr)
      }
    })()
  }
  return systemInfoPromise
}

/* ════════════════════════════════════════════════════════════════════════════
 * 3. Utilidades de FFmpeg
 * ══════════════════════════════════════════════════════════════════════════ */
function ffprobeAsync(filePath: string): Promise<FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

async function probeVideo(filePath: string): Promise<VideoInfo> {
  const { size } = fs.statSync(filePath)
  const data = await ffprobeAsync(filePath)
  const video = data.streams.find((s) => s.codec_type === 'video')
  if (!video) throw new Error('El archivo no contiene una pista de video.')

  const duration = Number(data.format.duration ?? video.duration ?? 0)
  return {
    path: filePath,
    name: path.basename(filePath),
    size,
    duration: Number.isFinite(duration) ? duration : 0,
    width: video.width ?? 0,
    height: video.height ?? 0,
    codec: video.codec_name ?? 'desconocido'
  }
}

/** "00:01:23.45" → 83.45 */
function timemarkToSeconds(timemark: string | undefined): number {
  if (!timemark || timemark.startsWith('-')) return 0
  const parts = timemark.split(':').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

/** Genera una ruta de salida única: `nombre_compressed.mp4`, `nombre_compressed (1).mp4`, ... */
function resolveOutputPath(inputPath: string, settings: CompressionSettings): string {
  const { dir, name } = path.parse(inputPath)
  const targetDir = settings.outputMode === 'custom' && settings.outputDir ? settings.outputDir : dir
  fs.mkdirSync(targetDir, { recursive: true })

  let candidate = path.join(targetDir, `${name}_compressed.mp4`)
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(targetDir, `${name}_compressed (${i}).mp4`)
  }
  return candidate
}

/**
 * Escalado a 1080p respetando orientación:
 *  - Horizontal → alto máx. 1080 (1920x1080)
 *  - Vertical   → ancho máx. 1080 (1080x1920)
 * `-2` mantiene la relación de aspecto con dimensiones pares (requisito de H.264 4:2:0).
 */
const SCALE_TO_1080P =
  "scale=w='if(gte(iw,ih),-2,min(1080,iw))':h='if(gte(iw,ih),min(1080,ih),-2)':flags=lanczos"

function buildOutputOptions(settings: CompressionSettings, info: VideoInfo, system: SystemInfo): string[] {
  const quality = String(LEVEL_QUALITY[settings.engine][settings.level])

  const videoCodec =
    settings.engine === 'nvenc'
      ? [
          '-c:v', 'h264_nvenc',
          '-rc', 'vbr',
          '-cq', quality,
          // Sin -b:v 0 NVENC aplica su bitrate por defecto (2 Mbps) como objetivo y el CQ deja de mandar.
          '-b:v', '0',
          '-preset', system.nvencModernPresets ? 'p4' : 'medium',
          '-profile:v', 'high'
        ]
      : ['-c:v', 'libx264', '-crf', quality, '-preset', 'fast', '-profile:v', 'high']

  const needsScale = settings.limitTo1080p && Math.min(info.width, info.height) > 1080
  const filters = needsScale ? ['-vf', SCALE_TO_1080P] : []

  return [
    '-map', '0:v:0',
    '-map', '0:a:0?', // el "?" evita fallar en videos sin audio
    ...videoCodec,
    ...filters,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '1024'
  ]
}

const NVENC_ERROR_PATTERN =
  /Cannot load nvcuda|No NVENC capable devices|No capable devices found|OpenEncodeSessionEx failed|Driver does not support the required nvenc API|InitializeEncoder failed|nvenc.*out of memory/i

function friendlyError(err: Error, stderr: string, settings: CompressionSettings): string {
  if (settings.engine === 'nvenc' && NVENC_ERROR_PATTERN.test(stderr)) {
    return 'NVENC no está disponible (GPU/driver NVIDIA no compatible u ocupada). Prueba con el motor CPU (x264).'
  }
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('frame=') && !l.startsWith('size='))
  return lines.slice(-2).join(' · ') || err.message
}

/** Borra un archivo parcial; en Windows puede seguir bloqueado unos ms tras matar ffmpeg. */
function safeUnlink(filePath: string, attempts = 6): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    if (attempts > 0) setTimeout(() => safeUnlink(filePath, attempts - 1), 300)
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * 4. Estado del proceso de compresión actual (uno a la vez)
 * ══════════════════════════════════════════════════════════════════════════ */
interface ActiveJob {
  jobId: string
  command: FfmpegCommand
  outputPath: string
  cancelled: boolean
}

let activeJob: ActiveJob | null = null

function sendProgress(sender: WebContents, payload: ProgressPayload): void {
  if (!sender.isDestroyed()) sender.send(IPC.progress, payload)
}

async function compressVideo(event: IpcMainInvokeEvent, request: CompressRequest): Promise<CompressResult> {
  if (activeJob) return { ok: false, cancelled: false, error: 'Ya hay una compresión en curso.' }

  const { jobId, inputPath, settings } = request
  const sender = event.sender
  const win = BrowserWindow.fromWebContents(sender)
  const blockerId = powerSaveBlocker.start('prevent-app-suspension')

  try {
    if (!fs.existsSync(inputPath)) throw new Error('El archivo original ya no existe.')

    const [info, system] = await Promise.all([probeVideo(inputPath), getSystemInfo()])
    const outputPath = resolveOutputPath(inputPath, settings)
    const outputOptions = buildOutputOptions(settings, info, system)
    const startedAt = Date.now()

    return await new Promise<CompressResult>((resolve) => {
      const command = ffmpeg(inputPath).outputOptions(outputOptions).output(outputPath)
      const job: ActiveJob = { jobId, command, outputPath, cancelled: false }
      activeJob = job

      command
        .on('start', (cmdLine: string) => console.log(`[ffmpeg] ${cmdLine}`))
        .on('progress', (p: { timemark?: string; currentFps?: number; percent?: number }) => {
          // Calculamos el % nosotros con la duración de ffprobe: el `percent` de
          // fluent-ffmpeg no es fiable con algunos contenedores (mkv/avi).
          const seconds = timemarkToSeconds(p.timemark)
          const raw = info.duration > 0 ? (seconds / info.duration) * 100 : (p.percent ?? 0)
          const percent = Math.max(0, Math.min(99.9, raw))
          const elapsed = (Date.now() - startedAt) / 1000
          const etaSeconds = percent > 0.5 ? (elapsed * (100 - percent)) / percent : null

          sendProgress(sender, { jobId, percent, fps: p.currentFps ?? null, etaSeconds })
          win?.setProgressBar(percent / 100)
        })
        .on('end', () => {
          const outputSize = fs.statSync(outputPath).size
          const inputSize = fs.statSync(inputPath).size
          sendProgress(sender, { jobId, percent: 100, fps: null, etaSeconds: 0 })
          resolve({ ok: true, outputPath, inputSize, outputSize })
        })
        .on('error', (err: Error, _stdout: string | null, stderr: string | null) => {
          safeUnlink(outputPath)
          if (job.cancelled) {
            resolve({ ok: false, cancelled: true, error: 'Cancelado por el usuario.' })
          } else {
            console.error('[ffmpeg] error:', err.message, '\n', stderr)
            resolve({ ok: false, cancelled: false, error: friendlyError(err, stderr ?? '', settings) })
          }
        })

      command.run()
    })
  } catch (err) {
    return { ok: false, cancelled: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    activeJob = null
    powerSaveBlocker.stop(blockerId)
    if (win && !win.isDestroyed()) win.setProgressBar(-1)
  }
}

function cancelActiveJob(): boolean {
  if (!activeJob) return false
  activeJob.cancelled = true
  activeJob.command.kill('SIGKILL')
  return true
}

/* ════════════════════════════════════════════════════════════════════════════
 * 5. Canales IPC
 * ══════════════════════════════════════════════════════════════════════════ */
function registerIpcHandlers(): void {
  ipcMain.handle(IPC.selectFiles, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Selecciona videos para comprimir',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: [...VIDEO_EXTENSIONS] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.selectFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Carpeta de destino',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.probe, async (_event, paths: string[]): Promise<ProbeResult[]> => {
    const results: ProbeResult[] = []
    for (const p of paths) {
      try {
        results.push({ ok: true, info: await probeVideo(p) })
      } catch (err) {
        let size = 0
        try {
          size = fs.statSync(p).size
        } catch {
          /* archivo inaccesible */
        }
        results.push({
          ok: false,
          path: p,
          name: path.basename(p),
          size,
          error: err instanceof Error ? err.message.split('\n')[0] : 'No se pudo leer el video.'
        })
      }
    }
    return results
  })

  ipcMain.handle(IPC.compress, compressVideo)
  ipcMain.handle(IPC.cancel, () => cancelActiveJob())
  ipcMain.handle(IPC.systemInfo, () => getSystemInfo())
  ipcMain.handle(IPC.showItem, (_event, filePath: string) => shell.showItemInFolder(filePath))
}

/* ════════════════════════════════════════════════════════════════════════════
 * 6. Ventana y ciclo de vida
 * ══════════════════════════════════════════════════════════════════════════ */
let mainWindow: BrowserWindow | null = null

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, '../preload/preload.js'),
    path.join(__dirname, '../preload/preload.mjs'),
    path.join(__dirname, '../preload/index.js'),
    path.join(__dirname, '../preload/index.mjs')
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath()

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'ClipDiet',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#09090b', symbolColor: '#a1a1aa', height: 40 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  // Evita que soltar un archivo fuera de la zona de drop navegue hacia él.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => (mainWindow = null))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.clipdiet.app')
    registerIpcHandlers()
    void getSystemInfo() // pre-calienta la detección de NVENC
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    if (activeJob) {
      const { outputPath } = activeJob
      cancelActiveJob()
      safeUnlink(outputPath)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
