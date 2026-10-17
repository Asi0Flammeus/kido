export interface Config {
  port: number;
  databasePath: string;
  adminToken: string;
  publicUrl: string;
  gitSha: string;
  webDir: string;
  publicDir: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const adminToken = env.KIDO_ADMIN_TOKEN ?? '';
  if (adminToken.length < 32) throw new Error('KIDO_ADMIN_TOKEN must be set (at least 32 characters)');
  return {
    port: Number(env.PORT ?? 3000),
    databasePath: env.DATABASE_PATH ?? './data/kido.sqlite',
    adminToken,
    publicUrl: (env.KIDO_PUBLIC_URL ?? 'https://kido.wmmw.sh').replace(/\/$/, ''),
    gitSha: env.KIDO_GIT_SHA ?? 'dev',
    webDir: env.KIDO_WEB_DIR ?? new URL('../../dist/web', import.meta.url).pathname,
    publicDir: env.KIDO_PUBLIC_DIR ?? new URL('../../public', import.meta.url).pathname,
  };
}
