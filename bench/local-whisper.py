#!/usr/bin/env python3
# Local transcription with faster-whisper for the benchmark when there is no GROQ_API_KEY (bench/local-speech.mjs).
# Usage: local-whisper.py <audio> [model]  ->  JSON { text, segments:[{start,end,text}] } on stdout.
# Audio is decoded with ffmpeg to 16 kHz float32 PCM and passed as an array, so it does not depend on PyAV.
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
