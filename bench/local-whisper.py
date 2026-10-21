#!/usr/bin/env python3
# Transcripción local con faster-whisper para el banco cuando no hay GROQ_API_KEY (bench/local-speech.mjs).
# Uso: local-whisper.py <audio> [modelo]  →  JSON { text, segments:[{start,end,text}] } en la salida estándar.
# El audio se decodifica con ffmpeg a PCM float32 de 16 kHz y se pasa como arreglo, así no depende de PyAV.
import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

path = sys.argv[1]
model_name = sys.argv[2] if len(sys.argv) > 2 else "medium"
raw = subprocess.run(
    ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ar", "16000", "-ac", "1", "-f", "f32le", "-"],
    capture_output=True,
    check=True,
).stdout
audio = np.frombuffer(raw, dtype=np.float32)
model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=12)
segments, _ = model.transcribe(audio, language="es", vad_filter=True, beam_size=5)
out = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
print(json.dumps({"text": " ".join(s["text"] for s in out), "segments": out}, ensure_ascii=False))
