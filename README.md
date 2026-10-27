# ClipDiet 🎬⚡

Compresor de video por lotes para Windows de alto rendimiento, desarrollado con **Electron**, **React**, **TypeScript**, **Tailwind CSS** y **FFmpeg**, diseñado para replicar la compresión visualmente sin pérdidas de **Microsoft Clipchamp** al exportar a 1080p (reduciendo videos de ~1 GB a ~200–300 MB).

---

## Características Principales

- **Aceleración por GPU (NVIDIA NVENC):** Codificación por hardware ultra rápida (`h264_nvenc`) con rate-control `vbr`, preset moderno `p4`, audio AAC a 128 kbps y calidad constante adaptativa (`-cq 24` con `-b:v 0`).
- **Respaldo por CPU (x264):** Compatible con cualquier CPU usando `libx264` con `-crf 23 -preset fast` para PCs sin GPU dedicada.
- **Detección Automática de Hardware:** Prueba activa en el arranque para verificar si la GPU y drivers soportan NVENC en tiempo real.
- **Estilo Clipchamp 1080p:** Filtro inteligente de escalado con interpolación Lanczos (`scale=...:flags=lanczos`) que detecta la orientación del video y ajusta resoluciones 4K/1440p a 1080p sin distorsión.
- **Cola por Lotes (Batch Queue):** Procesa archivos de video de manera independiente y secuencial (uno a uno) para no saturar memoria de video (VRAM) ni CPU.
- **Progreso en Tiempo Real:** Cálculo preciso de porcentaje (%) basado en la duración de `ffprobe`, FPS actuales y tiempo restante estimado (ETA).
- **Comparativa de Peso Real:** Lectura de bytes con `fs.statSync` mostrando el porcentaje exacto de espacio ahorrado.
- **Diseño Dark Mode Premium:** Interfaz oscura minimalista con Tailwind CSS, micro-animaciones (shimmer en barras de progreso), arrastre nativo en barra de título y soporte integral para Drag & Drop.
- **Binarios Empaquetados:** Incluye binarios de FFmpeg y FFprobe configurados para producción mediante `asarUnpack` (`app.asar.unpacked`).

---

## Estructura del Proyecto

```text
ClipDiet/
├── electron.vite.config.ts    # Configuración de electron-vite (main, preload, renderer)
├── package.json               # Dependencias fijadas y scripts de build
├── tailwind.config.js         # Tema dark, animaciones personalizadas
├── tsconfig.json              # Referencias TypeScript
├── tsconfig.node.json         # Tipado para Node / Electron Main y Preload
├── tsconfig.web.json          # Tipado para React / Renderer
└── src/
    ├── shared/
    │   └── types.ts           # Contrato IPC tipado, constantes y modelos compartidos
    ├── main/
    │   └── main.ts            # Proceso principal: IPC handlers, FFmpeg pipeline, detección NVENC
    ├── preload/
    │   └── preload.ts         # contextBridge seguro con webUtils.getPathForFile
    └── renderer/
        ├── index.html         # HTML con CSP estricto
        └── src/
            ├── main.tsx       # Entry point de React 18
            ├── App.tsx        # Orquestador del estado de cola y procesamiento secuencial
            ├── index.css      # Estilos base, scrollbar custom y utilidades
            ├── types.ts       # Definición de Job en memoria
            ├── lib/
            │   └── format.ts  # Formateadores (MB/GB, duraciones, ETA)
            └── components/
                ├── TitleBar.tsx      # Barra de ventana personalizada con estado de GPU
                ├── DropZone.tsx      # Zona Drag & Drop interactiva (expandible/compacta)
                ├── QueueList.tsx     # Contenedor de la cola de compresión
                ├── QueueItem.tsx     # Fila de video con progreso animado y estadísticas
                ├── SettingsPanel.tsx # Selector de motor (NVENC/x264), nivel y destino
                ├── ActionPanel.tsx   # Controles Iniciar / Cancelar / Limpiar y resumen de MB
                └── Toast.tsx         # Notificaciones flotantes
```

---

## Scripts Disponibles

```bash
# Iniciar en modo desarrollo con recarga en caliente (Hot Reload)
npm run dev

# Validar tipos TypeScript de Node y React
npm run typecheck

# Compilar bundles de producción
npm run build

# Generar instalador de Windows (.exe para x64 con NSIS)
npm run dist
```

---

## Parámetros de Compresión

### 1. NVIDIA NVENC (Por defecto)
```bash
-c:v h264_nvenc -rc vbr -cq 24 -b:v 0 -preset p4 -profile:v high -c:a aac -b:a 128k -movflags +faststart
```
- Calidad Alta: `-cq 20`
- Balanceado (Clipchamp): `-cq 24`
- Máxima reducción: `-cq 28`

### 2. CPU (x264)
```bash
-c:v libx264 -crf 23 -preset fast -profile:v high -c:a aac -b:a 128k -movflags +faststart
```
- Calidad Alta: `-crf 20`
- Balanceado (Clipchamp): `-crf 23`
- Máxima reducción: `-crf 28`
