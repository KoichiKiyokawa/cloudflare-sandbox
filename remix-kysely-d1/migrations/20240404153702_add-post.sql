-- Create "posts" table
CREATE TABLE `posts` (`id` integer NULL PRIMARY KEY AUTOINCREMENT, `user_id` integer NOT NULL, `title` text NOT NULL, `body` text NOT NULL, `created_at` text NOT NULL DEFAULT (datetime('now')), `updated_at` text NOT NULL DEFAULT (datetime('now')), CONSTRAINT `0` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE);
