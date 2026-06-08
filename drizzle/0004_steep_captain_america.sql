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
DROP TABLE `ai_models`;--> statement-breakpoint
DROP TABLE `ai_providers`;