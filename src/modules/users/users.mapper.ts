import type { User } from '../../../generated/prisma/client.js';
import { formatUserApiId } from './user-id.js';

export function mapUser(user: User) {
  return {
    id: formatUserApiId(user.id),
    name: user.name,
    address: {
      line1: user.addressLine1,
      ...(user.addressLine2 ? { line2: user.addressLine2 } : {}),
      ...(user.addressLine3 ? { line3: user.addressLine3 } : {}),
      town: user.town,
      county: user.county,
      postcode: user.postcode,
    },
    phoneNumber: user.phoneNumber,
    email: user.email,
    createdTimestamp: user.createdAt.toISOString(),
    updatedTimestamp: user.updatedAt.toISOString(),
  };
}
