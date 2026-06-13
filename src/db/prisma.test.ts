import { describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';

describe('prisma', () => {
  it('exports a Prisma client without opening a connection eagerly', () => {
    expect(prisma).toHaveProperty('$connect');
    expect(prisma).toHaveProperty('$disconnect');
  });
});
