CREATE TABLE "knowledge_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "source_type" text NOT NULL,
  "title" text NOT NULL,
  "short_title" text,
  "canonical_url" text,
  "doi" text,
  "license" text DEFAULT 'unknown' NOT NULL,
  "trust_level" text DEFAULT 'medium' NOT NULL,
  "review_status" text DEFAULT 'candidate' NOT NULL,
  "distribution_scope" text DEFAULT 'local_only' NOT NULL,
  "current_version_id" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_knowledge_sources_url" ON "knowledge_sources" USING btree ("canonical_url");
--> statement-breakpoint
CREATE INDEX "idx_knowledge_sources_review" ON "knowledge_sources" USING btree ("review_status", "updated_at");
--> statement-breakpoint
CREATE TABLE "knowledge_source_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL REFERENCES "knowledge_sources"("id") ON DELETE RESTRICT,
  "content_sha256" text NOT NULL,
  "original_path" text NOT NULL,
  "extracted_text" text,
  "extracted_path" text,
  "parser" text NOT NULL,
  "parse_status" text NOT NULL,
  "quality_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version_status" text DEFAULT 'candidate' NOT NULL,
  "created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_knowledge_source_version_hash" ON "knowledge_source_versions" USING btree ("source_id", "content_sha256");
--> statement-breakpoint
CREATE INDEX "idx_knowledge_source_versions_status" ON "knowledge_source_versions" USING btree ("source_id", "version_status", "created_at");
--> statement-breakpoint
CREATE TABLE "knowledge_ingest_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "input_path" text NOT NULL,
  "input_sha256" text,
  "status" text NOT NULL,
  "stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_summary" text,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_knowledge_ingest_jobs_status" ON "knowledge_ingest_jobs" USING btree ("status", "updated_at");
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "source_version_id" text;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "section_path" text;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_start" integer;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_end" integer;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "chunk_type" text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "token_count" integer;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "content_hash" text;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "knowledge_source_versions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "idx_document_source_version" ON "document_chunks" USING btree ("source_version_id", "enabled");
