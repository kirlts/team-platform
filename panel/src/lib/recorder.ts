// Grabación de audio con MediaRecorder. Se prueban los tipos en orden y se lee el tipo
// real que eligió el navegador (Safari anterior a 18.4 sólo graba MP4); ese tipo es el
// que viaja con el archivo. getUserMedia sólo existe en contextos seguros (HTTPS o localhost).

export const AUDIO_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const

export function pickAudioType(
  isSupported: (type: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
): string | undefined {
  return AUDIO_CANDIDATES.find((t) => isSupported(t))
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function extensionFor(mime: string): string {
  const base = mime.split(';')[0].trim()
  if (base === 'audio/mp4') return 'm4a'
  if (base === 'audio/ogg') return 'ogg'
  if (base === 'audio/wav') return 'wav'
  return 'webm'
}

export interface Recording {
  stop(): Promise<File>
  cancel(): void
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const wanted = pickAudioType()
  const recorder = wanted ? new MediaRecorder(stream, { mimeType: wanted }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const release = () => stream.getTracks().forEach((t) => t.stop())
  recorder.start()
  return {
    stop() {
      return new Promise<File>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          const mime = recorder.mimeType || wanted || 'audio/webm'
          const stamp = new Date()
          const hh = String(stamp.getHours()).padStart(2, '0')
          const mm = String(stamp.getMinutes()).padStart(2, '0')
          resolve(new File(chunks, `grabacion-${hh}${mm}.${extensionFor(mime)}`, { type: mime }))
        }
        recorder.onerror = () => {
          release()
          reject(new Error('No se pudo grabar'))
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else recorder.onstop?.(new Event('stop'))
      })
    },
    cancel() {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
