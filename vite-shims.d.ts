declare const __dirname: string;

declare module 'node:fs' {
  export function createReadStream(path: string): {
    pipe(destination: unknown): void;
  };
}

declare module 'node:fs/promises' {
  export function stat(path: string): Promise<{
    isFile(): boolean;
    size: number;
  }>;
}

declare module 'node:path' {
  export function extname(path: string): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}
