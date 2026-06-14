PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `workspaces` RENAME TO `workspaces_old`;--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`worktree_path` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspaces_name_nonempty" CHECK(length("workspaces"."name") > 0)
);--> statement-breakpoint
INSERT INTO `workspaces` (
	`id`,
	`project_id`,
	`branch_id`,
	`name`,
	`worktree_path`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`project_id`,
	`branch_id`,
	`name`,
	`worktree_path`,
	`created_at`,
	`updated_at`
FROM `workspaces_old`;--> statement-breakpoint
DROP TABLE `workspaces_old`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_name_idx` ON `workspaces` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_branch_idx` ON `workspaces` (`branch_id`);--> statement-breakpoint
CREATE INDEX `workspaces_project_idx` ON `workspaces` (`project_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
