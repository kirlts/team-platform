// `mm:ss` timestamps (report 06 §8, `timestampFormat`). Minutes have no cap:
// one hour and five minutes is written 65:00.

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
