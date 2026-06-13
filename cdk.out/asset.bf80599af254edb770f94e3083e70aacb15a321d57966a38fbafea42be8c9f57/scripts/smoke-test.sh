#!/bin/sh
set -euo pipefail

docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  node:24-alpine node --input-type=module <<'NODE'
const baseUrl = "http://host.docker.internal:3000";

async function request(method, path, { token, body, idempotencyKey } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined
  };
}

function expectStatus(result, expected, step) {
  if (result.status !== expected) {
    throw new Error(`${step}: expected ${expected}, got ${result.status}: ${JSON.stringify(result.body)}`);
  }
  console.log(`ok ${step}`);
}

let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const result = await request("GET", "/ready");
    if (result.status === 200) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!ready) throw new Error("API did not become ready within 60 seconds");

expectStatus(await request("GET", "/health"), 200, "health");
expectStatus(await request("GET", "/ready"), 200, "ready");

const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `smoke-${unique}@example.com`;
const password = "SmokePassword123!";
const user = await request("POST", "/v1/users", {
  body: {
    name: "Smoke Test",
    address: {
      line1: "1 Test Road",
      town: "London",
      county: "Greater London",
      postcode: "SW1A 1AA"
    },
    phoneNumber: `+4477${String(Date.now()).slice(-8)}`,
    email,
    password
  }
});
expectStatus(user, 201, "create user");

const login = await request("POST", "/v1/auth/login", {
  body: { email, password }
});
expectStatus(login, 200, "login");
const token = login.body.accessToken;

const account = await request("POST", "/v1/accounts", {
  token,
  body: { name: "Smoke Account", accountType: "personal" }
});
expectStatus(account, 201, "create account");
const accountNumber = account.body.accountNumber;

const deposit = await request(
  "POST",
  `/v1/accounts/${accountNumber}/transactions`,
  {
    token,
    idempotencyKey: `deposit-${unique}`,
    body: {
      amount: 100,
      currency: "GBP",
      type: "deposit",
      reference: "Smoke deposit"
    }
  }
);
expectStatus(deposit, 201, "deposit");

expectStatus(
  await request("POST", `/v1/accounts/${accountNumber}/transactions`, {
    token,
    idempotencyKey: `withdrawal-${unique}`,
    body: {
      amount: 25,
      currency: "GBP",
      type: "withdrawal",
      reference: "Smoke withdrawal"
    }
  }),
  201,
  "withdraw"
);
expectStatus(
  await request("GET", `/v1/accounts/${accountNumber}`, { token }),
  200,
  "fetch account"
);
expectStatus(
  await request("GET", `/v1/accounts/${accountNumber}/transactions`, { token }),
  200,
  "list transactions"
);
expectStatus(
  await request(
    "GET",
    `/v1/accounts/${accountNumber}/transactions/${deposit.body.id}`,
    { token }
  ),
  200,
  "fetch transaction"
);
expectStatus(
  await request("DELETE", `/v1/accounts/${accountNumber}`, { token }),
  204,
  "delete account"
);
expectStatus(
  await request("DELETE", `/v1/users/${user.body.id}`, { token }),
  204,
  "delete user"
);
console.log("Eagle Bank smoke test passed");
NODE
