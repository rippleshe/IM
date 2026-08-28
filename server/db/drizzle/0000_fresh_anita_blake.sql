CREATE TABLE "audit_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"round" integer NOT NULL,
	"verdict" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"released" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "ck_audit_verdict" CHECK ("audit_decisions"."verdict" in ('supported','partial','conflict','unsupported'))
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "bkt_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"knowledge_point_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"claim_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"support_level" text NOT NULL,
	CONSTRAINT "claim_evidence_claim_id_evidence_id_pk" PRIMARY KEY("claim_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"learner_id" text,
	"text" text NOT NULL,
	"verdict" text NOT NULL,
	"critique" text DEFAULT '' NOT NULL,
	"factual_score" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"field_name" text NOT NULL,
	"data_type" text NOT NULL,
	"meaning" text NOT NULL,
	"unit" text,
	"label_role" text
);
--> statement-breakpoint
CREATE TABLE "dataset_rows" (
	"dataset_id" text NOT NULL,
	"row_id" integer NOT NULL,
	"data_json" jsonb NOT NULL,
	CONSTRAINT "dataset_rows_dataset_id_row_id_pk" PRIMARY KEY("dataset_id","row_id")
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_path" text NOT NULL,
	"version" text NOT NULL,
	"license" text,
	"checksum" text,
	"imported_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"issue_type" text NOT NULL,
	"target_claim_id" text,
	"argument" text NOT NULL,
	"status" text DEFAULT 'raised' NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "ck_debate_issue_type" CHECK ("debate_issues"."issue_type" in ('no_evidence','conflict','out_of_scope_causality','difficulty_mismatch')),
	CONSTRAINT "ck_debate_issue_status" CHECK ("debate_issues"."status" in ('raised','accepted','rejected','resolved'))
);
--> statement-breakpoint
CREATE TABLE "diagnostic_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"learner_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer_id" text NOT NULL,
	"correct" boolean NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"answered_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"dimension" text NOT NULL,
	"level" text NOT NULL,
	"knowledge_point_id" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer_id" text NOT NULL,
	"explanation" text NOT NULL,
	"evidence_ref" text,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "diagnostic_questions_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_diag_dimension" CHECK ("diagnostic_questions"."dimension" in ('python','data_processing','statistics','time_series','device_diagnosis')),
	CONSTRAINT "ck_diag_level" CHECK ("diagnostic_questions"."level" in ('L1','L2','L3'))
);
--> statement-breakpoint
CREATE TABLE "diagnostic_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"prior_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"started_at" bigint NOT NULL,
	"completed_at" bigint,
	CONSTRAINT "ck_diag_session_status" CHECK ("diagnostic_sessions"."status" in ('in_progress','completed','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_path" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"search_text" text NOT NULL,
	"locator" text NOT NULL,
	"trust_level" text DEFAULT 'medium' NOT NULL,
	"embedding" vector(1024),
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"persona" text NOT NULL,
	"domain" text NOT NULL,
	"task_level" text NOT NULL,
	"resource_type" text NOT NULL,
	"task" text NOT NULL,
	"required_knowledge_points" jsonb NOT NULL,
	"target_difficulty_range" jsonb NOT NULL,
	"allowed_evidence_scope" jsonb NOT NULL,
	"expected_structure" jsonb NOT NULL,
	CONSTRAINT "evaluation_cases_code_unique" UNIQUE("code"),
	CONSTRAINT "ck_eval_persona" CHECK ("evaluation_cases"."persona" in ('learner-foundation','learner-advanced','learner-maintenance')),
	CONSTRAINT "ck_eval_task_level" CHECK ("evaluation_cases"."task_level" in ('basic','advanced','transfer'))
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"run_id" text,
	"metrics" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_title" text,
	"locator" text NOT NULL,
	"content" text NOT NULL,
	"retrieval_method" text NOT NULL,
	"relevance_score" double precision NOT NULL,
	"trust_level" text NOT NULL,
	"source_scope" text DEFAULT 'system' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_pack_items" (
	"pack_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "evidence_pack_items_pack_id_evidence_id_pk" PRIMARY KEY("pack_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text,
	"session_id" text,
	"query" text NOT NULL,
	"retrieval_plan_json" jsonb NOT NULL,
	"coverage_score" double precision NOT NULL,
	"cross_validation_json" jsonb NOT NULL,
	"privacy_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_onboarding" (
	"learner_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"programming_foundation" text NOT NULL,
	"goal" text NOT NULL,
	"weekly_hours" double precision,
	"self_description" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_profile_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"summary" text NOT NULL,
	"keywords_json" jsonb NOT NULL,
	"radar_json" jsonb NOT NULL,
	"generated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_skill_states" (
	"learner_id" text NOT NULL,
	"knowledge_point_id" text NOT NULL,
	"p_mastery" double precision DEFAULT 0.2 NOT NULL,
	"p_guess" double precision DEFAULT 0.25 NOT NULL,
	"p_slip" double precision DEFAULT 0.1 NOT NULL,
	"p_learn" double precision DEFAULT 0.1 NOT NULL,
	"confidence" double precision DEFAULT 0.1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"evidence_source" text DEFAULT 'none' NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "learner_skill_states_learner_id_knowledge_point_id_pk" PRIMARY KEY("learner_id","knowledge_point_id"),
	CONSTRAINT "ck_skill_p_mastery" CHECK ("learner_skill_states"."p_mastery" >= 0 and "learner_skill_states"."p_mastery" <= 1),
	CONSTRAINT "ck_skill_confidence" CHECK ("learner_skill_states"."confidence" >= 0 and "learner_skill_states"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "learning_asset_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"mastered" boolean DEFAULT false NOT NULL,
	"mastery_level" text,
	"difficulty_rating" integer,
	"user_rating" integer,
	"note" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "uq_asset_feedback" UNIQUE("learner_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "learning_asset_page_notes" (
	"learner_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"page_key" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "learning_asset_page_notes_learner_id_asset_id_page_key_pk" PRIMARY KEY("learner_id","asset_id","page_key")
);
--> statement-breakpoint
CREATE TABLE "learning_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"session_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"difficulty" double precision,
	"difficulty_calibration" jsonb,
	"audit_status" text NOT NULL,
	"evidence_ids_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_path_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"relation" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "uq_path_edge" UNIQUE("learner_id","from_node_id","to_node_id","relation")
);
--> statement-breakpoint
CREATE TABLE "learning_path_items" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"knowledge_point_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"priority" integer NOT NULL,
	"reason" text NOT NULL,
	"completion_criteria" text NOT NULL,
	"recommended_resource_type" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_path_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"knowledge_point_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"user_status" text DEFAULT 'not_started' NOT NULL,
	"mastered" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_quiz_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer_json" jsonb NOT NULL,
	"correct" boolean NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metro_event_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"label" text NOT NULL,
	"start_at" text NOT NULL,
	"end_at" text NOT NULL,
	"source_locator" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metro_readings" (
	"row_id" bigint PRIMARY KEY NOT NULL,
	"timestamp" text NOT NULL,
	"tp2" double precision,
	"tp3" double precision,
	"h1" double precision,
	"dv_pressure" double precision,
	"reservoirs" double precision,
	"oil_temperature" double precision,
	"motor_current" double precision,
	"comp" double precision,
	"dv_electric" double precision,
	"towers" double precision,
	"mpg" double precision,
	"lps" double precision,
	"pressure_switch" double precision,
	"oil_level" double precision,
	"caudal_impulses" double precision
);
--> statement-breakpoint
CREATE TABLE "migration_state" (
	"table_name" text PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"row_count" bigint NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"migrated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text,
	"session_id" text,
	"event_type" text NOT NULL,
	"file_name" text,
	"byte_count" bigint,
	"content_hash" text,
	"redacted_fields_json" jsonb NOT NULL,
	"retained" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "run_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"node_key" text,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb,
	"created_at" bigint NOT NULL,
	CONSTRAINT "uq_run_event_seq" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "study_run_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"node_key" text NOT NULL,
	"role" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"result_summary" text,
	"error_message" text,
	CONSTRAINT "uq_run_node_attempt" UNIQUE("run_id","node_key","attempt"),
	CONSTRAINT "ck_run_node_status" CHECK ("study_run_nodes"."status" in ('pending','running','succeeded','failed','skipped','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "study_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"plan_json" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"revision_round" integer DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"final_asset_id" text,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	CONSTRAINT "ck_run_status" CHECK ("study_runs"."status" in ('queued','running','succeeded','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"login_name" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_key" text DEFAULT 'graphite' NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "users_login_name_unique" UNIQUE("login_name")
);
--> statement-breakpoint
CREATE INDEX "idx_audit_decisions_run" ON "audit_decisions" USING btree ("run_id","round");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_token" ON "auth_sessions" USING btree ("token_hash","expires_at");--> statement-breakpoint
CREATE INDEX "idx_bkt_updates_learner" ON "bkt_updates" USING btree ("learner_id","knowledge_point_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_claims_resource" ON "claims" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_debate_issues_run" ON "debate_issues" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_diag_answers_session" ON "diagnostic_answers" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE INDEX "idx_diag_sessions_learner" ON "diagnostic_sessions" USING btree ("learner_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_document_source" ON "document_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_fts" ON "document_chunks" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
CREATE INDEX "idx_document_chunks_embedding" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_eval_results_case" ON "evaluation_results" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pack_items_evidence" ON "evidence_pack_items" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "idx_evidence_packs_session" ON "evidence_packs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_profile_learner" ON "learner_profile_snapshots" USING btree ("learner_id","generated_at");--> statement-breakpoint
CREATE INDEX "idx_asset_feedback_learner" ON "learning_asset_feedback" USING btree ("learner_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_page_notes_asset" ON "learning_asset_page_notes" USING btree ("learner_id","asset_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_assets_learner" ON "learning_assets" USING btree ("learner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_learner" ON "learning_chat_messages" USING btree ("learner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_events_learner" ON "learning_events" USING btree ("learner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_path_edges_learner" ON "learning_path_edges" USING btree ("learner_id","from_node_id","to_node_id");--> statement-breakpoint
CREATE INDEX "idx_path_nodes_learner" ON "learning_path_nodes" USING btree ("learner_id","sort_order","updated_at");--> statement-breakpoint
CREATE INDEX "idx_quiz_attempts_asset" ON "learning_quiz_attempts" USING btree ("learner_id","asset_id","question_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_metro_timestamp" ON "metro_readings" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_run_events_run" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "idx_run_nodes_run" ON "study_run_nodes" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "idx_study_runs_learner" ON "study_runs" USING btree ("learner_id","created_at");