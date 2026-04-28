import dotenv from 'dotenv';

dotenv.config();

/**
 * Environment configuration interface
 */
export interface EnvConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  mongodbUri: string;
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  encryptionKey: Buffer; // 32 bytes (256 bits) for AES-256-GCM
  openai: {
    apiKey: string;
    model: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  frontendUrl: string;
}

/**
 * Require and validate an environment variable
 */
function requireEnv(name: string, description?: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}${description ? ` (${description})` : ''}`
    );
  }
  return value.trim();
}

/**
 * Validate and parse port number
 */
function parsePort(portStr: string | undefined): number {
  const port = Number(portStr ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT: must be an integer between 1 and 65535, got: ${portStr}`
    );
  }
  return port;
}

/**
 * Decode and validate encryption key (must be 32 bytes for AES-256-GCM)
 */
function parseEncryptionKey(base64Key: string): Buffer {
  try {
    const buffer = Buffer.from(base64Key, 'base64');
    if (buffer.length !== 32) {
      throw new Error(
        `Encryption key must be 32 bytes (256 bits) when decoded, got: ${buffer.length} bytes`
      );
    }
    return buffer;
  } catch (error) {
    if (error instanceof Error && error.message.includes('32 bytes')) {
      throw error;
    }
    throw new Error(
      `DATA_ENCRYPTION_KEY_BASE64 must be valid base64. Error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Validate URL format
 */
function validateUrl(url: string, name: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    throw new Error(`Invalid URL for ${name}: ${url}`);
  }
}

/**
 * Parse and validate all environment variables
 */
function loadEnv(): EnvConfig {
  return {
    nodeEnv: (['development', 'production', 'test'].includes(
      process.env.NODE_ENV || ''
    )
      ? process.env.NODE_ENV
      : 'development') as 'development' | 'production' | 'test',

    port: parsePort(process.env.PORT),

    mongodbUri: requireEnv('MONGODB_URI', 'MongoDB connection string'),

    jwt: {
      accessSecret: requireEnv('JWT_ACCESS_SECRET', 'JWT access token secret'),
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshSecret: requireEnv('JWT_REFRESH_SECRET', 'JWT refresh token secret'),
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    },

    encryptionKey: parseEncryptionKey(
      requireEnv('DATA_ENCRYPTION_KEY_BASE64', 'Base64-encoded 32-byte encryption key')
    ),

    openai: {
      apiKey: requireEnv('OPENAI_API_KEY', 'OpenAI API key'),
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    },

    google: {
      clientId: requireEnv('GOOGLE_CLIENT_ID', 'Google OAuth2 client ID'),
      clientSecret: requireEnv('GOOGLE_CLIENT_SECRET', 'Google OAuth2 client secret'),
      redirectUri: validateUrl(
        requireEnv('GOOGLE_REDIRECT_URI', 'Google OAuth2 redirect URI'),
        'GOOGLE_REDIRECT_URI'
      ),
    },

    frontendUrl: validateUrl(
      process.env.FRONTEND_URL ?? 'http://localhost:4200',
      'FRONTEND_URL'
    ),
  };
}

// Load and export configuration
export const env: EnvConfig = loadEnv();
