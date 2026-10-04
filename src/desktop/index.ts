export type { Credential } from "./client.js";
export {
  desktopCall,
  readCredential,
  serviceURL,
  writeCredential,
} from "./client.js";
export type { Observation, Participant, Scope } from "./protocol.js";
export {
  Action,
  methodArguments,
  methodSchema,
  Request,
  scopes,
  Target,
  VERSION,
} from "./protocol.js";
export { openSSHTunnel } from "./remote.js";
export { Config, registryPath, startDesktop } from "./server.js";
