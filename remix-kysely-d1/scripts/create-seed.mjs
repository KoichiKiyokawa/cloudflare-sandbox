import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

console.log(
	`INSERT INTO users(id, name, email, password_hash) VALUES('${randomUUID()}', 'John Doe', 'hoge@example.com', '${bcrypt.hashSync(
		"password",
	)}')`,
);
