ALTER TABLE "BankAccount"
  DROP CONSTRAINT "BankAccount_userId_fkey";

ALTER TABLE "BankAccount"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
