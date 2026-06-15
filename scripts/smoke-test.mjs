const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const readyAttempts = 60;
const readyDelayMilliseconds = 1000;

async function request(method, path, { token, body, idempotencyKey } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let responseBody;

  if (text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }

  return {
    status: response.status,
    body: responseBody,
  };
}

function fail(step, message, result) {
  throw new Error(
    `${step}: ${message}; response=${JSON.stringify(result.body)}`,
  );
}

function expectStatus(result, expectedStatus, step) {
  if (result.status !== expectedStatus) {
    fail(
      step,
      `expected HTTP ${expectedStatus}, received HTTP ${result.status}`,
      result,
    );
  }
  console.log(`ok ${step}`);
}

function expectError(result, expectedStatus, expectedMessage, step) {
  expectStatus(result, expectedStatus, step);
  if (
    typeof result.body !== 'object' ||
    result.body === null ||
    result.body.message !== expectedMessage
  ) {
    fail(step, `expected error message "${expectedMessage}"`, result);
  }
}

function expectValidationError(result, step) {
  expectError(result, 400, 'Invalid details supplied', step);
  if (!Array.isArray(result.body.details) || result.body.details.length === 0) {
    fail(step, 'expected a non-empty validation details array', result);
  }
}

function requireString(result, field, step) {
  const value =
    typeof result.body === 'object' && result.body !== null
      ? result.body[field]
      : undefined;
  if (typeof value !== 'string' || value.length === 0) {
    fail(step, `expected response field "${field}" to be a string`, result);
  }
  return value;
}

function expectField(result, field, expectedValue, step) {
  const actualValue =
    typeof result.body === 'object' && result.body !== null
      ? result.body[field]
      : undefined;
  if (actualValue !== expectedValue) {
    fail(
      step,
      `expected "${field}" to equal ${JSON.stringify(expectedValue)}`,
      result,
    );
  }
}

async function waitForReadiness() {
  for (let attempt = 0; attempt < readyAttempts; attempt += 1) {
    try {
      const result = await request('GET', '/ready');
      if (result.status === 200) return;
    } catch {
      // Startup can briefly refuse connections while Compose health checks run.
    }
    await new Promise((resolve) => setTimeout(resolve, readyDelayMilliseconds));
  }
  throw new Error(
    `API did not become ready within ${
      (readyAttempts * readyDelayMilliseconds) / 1000
    } seconds`,
  );
}

await waitForReadiness();

const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = 'SmokePassword123!';
const primaryEmail = `smoke-primary-${unique}@example.com`;
const otherEmail = `smoke-other-${unique}@example.com`;
const missingUserId = 'usr-999999999';
const missingAccountNumber = '01999999';
const missingTransactionId = 'tan-999999999';

const health = await request('GET', '/health');
expectStatus(health, 200, 'health');
expectField(health, 'status', 'ok', 'health response');

const readiness = await request('GET', '/ready');
expectStatus(readiness, 200, 'readiness');
expectField(readiness, 'status', 'ready', 'readiness response');

const primaryUser = await request('POST', '/v1/users', {
  body: {
    name: 'Primary Smoke User',
    address: {
      line1: '1 Test Road',
      town: 'London',
      county: 'Greater London',
      postcode: 'SW1A 1AA',
    },
    phoneNumber: `+4477${String(Date.now()).slice(-8)}`,
    email: primaryEmail,
    password,
  },
});
expectStatus(primaryUser, 201, 'create primary user');
const primaryUserId = requireString(primaryUser, 'id', 'create primary user');

const primaryLogin = await request('POST', '/v1/auth/login', {
  body: { email: primaryEmail, password },
});
expectStatus(primaryLogin, 200, 'login primary user');
const primaryToken = requireString(
  primaryLogin,
  'accessToken',
  'login primary user',
);

expectStatus(
  await request('GET', `/v1/users/${primaryUserId}`, {
    token: primaryToken,
  }),
  200,
  'fetch primary user',
);

const updatedUser = await request('PATCH', `/v1/users/${primaryUserId}`, {
  token: primaryToken,
  body: {
    name: 'Updated Primary Smoke User',
    phoneNumber: '+447700900124',
  },
});
expectStatus(updatedUser, 200, 'update primary user');
expectField(
  updatedUser,
  'name',
  'Updated Primary Smoke User',
  'updated primary user response',
);

const primaryAccount = await request('POST', '/v1/accounts', {
  token: primaryToken,
  body: { name: 'Primary Smoke Account', accountType: 'personal' },
});
expectStatus(primaryAccount, 201, 'create primary account');
const primaryAccountNumber = requireString(
  primaryAccount,
  'accountNumber',
  'create primary account',
);

const accountList = await request('GET', '/v1/accounts', {
  token: primaryToken,
});
expectStatus(accountList, 200, 'list primary accounts');
if (
  typeof accountList.body !== 'object' ||
  accountList.body === null ||
  !Array.isArray(accountList.body.accounts) ||
  !accountList.body.accounts.some(
    (account) => account.accountNumber === primaryAccountNumber,
  )
) {
  fail(
    'list primary accounts',
    'created account was not returned',
    accountList,
  );
}

expectStatus(
  await request('GET', `/v1/accounts/${primaryAccountNumber}`, {
    token: primaryToken,
  }),
  200,
  'fetch primary account',
);

const updatedAccount = await request(
  'PATCH',
  `/v1/accounts/${primaryAccountNumber}`,
  {
    token: primaryToken,
    body: { name: 'Updated Primary Smoke Account' },
  },
);
expectStatus(updatedAccount, 200, 'update primary account');
expectField(
  updatedAccount,
  'name',
  'Updated Primary Smoke Account',
  'updated primary account response',
);

const depositKey = `deposit-${unique}`;
const depositBody = {
  amount: 100,
  currency: 'GBP',
  type: 'deposit',
  reference: 'Smoke deposit',
};
const deposit = await request(
  'POST',
  `/v1/accounts/${primaryAccountNumber}/transactions`,
  {
    token: primaryToken,
    idempotencyKey: depositKey,
    body: depositBody,
  },
);
expectStatus(deposit, 201, 'deposit');
const depositId = requireString(deposit, 'id', 'deposit');

const replayedDeposit = await request(
  'POST',
  `/v1/accounts/${primaryAccountNumber}/transactions`,
  {
    token: primaryToken,
    idempotencyKey: depositKey,
    body: depositBody,
  },
);
expectStatus(replayedDeposit, 201, 'replay identical deposit');
expectField(
  replayedDeposit,
  'id',
  depositId,
  'replayed deposit returns original transaction',
);

expectError(
  await request('POST', `/v1/accounts/${primaryAccountNumber}/transactions`, {
    token: primaryToken,
    idempotencyKey: depositKey,
    body: { ...depositBody, amount: 101 },
  }),
  409,
  'Idempotency key was reused for a different transaction',
  'reject conflicting idempotency key',
);

expectStatus(
  await request('POST', `/v1/accounts/${primaryAccountNumber}/transactions`, {
    token: primaryToken,
    idempotencyKey: `withdrawal-${unique}`,
    body: {
      amount: 25,
      currency: 'GBP',
      type: 'withdrawal',
      reference: 'Smoke withdrawal',
    },
  }),
  201,
  'withdraw',
);

const transactions = await request(
  'GET',
  `/v1/accounts/${primaryAccountNumber}/transactions`,
  { token: primaryToken },
);
expectStatus(transactions, 200, 'list primary transactions');
if (
  typeof transactions.body !== 'object' ||
  transactions.body === null ||
  !Array.isArray(transactions.body.transactions) ||
  !transactions.body.transactions.some(
    (transaction) => transaction.id === depositId,
  )
) {
  fail(
    'list primary transactions',
    'deposit transaction was not returned',
    transactions,
  );
}

expectStatus(
  await request(
    'GET',
    `/v1/accounts/${primaryAccountNumber}/transactions/${depositId}`,
    { token: primaryToken },
  ),
  200,
  'fetch primary transaction',
);

expectError(
  await request('GET', '/v1/accounts'),
  401,
  'Access token is missing or invalid',
  'reject missing bearer token',
);
expectError(
  await request('GET', '/v1/accounts', { token: 'invalid-token' }),
  401,
  'Access token is missing or invalid',
  'reject invalid bearer token',
);
expectError(
  await request('POST', '/v1/auth/login', {
    body: { email: primaryEmail, password: 'incorrect-password' },
  }),
  401,
  'Invalid email or password',
  'reject invalid login',
);

expectValidationError(
  await request('POST', '/v1/users', { body: {} }),
  'reject invalid user creation',
);
expectValidationError(
  await request('POST', '/v1/accounts', {
    token: primaryToken,
    body: {},
  }),
  'reject invalid account creation',
);
expectValidationError(
  await request('POST', `/v1/accounts/${primaryAccountNumber}/transactions`, {
    token: primaryToken,
    idempotencyKey: `invalid-transaction-${unique}`,
    body: { currency: 'GBP', type: 'deposit' },
  }),
  'reject invalid transaction creation',
);

const otherUser = await request('POST', '/v1/users', {
  body: {
    name: 'Other Smoke User',
    address: {
      line1: '2 Test Road',
      town: 'London',
      county: 'Greater London',
      postcode: 'SW1A 1AA',
    },
    phoneNumber: `+4476${String(Date.now()).slice(-8)}`,
    email: otherEmail,
    password,
  },
});
expectStatus(otherUser, 201, 'create other user');
const otherUserId = requireString(otherUser, 'id', 'create other user');

const otherLogin = await request('POST', '/v1/auth/login', {
  body: { email: otherEmail, password },
});
expectStatus(otherLogin, 200, 'login other user');
const otherToken = requireString(otherLogin, 'accessToken', 'login other user');

const otherAccount = await request('POST', '/v1/accounts', {
  token: otherToken,
  body: { name: 'Other Smoke Account', accountType: 'personal' },
});
expectStatus(otherAccount, 201, 'create other account');
const otherAccountNumber = requireString(
  otherAccount,
  'accountNumber',
  'create other account',
);

const secondPrimaryAccount = await request('POST', '/v1/accounts', {
  token: primaryToken,
  body: { name: 'Second Primary Account', accountType: 'personal' },
});
expectStatus(secondPrimaryAccount, 201, 'create second primary account');
const secondPrimaryAccountNumber = requireString(
  secondPrimaryAccount,
  'accountNumber',
  'create second primary account',
);

for (const [method, body, step] of [
  ['GET', undefined, 'reject fetching another user'],
  ['PATCH', { name: 'Forbidden update' }, 'reject updating another user'],
  ['DELETE', undefined, 'reject deleting another user'],
]) {
  expectError(
    await request(method, `/v1/users/${otherUserId}`, {
      token: primaryToken,
      ...(body !== undefined ? { body } : {}),
    }),
    403,
    'You are not allowed to access this user',
    step,
  );
}

for (const [method, body, step] of [
  ['GET', undefined, 'reject fetching missing user'],
  ['PATCH', { name: 'Missing user' }, 'reject updating missing user'],
  ['DELETE', undefined, 'reject deleting missing user'],
]) {
  expectError(
    await request(method, `/v1/users/${missingUserId}`, {
      token: primaryToken,
      ...(body !== undefined ? { body } : {}),
    }),
    404,
    'User was not found',
    step,
  );
}

expectError(
  await request('DELETE', `/v1/users/${primaryUserId}`, {
    token: primaryToken,
  }),
  409,
  'A user cannot be deleted while associated with a bank account',
  'reject deleting user with active accounts',
);

for (const [method, body, step] of [
  ['GET', undefined, 'reject fetching another account'],
  ['PATCH', { name: 'Forbidden update' }, 'reject updating another account'],
  ['DELETE', undefined, 'reject deleting another account'],
]) {
  expectError(
    await request(method, `/v1/accounts/${otherAccountNumber}`, {
      token: primaryToken,
      ...(body !== undefined ? { body } : {}),
    }),
    403,
    'You are not allowed to access this bank account',
    step,
  );
}

for (const [method, body, step] of [
  ['GET', undefined, 'reject fetching missing account'],
  ['PATCH', { name: 'Missing account' }, 'reject updating missing account'],
  ['DELETE', undefined, 'reject deleting missing account'],
]) {
  expectError(
    await request(method, `/v1/accounts/${missingAccountNumber}`, {
      token: primaryToken,
      ...(body !== undefined ? { body } : {}),
    }),
    404,
    'Bank account was not found',
    step,
  );
}

expectError(
  await request('POST', `/v1/accounts/${primaryAccountNumber}/transactions`, {
    token: primaryToken,
    idempotencyKey: `insufficient-funds-${unique}`,
    body: {
      amount: 9999,
      currency: 'GBP',
      type: 'withdrawal',
      reference: 'Expected insufficient funds',
    },
  }),
  422,
  'Insufficient funds to process transaction',
  'reject insufficient funds',
);

expectError(
  await request('POST', `/v1/accounts/${otherAccountNumber}/transactions`, {
    token: primaryToken,
    idempotencyKey: `forbidden-account-${unique}`,
    body: { amount: 10, currency: 'GBP', type: 'deposit' },
  }),
  403,
  'You are not allowed to access this bank account',
  'reject transaction on another account',
);
expectError(
  await request('POST', `/v1/accounts/${missingAccountNumber}/transactions`, {
    token: primaryToken,
    idempotencyKey: `missing-account-${unique}`,
    body: { amount: 10, currency: 'GBP', type: 'deposit' },
  }),
  404,
  'Bank account was not found',
  'reject transaction on missing account',
);
expectError(
  await request('GET', `/v1/accounts/${otherAccountNumber}/transactions`, {
    token: primaryToken,
  }),
  403,
  'You are not allowed to access this bank account',
  'reject listing another account transactions',
);
expectError(
  await request('GET', `/v1/accounts/${missingAccountNumber}/transactions`, {
    token: primaryToken,
  }),
  404,
  'Bank account was not found',
  'reject listing missing account transactions',
);
expectError(
  await request(
    'GET',
    `/v1/accounts/${otherAccountNumber}/transactions/${depositId}`,
    { token: primaryToken },
  ),
  403,
  'You are not allowed to access this bank account',
  'reject fetching transaction through another account',
);
expectError(
  await request(
    'GET',
    `/v1/accounts/${missingAccountNumber}/transactions/${depositId}`,
    { token: primaryToken },
  ),
  404,
  'Bank account was not found',
  'reject fetching transaction through missing account',
);
expectError(
  await request(
    'GET',
    `/v1/accounts/${primaryAccountNumber}/transactions/${missingTransactionId}`,
    { token: primaryToken },
  ),
  404,
  'Transaction was not found',
  'reject missing transaction',
);
expectError(
  await request(
    'GET',
    `/v1/accounts/${secondPrimaryAccountNumber}/transactions/${depositId}`,
    { token: primaryToken },
  ),
  404,
  'Transaction was not found',
  'reject transaction fetched through wrong owned account',
);

expectStatus(
  await request('DELETE', `/v1/accounts/${primaryAccountNumber}`, {
    token: primaryToken,
  }),
  204,
  'delete primary account',
);
expectStatus(
  await request('DELETE', `/v1/accounts/${secondPrimaryAccountNumber}`, {
    token: primaryToken,
  }),
  204,
  'delete second primary account',
);
expectStatus(
  await request('DELETE', `/v1/accounts/${otherAccountNumber}`, {
    token: otherToken,
  }),
  204,
  'delete other account',
);
expectStatus(
  await request('DELETE', `/v1/users/${primaryUserId}`, {
    token: primaryToken,
  }),
  204,
  'delete primary user',
);
expectStatus(
  await request('DELETE', `/v1/users/${otherUserId}`, {
    token: otherToken,
  }),
  204,
  'delete other user',
);

console.log('Eagle Bank full API smoke test passed');
