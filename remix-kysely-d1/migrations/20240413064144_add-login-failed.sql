-- Create "login_failed" table
CREATE TABLE `login_failed` (`ip_or_email` text NOT NULL, `failed_at` text NOT NULL DEFAULT (datetime('now')));
-- Create index "login_failed_ip_or_email" to table: "login_failed"
CREATE INDEX `login_failed_ip_or_email` ON `login_failed` (`ip_or_email`);
