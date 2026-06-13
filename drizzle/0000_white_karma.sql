CREATE TABLE `agent_project_state` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_profile` text NOT NULL,
	`active_thread_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_project_state_profile_nonempty" CHECK(length("agent_project_state"."agent_profile") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_project_state_unique_idx` ON `agent_project_state` (`project_id`,`agent_profile`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_run_id` text,
	`parent_event_id` text,
	`trigger_node_id` text,
	`base_tip_node_id` text,
	`run_mode` text NOT NULL,
	`status` text NOT NULL,
	`agent_profile` text NOT NULL,
	`error_artifact_id` text,
	`selection_snapshot_json` text DEFAULT '{}' NOT NULL,
	`context_snapshot_json` text,
	`input_refs_snapshot_json` text,
	`active_tools_json` text,
	`step_count` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer,
	`last_finish_reason` text,
	`error_summary` text,
	`trace_updated_at` integer,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runs_mode_valid" CHECK("agent_runs"."run_mode" IN ('send', 'retry', 'regenerate', 'edit_regenerate', 'continue', 'subagent')),
	CONSTRAINT "agent_runs_status_valid" CHECK("agent_runs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "agent_runs_profile_nonempty" CHECK(length("agent_runs"."agent_profile") > 0)
);
--> statement-breakpoint
CREATE INDEX `agent_runs_thread_idx` ON `agent_runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_parent_run_idx` ON `agent_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_thread_status_idx` ON `agent_runs` (`thread_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_runs_thread_created_idx` ON `agent_runs` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_thread_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_node_id` text,
	`role` text NOT NULL,
	`created_by_run_id` text,
	`source_step_id` text,
	`source_kind` text NOT NULL,
	`summary_text` text,
	`parts_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_thread_nodes_parent_not_self" CHECK("agent_thread_nodes"."parent_node_id" IS NULL OR "agent_thread_nodes"."parent_node_id" <> "agent_thread_nodes"."id"),
	CONSTRAINT "agent_thread_nodes_role_valid" CHECK("agent_thread_nodes"."role" IN ('system', 'user', 'assistant', 'tool')),
	CONSTRAINT "agent_thread_nodes_source_kind_valid" CHECK("agent_thread_nodes"."source_kind" IN ('user_input', 'model_response', 'tool_result', 'system_seed', 'edit_rewrite'))
);
--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_thread_idx` ON `agent_thread_nodes` (`thread_id`);--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_parent_idx` ON `agent_thread_nodes` (`parent_node_id`);--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_thread_parent_created_idx` ON `agent_thread_nodes` (`thread_id`,`parent_node_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_run_idx` ON `agent_thread_nodes` (`created_by_run_id`);--> statement-breakpoint
CREATE TABLE `agent_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`agent_profile` text NOT NULL,
	`title` text NOT NULL,
	`active_tip_node_id` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_threads_profile_nonempty" CHECK(length("agent_threads"."agent_profile") > 0),
	CONSTRAINT "agent_threads_title_nonempty" CHECK(length("agent_threads"."title") > 0)
);
--> statement-breakpoint
CREATE INDEX `agent_threads_project_idx` ON `agent_threads` (`project_id`);--> statement-breakpoint
CREATE INDEX `agent_threads_project_profile_idx` ON `agent_threads` (`project_id`,`agent_profile`);--> statement-breakpoint
CREATE INDEX `agent_threads_project_archived_idx` ON `agent_threads` (`project_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `agent_threads_active_tip_idx` ON `agent_threads` (`active_tip_node_id`);--> statement-breakpoint
CREATE TABLE `ai_catalog_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`family` text,
	`input_modalities_json` text DEFAULT '[]' NOT NULL,
	`output_modalities_json` text DEFAULT '[]' NOT NULL,
	`context_window` integer,
	`max_output_tokens` integer,
	`supports_vision` integer DEFAULT false NOT NULL,
	`supports_tool_use` integer DEFAULT false NOT NULL,
	`supports_reasoning` integer DEFAULT false NOT NULL,
	`supports_temperature` integer DEFAULT false NOT NULL,
	`input_price_per_1m` real,
	`output_price_per_1m` real,
	`cost_json` text,
	`raw_json` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_catalog_providers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_models_display_name_nonempty" CHECK(length("ai_catalog_models"."display_name") > 0),
	CONSTRAINT "ai_models_model_id_nonempty" CHECK(length("ai_catalog_models"."model_id") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_provider_model_idx` ON `ai_catalog_models` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE INDEX `ai_models_provider_idx` ON `ai_catalog_models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `ai_models_active_idx` ON `ai_catalog_models` (`is_active`);--> statement-breakpoint
CREATE TABLE `ai_catalog_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sdk_package` text,
	`api_url` text,
	`docs_url` text,
	`env_keys_json` text DEFAULT '[]' NOT NULL,
	`raw_json` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "ai_providers_name_nonempty" CHECK(length("ai_catalog_providers"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `ai_providers_active_idx` ON `ai_catalog_providers` (`is_active`);--> statement-breakpoint
CREATE TABLE `ai_registry_state` (
	`id` text PRIMARY KEY NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`content_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "ai_registry_state_id_nonempty" CHECK(length("ai_registry_state"."id") > 0)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`ref` text NOT NULL,
	`head_commit_id` text,
	`forked_from_commit_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "branches_name_nonempty" CHECK(length("branches"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_project_name_idx` ON `branches` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `branches_project_ref_idx` ON `branches` (`project_id`,`ref`);--> statement-breakpoint
CREATE INDEX `branches_project_idx` ON `branches` (`project_id`);--> statement-breakpoint
CREATE TABLE `cache_state` (
	`id` text PRIMARY KEY NOT NULL,
	`source_oid` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cache_state_oid_idx` ON `cache_state` (`source_oid`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`default_branch_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`default_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_name_nonempty" CHECK(length("projects"."name") > 0)
);
--> statement-breakpoint
CREATE INDEX `projects_updated_at_idx` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`worktree_path` text NOT NULL,
	`content_root_id` text NOT NULL,
	`aux_root_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspaces_name_nonempty" CHECK(length("workspaces"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_name_idx` ON `workspaces` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_branch_idx` ON `workspaces` (`branch_id`);--> statement-breakpoint
CREATE INDEX `workspaces_project_idx` ON `workspaces` (`project_id`);