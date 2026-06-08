PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider_type` text NOT NULL,
	`base_url` text,
	`api_key` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "ai_providers_name_nonempty" CHECK(length("__new_ai_providers"."name") > 0),
	CONSTRAINT "ai_providers_type_valid" CHECK("__new_ai_providers"."provider_type" IN ('openai', 'anthropic', 'google', 'deepseek', 'xai', 'ollama', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_providers`("id", "name", "provider_type", "base_url", "api_key", "is_enabled", "created_at", "updated_at") SELECT "id", "name", "provider_type", "base_url", "api_key", "is_enabled", "created_at", "updated_at" FROM `ai_providers`;--> statement-breakpoint
DROP TABLE `ai_providers`;--> statement-breakpoint
ALTER TABLE `__new_ai_providers` RENAME TO `ai_providers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;