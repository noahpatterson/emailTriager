type SessionReader = () => Promise<{
  data?: { user?: { id?: string } } | null;
  error?: unknown;
}>;

export async function authorizeOwner(
  ownerId: string,
  getSession: SessionReader,
): Promise<{ userId: string }> {
  const { data, error } = await getSession();
  const userId = data?.user?.id;
  if (error || !userId || userId !== ownerId) throw new Error("Not found");
  return { userId };
}
