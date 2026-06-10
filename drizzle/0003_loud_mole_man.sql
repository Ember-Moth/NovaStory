CREATE TABLE `ai_project_assistant_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`active_head_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_head_id`) REFERENCES `ai_project_heads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_project_assistant_state_active_head_idx` ON `ai_project_assistant_state` (`active_head_id`);--> statement-breakpoint
CREATE INDEX `ai_project_assistant_state_updated_at_idx` ON `ai_project_assistant_state` (`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_catalog_models` (
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
	CONSTRAINT "ai_models_display_name_nonempty" CHECK(length("__new_ai_catalog_models"."display_name") > 0),
	CONSTRAINT "ai_models_model_id_nonempty" CHECK(length("__new_ai_catalog_models"."model_id") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_ai_catalog_models`("id", "provider_id", "model_id", "display_name", "family", "input_modalities_json", "output_modalities_json", "context_window", "max_output_tokens", "supports_vision", "supports_tool_use", "supports_reasoning", "supports_temperature", "input_price_per_1m", "output_price_per_1m", "cost_json", "raw_json", "is_active", "last_seen_at", "created_at", "updated_at") SELECT "id", "provider_id", "model_id", "display_name", "family", "input_modalities_json", "output_modalities_json", "context_window", "max_output_tokens", "supports_vision", "supports_tool_use", "supports_reasoning", "supports_temperature", "input_price_per_1m", "output_price_per_1m", "cost_json", "raw_json", "is_active", "last_seen_at", "created_at", "updated_at" FROM `ai_catalog_models`;--> statement-breakpoint
DROP TABLE `ai_catalog_models`;--> statement-breakpoint
ALTER TABLE `__new_ai_catalog_models` RENAME TO `ai_catalog_models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_models_provider_model_idx` ON `ai_catalog_models` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE INDEX `ai_models_provider_idx` ON `ai_catalog_models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `ai_models_active_idx` ON `ai_catalog_models` (`is_active`);--> statement-breakpoint
CREATE TABLE `__new_ai_connections` (
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
	CONSTRAINT "ai_connections_name_nonempty" CHECK(length("__new_ai_connections"."name") > 0),
	CONSTRAINT "ai_connections_package_nonempty" CHECK(length("__new_ai_connections"."sdk_package") > 0),
	CONSTRAINT "ai_connections_kind_valid" CHECK("__new_ai_connections"."kind" IN ('registry', 'custom')),
	CONSTRAINT "ai_connections_registry_requires_provider" CHECK("__new_ai_connections"."kind" <> 'registry' OR "__new_ai_connections"."catalog_provider_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_ai_connections`("id", "kind", "name", "sdk_package", "catalog_provider_id", "base_url", "api_key", "config_json", "is_enabled", "created_at", "updated_at") SELECT "id", "kind", "name", "sdk_package", "catalog_provider_id", "base_url", "api_key", "config_json", "is_enabled", "created_at", "updated_at" FROM `ai_connections`;--> statement-breakpoint
DROP TABLE `ai_connections`;--> statement-breakpoint
ALTER TABLE `__new_ai_connections` RENAME TO `ai_connections`;--> statement-breakpoint
CREATE INDEX `ai_connections_kind_idx` ON `ai_connections` (`kind`);--> statement-breakpoint
CREATE INDEX `ai_connections_provider_idx` ON `ai_connections` (`catalog_provider_id`);