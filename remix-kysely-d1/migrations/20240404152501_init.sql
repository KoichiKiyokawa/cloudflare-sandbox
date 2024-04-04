-- Create "users" table
CREATE TABLE `users` (`id` integer NULL PRIMARY KEY AUTOINCREMENT, `name` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')));
