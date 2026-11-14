// The few Node APIs the plugin uses, so typecheck needs no @types/node dependency.
declare module "node:fs/promises" {
  export function realpath(path: string): Promise<string>;
  export function lstat(path: string): Promise<{ isFile(): boolean; nlink: number }>;
  export function stat(path: string): Promise<{ size: number }>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  export function rename(from: string, to: string): Promise<void>;
  export function appendFile(path: string, data: string, options: { mode: number }): Promise<void>;
}
declare module "node:os" {
  export function homedir(): string;
}
