import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  DEFAULT_WEEK_START,
  newId,
  type Role,
} from "@delyra/shared";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { type User, users, userSettings, userTotp } from "../db/schema";

export async function findUserByEmail(db: Database, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function findUserById(db: Database, id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

export async function createUser(
  db: Database,
  input: {
    id?: string;
    email: string;
    name: string;
    passwordHash: string;
    role: Role;
    emailVerified: boolean;
  },
  now = Date.now(),
): Promise<User> {
  const id = input.id ?? newId();
  const at = new Date(now);
  const [[user]] = await db.batch([
    db
      .insert(users)
      .values({
        id,
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role,
        emailVerifiedAt: input.emailVerified ? at : null,
        passwordChangedAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .returning(),
    db.insert(userSettings).values({
      userId: id,
      timeZone: DEFAULT_TIME_ZONE,
      locale: DEFAULT_LOCALE,
      weekStart: DEFAULT_WEEK_START,
      updatedAt: at,
    }),
  ]);
  if (!user) throw new Error("No se pudo crear el usuario");
  return user;
}

export async function getUserSettings(db: Database, userId: string) {
  const [settings] = await db
    .select({
      timeZone: userSettings.timeZone,
      locale: userSettings.locale,
      weekStart: userSettings.weekStart,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return settings ?? null;
}

export async function hasConfirmedTotp(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ confirmedAt: userTotp.confirmedAt })
    .from(userTotp)
    .where(eq(userTotp.userId, userId))
    .limit(1);
  return Boolean(row?.confirmedAt);
}

export async function listUsers(db: Database) {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
