import { describe, expect, it } from 'vitest';
import { MIN_JWT_SECRET_LENGTH, validateJwtSecrets } from '../src/config/env.js';

const strong = (seed: string) => `${seed}-${'x'.repeat(MIN_JWT_SECRET_LENGTH)}`;

describe('validateJwtSecrets', () => {
  it('accepts two different secrets of sufficient length', () => {
    expect(() => validateJwtSecrets(strong('access'), strong('refresh'))).not.toThrow();
    // `openssl rand -base64 32` output (44 characters)
    expect(() =>
      validateJwtSecrets('q5yW0nqk2y3Y0QF0wqYcY8qC0qkW9h9tq2k8m1x3s0Q=', 'Zt6m3dN4kq8L2vY7pR1sW9xC5bF0hJ3gT6yU8iO2eA4=')
    ).not.toThrow();
  });

  it('rejects a secret shorter than the minimum', () => {
    expect(() => validateJwtSecrets('short-secret', strong('refresh'))).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters \(got 12\)/
    );
    expect(() => validateJwtSecrets(strong('access'), 'x'.repeat(MIN_JWT_SECRET_LENGTH - 1))).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('rejects the .env.example placeholders, even though they are long enough', () => {
    expect(() =>
      validateJwtSecrets('your-secret-key-here-generate-with-openssl', strong('refresh'))
    ).toThrow(/JWT_ACCESS_SECRET is still the .env.example placeholder/);
    expect(() =>
      validateJwtSecrets(strong('access'), 'your-refresh-secret-key-here-generate-with-openssl')
    ).toThrow(/JWT_REFRESH_SECRET is still the .env.example placeholder/);
  });

  it('rejects using the same secret for access and refresh tokens', () => {
    const secret = strong('shared');
    expect(() => validateJwtSecrets(secret, secret)).toThrow('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  });
});
