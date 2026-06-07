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
	FOREIGN KEY (`timeline_point_id`) REFERENCES `timeline_points`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`aux_node_id`) REFERENCES `aux_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_aux_node_id`) REFERENCES `aux_nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`symlink_target_aux_node_id`) REFERENCES `aux_nodes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "aux_node_layers_not_deleted_or_has_payload" CHECK("aux_node_layers"."is_deleted" = 1 OR "aux_node_layers"."parent_aux_node_id" IS NOT NULL OR "aux_node_layers"."name" IS NOT NULL OR "aux_node_layers"."content" IS NOT NULL OR "aux_node_layers"."symlink_target_aux_node_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aux_node_layers_workspace_timeline_aux_idx` ON `aux_node_layers` (`workspace_id`, coalesce(`timeline_point_id`, '__origin__'), `aux_node_id`);--> statement-breakpoint
CREATE INDEX `aux_node_layers_workspace_aux_idx` ON `aux_node_layers` (`workspace_id`,`aux_node_id`);--> statement-breakpoint
CREATE INDEX `aux_node_layers_timeline_point_idx` ON `aux_node_layers` (`timeline_point_id`);--> statement-breakpoint
CREATE TABLE `aux_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`node_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "aux_nodes_node_type_valid" CHECK("aux_nodes"."node_type" IN ('root', 'dir', 'file', 'symlink'))
);
--> statement-breakpoint
CREATE INDEX `aux_nodes_workspace_idx` ON `aux_nodes` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `content_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`next_sibling_id` text,
	`anchor_timeline_point_id` text,
	`kind` text,
	`title` text,
	`body` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `content_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`next_sibling_id`) REFERENCES `content_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`anchor_timeline_point_id`) REFERENCES `timeline_points`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_nodes_parent_not_self" CHECK("content_nodes"."parent_id" IS NULL OR "content_nodes"."parent_id" <> "content_nodes"."id"),
	CONSTRAINT "content_nodes_next_sibling_not_self" CHECK("content_nodes"."next_sibling_id" IS NULL OR "content_nodes"."next_sibling_id" <> "content_nodes"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_nodes_next_sibling_idx` ON `content_nodes` (`next_sibling_id`);--> statement-breakpoint
CREATE INDEX `content_nodes_workspace_idx` ON `content_nodes` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `content_nodes_parent_idx` ON `content_nodes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `content_nodes_anchor_timeline_point_idx` ON `content_nodes` (`anchor_timeline_point_id`);--> statement-breakpoint
CREATE TABLE `timeline_points` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`prev_point_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prev_point_id`) REFERENCES `timeline_points`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "timeline_points_key_nonempty" CHECK(length("timeline_points"."key") > 0),
	CONSTRAINT "timeline_points_label_nonempty" CHECK(length("timeline_points"."label") > 0),
	CONSTRAINT "timeline_points_prev_not_self" CHECK("timeline_points"."prev_point_id" IS NULL OR "timeline_points"."prev_point_id" <> "timeline_points"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_points_workspace_key_idx` ON `timeline_points` (`workspace_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_points_prev_point_idx` ON `timeline_points` (`prev_point_id`);--> statement-breakpoint
CREATE INDEX `timeline_points_workspace_idx` ON `timeline_points` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`content_root_id` text,
	`aux_root_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspaces_name_nonempty" CHECK(length("workspaces"."name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_name_idx` ON `workspaces` (`project_id`,`name`);--> statement-breakpoint
CREATE INDEX `workspaces_project_idx` ON `workspaces` (`project_id`);
