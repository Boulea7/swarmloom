/**
 * Engine zone: planner, scheduler, agents, swarm behaviours and the Player implementation.
 * `createPlayer` (../player.ts) binds {@link assemblePlayer} to the theme, stage, sound, toolbar,
 * i18n and choreography zones (stand-ins until the stage and choreo zones land); tests and tools
 * can pass fakes to `assemblePlayer` or construct {@link Engine} directly.
 */

export type { PlayerZones } from "./assemble";
export { assemblePlayer } from "./assemble";

export type { EngineDeps, EngineSettings } from "./engine";
export { Engine } from "./engine";
export type { RoleKey } from "./labels";
export { AGENT_NAMES, createLabeler, roleFor } from "./labels";
export type { FinaleMode, FollowMode } from "./options";
export { autoAgentCount, DEFAULT_SEED, resolveAgentCount } from "./options";
export type { Plan } from "./planner";
export { buildPlan } from "./planner";
export { Schedule } from "./schedule";
export { SpatialHash } from "./spatial-hash";
export { streamRng } from "./streams";
