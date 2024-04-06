-- Create "users" table
CREATE TABLE `users` (`id` text NULL, `name` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (`id`));
-- Create "posts" table
CREATE TABLE `posts` (`id` text NULL, `user_id` integer NOT NULL, `title` text NOT NULL, `body` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (`id`), CONSTRAINT `0` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE);
