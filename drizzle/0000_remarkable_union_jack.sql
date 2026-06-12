CREATE TABLE `agent_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`step_id` text,
	`artifact_kind` text NOT NULL,
	`visibility` text NOT NULL,
	`mime_type` text,
	`content_json` text NOT NULL,
	`summary_text` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `agent_run_steps`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_artifacts_kind_valid" CHECK("agent_artifacts"."artifact_kind" IN ('prepared-model-messages', 'response-messages', 'request-body', 'response-body', 'provider-metadata', 'tool-input', 'tool-output', 'reasoning-raw', 'ui-projection', 'error')),
	CONSTRAINT "agent_artifacts_visibility_valid" CHECK("agent_artifacts"."visibility" IN ('public', 'hidden', 'internal'))
);
--> statement-breakpoint
CREATE INDEX `agent_artifacts_run_idx` ON `agent_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_step_idx` ON `agent_artifacts` (`step_id`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_kind_idx` ON `agent_artifacts` (`artifact_kind`);--> statement-breakpoint
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
CREATE INDEX `agent_project_state_active_thread_idx` ON `agent_project_state` (`active_thread_id`);--> statement-breakpoint
CREATE TABLE `agent_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text,
	`seq` integer NOT NULL,
	`event_kind` text NOT NULL,
	`node_id` text,
	`related_tool_call_id` text,
	`related_run_id` text,
	`summary_text` text,
	`payload_artifact_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `agent_run_steps`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`related_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payload_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_run_events_kind_valid" CHECK("agent_run_events"."event_kind" IN ('run-started', 'step-started', 'provider-requested', 'provider-responded', 'tool-call-started', 'tool-call-finished', 'tool-call-failed', 'node-materialized', 'active-tip-moved', 'child-run-started', 'run-failed', 'run-succeeded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_events_run_seq_idx` ON `agent_run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_run_events_step_idx` ON `agent_run_events` (`step_id`);--> statement-breakpoint
CREATE INDEX `agent_run_events_node_idx` ON `agent_run_events` (`node_id`);--> statement-breakpoint
CREATE INDEX `agent_run_events_related_run_idx` ON `agent_run_events` (`related_run_id`);--> statement-breakpoint
CREATE TABLE `agent_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`finish_reason` text,
	`raw_finish_reason` text,
	`system_json` text,
	`prepared_messages_artifact_id` text,
	`response_messages_artifact_id` text,
	`request_body_artifact_id` text,
	`response_body_artifact_id` text,
	`provider_metadata_artifact_id` text,
	`usage_json` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prepared_messages_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`response_messages_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`request_body_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`response_body_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_metadata_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_run_steps_provider_nonempty" CHECK(length("agent_run_steps"."provider") > 0),
	CONSTRAINT "agent_run_steps_model_nonempty" CHECK(length("agent_run_steps"."model_id") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_steps_run_step_idx` ON `agent_run_steps` (`run_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `agent_run_steps_run_idx` ON `agent_run_steps` (`run_id`);--> statement-breakpoint
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
	`selection_snapshot_json` text DEFAULT '{}' NOT NULL,
	`context_snapshot_json` text,
	`active_tools_json` text,
	`error_artifact_id` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_event_id`) REFERENCES `agent_run_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`trigger_node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_tip_node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`error_artifact_id`) REFERENCES `agent_artifacts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_runs_mode_valid" CHECK("agent_runs"."run_mode" IN ('send', 'retry', 'regenerate', 'edit_regenerate', 'continue', 'subagent')),
	CONSTRAINT "agent_runs_status_valid" CHECK("agent_runs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "agent_runs_profile_nonempty" CHECK(length("agent_runs"."agent_profile") > 0)
);
--> statement-breakpoint
CREATE INDEX `agent_runs_thread_idx` ON `agent_runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_parent_run_idx` ON `agent_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_trigger_node_idx` ON `agent_runs` (`trigger_node_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_thread_status_idx` ON `agent_runs` (`thread_id`,`status`);--> statement-breakpoint
CREATE TABLE `agent_thread_node_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`part_index` integer NOT NULL,
	`part_kind` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`state` text DEFAULT 'done' NOT NULL,
	`provider_options_json` text,
	`provider_metadata_json` text,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_thread_node_parts_kind_valid" CHECK("agent_thread_node_parts"."part_kind" IN ('text', 'reasoning', 'tool-call', 'tool-result', 'tool-error', 'file', 'source-url', 'source-document', 'data', 'step-start')),
	CONSTRAINT "agent_thread_node_parts_visibility_valid" CHECK("agent_thread_node_parts"."visibility" IN ('public', 'hidden', 'internal')),
	CONSTRAINT "agent_thread_node_parts_state_valid" CHECK("agent_thread_node_parts"."state" IN ('streaming', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_thread_node_parts_node_idx` ON `agent_thread_node_parts` (`node_id`,`part_index`);--> statement-breakpoint
CREATE INDEX `agent_thread_node_parts_kind_idx` ON `agent_thread_node_parts` (`part_kind`);--> statement-breakpoint
CREATE TABLE `agent_thread_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_node_id` text,
	`role` text NOT NULL,
	`created_by_run_id` text,
	`source_step_id` text,
	`source_kind` text NOT NULL,
	`summary_text` text,
	`message_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_step_id`) REFERENCES `agent_run_steps`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_thread_nodes_parent_not_self" CHECK("agent_thread_nodes"."parent_node_id" IS NULL OR "agent_thread_nodes"."parent_node_id" <> "agent_thread_nodes"."id"),
	CONSTRAINT "agent_thread_nodes_role_valid" CHECK("agent_thread_nodes"."role" IN ('system', 'user', 'assistant', 'tool')),
	CONSTRAINT "agent_thread_nodes_source_kind_valid" CHECK("agent_thread_nodes"."source_kind" IN ('user_input', 'model_response', 'tool_result', 'system_seed', 'edit_rewrite'))
);
--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_thread_idx` ON `agent_thread_nodes` (`thread_id`);--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_parent_idx` ON `agent_thread_nodes` (`parent_node_id`);--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_run_idx` ON `agent_thread_nodes` (`created_by_run_id`);--> statement-breakpoint
CREATE INDEX `agent_thread_nodes_step_idx` ON `agent_thread_nodes` (`source_step_id`);--> statement-breakpoint
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
	FOREIGN KEY (`active_tip_node_id`) REFERENCES `agent_thread_nodes`(`id`) ON UPDATE no action ON DELETE set null,
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
CREATE TABLE `ai_connection_catalog_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`catalog_model_id` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_model_id`) REFERENCES `ai_catalog_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_connection_catalog_override_idx` ON `ai_connection_catalog_overrides` (`connection_id`,`catalog_model_id`);--> statement-breakpoint
CREATE INDEX `ai_connection_catalog_model_idx` ON `ai_connection_catalog_overrides` (`catalog_model_id`);--> statement-breakpoint
CREATE TABLE `ai_connection_custom_models` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`context_window` integer,
	`max_output_tokens` integer,
	`supports_vision` integer DEFAULT false NOT NULL,
	`supports_tool_use` integer DEFAULT false NOT NULL,
	`supports_reasoning` integer DEFAULT false NOT NULL,
	`supports_temperature` integer DEFAULT false NOT NULL,
	`input_price_per_1m` real,
	`output_price_per_1m` real,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `ai_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_connection_custom_models_model_nonempty" CHECK(length("ai_connection_custom_models"."model_id") > 0),
	CONSTRAINT "ai_connection_custom_models_name_nonempty" CHECK(length("ai_connection_custom_models"."display_name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_connection_custom_models_unique_idx` ON `ai_connection_custom_models` (`connection_id`,`model_id`);--> statement-breakpoint
CREATE INDEX `ai_connection_custom_models_connection_idx` ON `ai_connection_custom_models` (`connection_id`);--> statement-breakpoint
CREATE TABLE `ai_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`sdk_package` text NOT NULL,
	`catalog_provider_id` text,
	`base_url` text,
	`api_key` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`catalog_provider_id`) REFERENCES `ai_catalog_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_connections_name_nonempty" CHECK(length("ai_connections"."name") > 0),
	CONSTRAINT "ai_connections_package_nonempty" CHECK(length("ai_connections"."sdk_package") > 0),
	CONSTRAINT "ai_connections_kind_valid" CHECK("ai_connections"."kind" IN ('registry', 'custom')),
	CONSTRAINT "ai_connections_registry_requires_provider" CHECK("ai_connections"."kind" <> 'registry' OR "ai_connections"."catalog_provider_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `ai_connections_kind_idx` ON `ai_connections` (`kind`);--> statement-breakpoint
CREATE INDEX `ai_connections_provider_idx` ON `ai_connections` (`catalog_provider_id`);--> statement-breakpoint
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
CREATE TABLE `aux_node_layers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`timeline_point_id` text,
	`aux_node_id` text NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`parent_aux_node_id` text,
	`name` text,
	`content` text,
	`symlink_target_aux_node_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`timeline_point_id`) REFERENCES `timeline_points`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`,`aux_node_id`) REFERENCES `aux_nodes`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`parent_aux_node_id`) REFERENCES `aux_nodes`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`workspace_id`,`symlink_target_aux_node_id`) REFERENCES `aux_nodes`(`workspace_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "aux_node_layers_not_deleted_or_has_payload" CHECK("aux_node_layers"."is_deleted" = 1 OR "aux_node_layers"."parent_aux_node_id" IS NOT NULL OR "aux_node_layers"."name" IS NOT NULL OR "aux_node_layers"."content" IS NOT NULL OR "aux_node_layers"."symlink_target_aux_node_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aux_node_layers_origin_aux_idx` ON `aux_node_layers` (`workspace_id`,`aux_node_id`) WHERE "aux_node_layers"."timeline_point_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `aux_node_layers_timeline_aux_idx` ON `aux_node_layers` (`workspace_id`,`timeline_point_id`,`aux_node_id`) WHERE "aux_node_layers"."timeline_point_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `aux_node_layers_workspace_aux_idx` ON `aux_node_layers` (`workspace_id`,`aux_node_id`);--> statement-breakpoint
CREATE INDEX `aux_node_layers_timeline_point_idx` ON `aux_node_layers` (`workspace_id`,`timeline_point_id`);--> statement-breakpoint
CREATE TABLE `aux_nodes` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`node_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "aux_nodes_node_type_valid" CHECK("aux_nodes"."node_type" IN ('root', 'dir', 'file', 'symlink'))
);
--> statement-breakpoint
CREATE INDEX `aux_nodes_workspace_idx` ON `aux_nodes` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`head_commit_id` text,
	`forked_from_commit_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`head_commit_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`forked_from_commit_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "branches_name_nonempty" CHECK(length("branches"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_project_name_idx` ON `branches` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `branches_project_idx` ON `branches` (`project_id`);--> statement-breakpoint
CREATE INDEX `branches_head_commit_idx` ON `branches` (`head_commit_id`);--> statement-breakpoint
CREATE TABLE `commit_parents` (
	`commit_id` text NOT NULL,
	`parent_id` text NOT NULL,
	`parent_index` integer NOT NULL,
	`merge_role` text DEFAULT 'normal' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`commit_id`, `parent_id`),
	FOREIGN KEY (`commit_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "commit_parents_merge_role_valid" CHECK("commit_parents"."merge_role" IN ('normal', 'mainline', 'merged')),
	CONSTRAINT "commit_parents_not_self" CHECK("commit_parents"."commit_id" <> "commit_parents"."parent_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commit_parents_commit_index_idx` ON `commit_parents` (`commit_id`,`parent_index`);--> statement-breakpoint
CREATE INDEX `commit_parents_parent_idx` ON `commit_parents` (`parent_id`);--> statement-breakpoint
CREATE TABLE `commits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`tree_id` text NOT NULL,
	`message` text NOT NULL,
	`author` text,
	`committed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tree_id`) REFERENCES `tree_objects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `commits_project_idx` ON `commits` (`project_id`);--> statement-breakpoint
CREATE INDEX `commits_tree_idx` ON `commits` (`tree_id`);--> statement-breakpoint
CREATE TABLE `content_nodes` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`next_sibling_id` text,
	`anchor_timeline_point_id` text,
	`title` text,
	`body` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`parent_id`) REFERENCES `content_nodes`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`next_sibling_id`) REFERENCES `content_nodes`(`workspace_id`,`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`anchor_timeline_point_id`) REFERENCES `timeline_points`(`workspace_id`,`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_nodes_parent_not_self" CHECK("content_nodes"."parent_id" IS NULL OR "content_nodes"."parent_id" <> "content_nodes"."id"),
	CONSTRAINT "content_nodes_next_sibling_not_self" CHECK("content_nodes"."next_sibling_id" IS NULL OR "content_nodes"."next_sibling_id" <> "content_nodes"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_nodes_next_sibling_idx` ON `content_nodes` (`workspace_id`,`next_sibling_id`);--> statement-breakpoint
CREATE INDEX `content_nodes_workspace_idx` ON `content_nodes` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `content_nodes_parent_idx` ON `content_nodes` (`workspace_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `content_nodes_anchor_timeline_point_idx` ON `content_nodes` (`workspace_id`,`anchor_timeline_point_id`);--> statement-breakpoint
CREATE TABLE `global_config_options` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "global_config_options_key_nonempty" CHECK(length("global_config_options"."key") > 0)
);
--> statement-breakpoint
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
CREATE INDEX `projects_default_branch_idx` ON `projects` (`default_branch_id`);--> statement-breakpoint
CREATE TABLE `timeline_points` (
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`prev_point_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`prev_point_id`) REFERENCES `timeline_points`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "timeline_points_label_nonempty" CHECK(length("timeline_points"."label") > 0),
	CONSTRAINT "timeline_points_prev_not_self" CHECK("timeline_points"."prev_point_id" IS NULL OR "timeline_points"."prev_point_id" <> "timeline_points"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_points_prev_point_idx` ON `timeline_points` (`workspace_id`,`prev_point_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_points_single_origin_successor_per_workspace_idx` ON `timeline_points` (`workspace_id`) WHERE "timeline_points"."prev_point_id" IS NULL;--> statement-breakpoint
CREATE INDEX `timeline_points_workspace_idx` ON `timeline_points` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `tree_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tree_objects_kind_valid" CHECK("tree_objects"."kind" IN ('root', 'content', 'aux', 'timeline'))
);
--> statement-breakpoint
CREATE INDEX `tree_objects_project_idx` ON `tree_objects` (`project_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`content_root_id` text,
	`aux_root_id` text,
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