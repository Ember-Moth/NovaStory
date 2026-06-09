CREATE TABLE `global_config_options` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "global_config_options_key_nonempty" CHECK(length("global_config_options"."key") > 0)
);
