export interface GameVersion {
  id: string;
  name?: string;
  kind: string;
  released?: string;
  installed: boolean;
  official?: boolean;
  isolated?: boolean;
  hasInstanceData?: boolean;
}

export interface JavaRuntime {
  path: string;
  major?: number;
  version: string;
  managed: boolean;
}

export type MemoryMode = 'auto' | 'manual';

export interface InstanceLaunchOptions {
  javaPath: string;
  memory: number;
  memoryMode: MemoryMode;
  optimize: boolean;
  jvmArgs: string;
  gameArgs: string;
}

export interface InstanceSettings extends InstanceLaunchOptions {
  overrideJava: boolean;
  overrideMemory: boolean;
  overrideArgs: boolean;
}

export interface LocalMod {
  name: string;
  enabled: boolean;
  displayName?: string | null;
  description?: string | null;
  modId?: string | null;
  version?: string | null;
  icon?: string | null;
  website?: string | null;
}
