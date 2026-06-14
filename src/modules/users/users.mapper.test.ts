import type { User } from '../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { mapUser } from './users.mapper.js';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 1n,
    name: 'Owner',
    addressLine1: '1 Test Road',
    addressLine2: null,
    addressLine3: null,
    town: 'London',
    county: 'Greater London',
    postcode: 'SW1A 1AA',
    phoneNumber: '+447700900001',
    email: 'owner@example.com',
    passwordHash: 'secret',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('mapUser', () => {
  it('maps required fields and excludes persistence secrets', () => {
    expect(mapUser(user())).toEqual({
      id: 'usr-1',
      name: 'Owner',
      address: {
        line1: '1 Test Road',
        town: 'London',
        county: 'Greater London',
        postcode: 'SW1A 1AA',
      },
      phoneNumber: '+447700900001',
      email: 'owner@example.com',
      createdTimestamp: '2026-01-01T00:00:00.000Z',
      updatedTimestamp: '2026-01-02T00:00:00.000Z',
    });
  });

  it('includes optional address lines when present', () => {
    expect(
      mapUser(user({ addressLine2: 'Flat 2', addressLine3: 'West Wing' }))
        .address,
    ).toMatchObject({ line2: 'Flat 2', line3: 'West Wing' });
  });
});
