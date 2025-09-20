import { relations, sql } from "drizzle-orm";
import { index, pgTableCreator, primaryKey } from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `stem-connect_${name}`);

/**
 * AUTH INFORMATION
 */
export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d
    .timestamp({
      mode: "date",
      withTimezone: true,
    })
    .default(sql`CURRENT_TIMESTAMP`),
  image: d.varchar({ length: 255 }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("account_user_id_idx").on(t.userId),
  ],
);

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * APP INFORMATION
 */

// link to user object
export const personalInformation = createTable("personal_information", (d) => ({
  id: d.varchar({ length: 255 }).notNull().primaryKey(),
  age: d.integer(),
  gender: d.varchar({ length: 255 }),
  location: d.varchar({ length: 255 }),
  interests: d.text(),
  skills: d.text(),
  name: d.varchar({ length: 255 }).notNull(),
  title: d.varchar({ length: 255 }),
  goal: d.text(),
  bio: d.text(),
  imageName: d.varchar({ length: 255 }),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
}));

export const nodes = createTable("node", (d) => ({
  id: d.varchar({ length: 255 }).notNull().primaryKey(),
  name: d.varchar({ length: 255 }).notNull(),
  title: d.varchar({ length: 255 }),
  type: d.varchar({ length: 255 }).notNull(),
  imageName: d.varchar({ length: 255 }),
  time: d.text(),
  description: d.text(),
  createdAt: d
    .timestamp({ mode: "date", withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
}));

export const nodesRelations = relations(nodes, ({ many }) => ({
  links: many(links),
}));

export const links = createTable("link", (d) => ({
  id: d.varchar({ length: 255 }).notNull().primaryKey(),
  source: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => nodes.id),
  target: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => nodes.id),
  userId: d
    .varchar({ length: 255 })
    .notNull()
    .references(() => users.id),
}));
