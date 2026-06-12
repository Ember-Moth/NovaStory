PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_runs` (
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
	CONSTRAINT "agent_runs_mode_valid" CHECK("__new_agent_runs"."run_mode" IN ('send', 'retry', 'regenerate', 'edit_regenerate', 'continue', 'subagent')),
	CONSTRAINT "agent_runs_status_valid" CHECK("__new_agent_runs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "agent_runs_profile_nonempty" CHECK(length("__new_agent_runs"."agent_profile") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_agent_runs`("id", "thread_id", "parent_run_id", "parent_event_id", "trigger_node_id", "base_tip_node_id", "run_mode", "status", "agent_profile", "selection_snapshot_json", "context_snapshot_json", "active_tools_json", "error_artifact_id", "started_at", "completed_at", "created_at", "updated_at") SELECT "id", "thread_id", "parent_run_id", "parent_event_id", "trigger_node_id", "base_tip_node_id", "run_mode", "status", "agent_profile", "selection_snapshot_json", "context_snapshot_json", NULL, "error_artifact_id", "started_at", "completed_at", "created_at", "updated_at" FROM `agent_runs`;--> statement-breakpoint
DROP TABLE `agent_runs`;--> statement-breakpoint
ALTER TABLE `__new_agent_runs` RENAME TO `agent_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_runs_thread_idx` ON `agent_runs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_parent_run_idx` ON `agent_runs` (`parent_run_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_trigger_node_idx` ON `agent_runs` (`trigger_node_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_thread_status_idx` ON `agent_runs` (`thread_id`,`status`);
