// v3: v2 plus an explicit priority in the three areas that attracted too much (Idea, Retroalimentación, Pregunta).
import { fileURLToPath } from 'node:url';
export default { areasFile: fileURLToPath(new URL('./v3.areas.json', import.meta.url)) };
