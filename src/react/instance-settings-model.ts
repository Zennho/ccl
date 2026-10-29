import type { InstanceLaunchOptions, InstanceSettings, MemoryMode } from './types';

// Old releases saved a complete snapshot without override flags. Such records
// continue to override all three groups after migration.
export function normalizeInstanceSettings(input: unknown): InstanceSettings | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const overrideJava = value.overrideJava !== false;
  const overrideMemory = value.overrideMemory !== false;
  const overrideArgs = value.overrideArgs !== false;
  const javaValid = typeof value.javaPath === 'string' && value.javaPath.trim().length > 0;
  const memoryValid = Number.isInteger(value.memory) && (value.memory as number) >= 512 && (value.memory as number) <= 32768;
  const modeValid = value.memoryMode === 'auto' || value.memoryMode === 'manual';
  const argsValid = typeof value.optimize === 'boolean' && typeof value.jvmArgs === 'string' && value.jvmArgs.length <= 16384 && typeof value.gameArgs === 'string' && value.gameArgs.length <= 16384;
  if ((overrideJava && !javaValid) || (overrideMemory && (!memoryValid || !modeValid)) || (overrideArgs && !argsValid)) return null;
  return {
    overrideJava, overrideMemory, overrideArgs,
    javaPath: javaValid ? value.javaPath as string : 'java',
    memory: memoryValid ? value.memory as number : 4096,
    memoryMode: modeValid ? value.memoryMode as MemoryMode : 'auto',
    optimize: typeof value.optimize === 'boolean' ? value.optimize : true,
    jvmArgs: typeof value.jvmArgs === 'string' && value.jvmArgs.length <= 16384 ? value.jvmArgs : '',
    gameArgs: typeof value.gameArgs === 'string' && value.gameArgs.length <= 16384 ? value.gameArgs : '',
  };
}

export function resolveInstanceSettings(global: InstanceLaunchOptions, instance: InstanceSettings | null): InstanceLaunchOptions {
  return {
    javaPath: instance?.overrideJava ? instance.javaPath : global.javaPath,
    memory: instance?.overrideMemory ? instance.memory : global.memory,
    memoryMode: instance?.overrideMemory ? instance.memoryMode : global.memoryMode,
    optimize: instance?.overrideArgs ? instance.optimize : global.optimize,
    jvmArgs: instance?.overrideArgs ? instance.jvmArgs : global.jvmArgs,
    gameArgs: instance?.overrideArgs ? instance.gameArgs : global.gameArgs,
  };
}
