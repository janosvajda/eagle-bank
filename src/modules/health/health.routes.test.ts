import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { healthRoutes } from './health.routes.js';

describe('healthRoutes', () => {
  it('reports process health', async () => {
    const app = fastify();
    await app.register(healthRoutes({} as never));
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it.each([
    ['ready', vi.fn().mockResolvedValue(null), 200, false],
    ['not_ready', vi.fn().mockRejectedValue(new Error('down')), 503, true],
  ])(
    'reports %s dependency state',
    async (status, findFirst, code, logsError) => {
      const app = fastify();
      const errorLog = vi.spyOn(app.log, 'error');
      await app.register(healthRoutes({ user: { findFirst } } as never));
      const response = await app.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode).toBe(code);
      expect(response.json()).toEqual({ status });
      if (logsError) {
        expect(errorLog).toHaveBeenCalledWith(
          { err: expect.any(Error) },
          'Readiness dependency check failed',
        );
      } else {
        expect(errorLog).not.toHaveBeenCalled();
      }
      await app.close();
    },
  );
});
