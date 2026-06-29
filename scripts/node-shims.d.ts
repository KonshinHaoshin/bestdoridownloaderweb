declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  cwd(): string;
};

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function stat(path: string): Promise<{ isFile(): boolean; size: number }>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}
