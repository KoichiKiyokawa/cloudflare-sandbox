-- Disable the enforcement of foreign-keys constraints
PRAGMA foreign_keys = off;
-- Create "new_users" table
CREATE TABLE `new_users` (`id` text NOT NULL, `name` text NOT NULL, `email` text NOT NULL, `password_hash` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (`id`));
-- Copy rows from old table "users" to new temporary table "new_users"
INSERT INTO `new_users` (`id`, `name`, `created_at`, `updated_at`) SELECT `id`, `name`, `created_at`, `updated_at` FROM `users`;
-- Drop "users" table after copying rows
DROP TABLE `users`;
-- Rename temporary table "new_users" to "users"
ALTER TABLE `new_users` RENAME TO `users`;
-- Create "new_posts" table
CREATE TABLE `new_posts` (`id` text NOT NULL, `user_id` text NOT NULL, `title` text NOT NULL, `body` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (`id`), CONSTRAINT `0` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE);
-- Copy rows from old table "posts" to new temporary table "new_posts"
INSERT INTO `new_posts` (`id`, `user_id`, `title`, `body`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `title`, `body`, `created_at`, `updated_at` FROM `posts`;
-- Drop "posts" table after copying rows
DROP TABLE `posts`;
-- Rename temporary table "new_posts" to "posts"
ALTER TABLE `new_posts` RENAME TO `posts`;
-- Enable back the enforcement of foreign-keys constraints
PRAGMA foreign_keys = on;
