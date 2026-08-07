-- CreateIndex
CREATE UNIQUE INDEX "consents_member_id_type_scope_key" ON "consents"("member_id", "type", "scope");
