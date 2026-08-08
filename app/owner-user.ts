export type OwnerUser = Readonly<{
  name: string;
  email: string;
}>;

export function ownerUserFromSession(
  user: Readonly<{ name?: unknown; email?: unknown }> | null | undefined,
): OwnerUser {
  return {
    name: typeof user?.name === "string" ? user.name : "",
    email: typeof user?.email === "string" ? user.email : "",
  };
}
