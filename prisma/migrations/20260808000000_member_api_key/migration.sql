-- AlterTable: add api_key column to members (API key auth, MVP)
ALTER TABLE "members" ADD COLUMN "api_key" TEXT;

-- CreateIndex: unique index on api_key
CREATE UNIQUE INDEX "members_api_key_key" ON "members"("api_key");
