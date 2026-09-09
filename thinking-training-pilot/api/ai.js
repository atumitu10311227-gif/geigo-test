import { createHandler } from '../server/engine.mjs';
const handle = createHandler();
export default { fetch: handle };
