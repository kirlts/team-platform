// Marcas de tiempo `mm:ss` (informe 06 §8, `timestampFormat`). Los minutos no tienen tope:
// una hora y cinco minutos se escribe 65:00.

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
