/**
 * Puts a database password into a postgres connection string, percent-encoding it. Pure, so it can be tested without a
 * database. The username and everything after the host are kept exactly as they were.
 *
 * The password may contain characters that are structural in a URL (@ : / ? # % and so on). Splitting is done on the
 * LAST `@` before the host, which is the one URL syntax uses, so an old password that itself contained a raw `@` is
 * still replaced as a whole.
 */
export function withPassword(url: string, password: string): string {
  const m = /^(postgres(?:ql)?:\/\/)([^:/?#@]+):(.*)@([^@/?#]+)(\/[^?#]*)?(\?[^#]*)?$/.exec(url);
  if (!m) throw new Error("Not a postgres connection string of the form postgres://user:password@host:port/database.");
  const [, scheme, user, , host, dbPath = "", query = ""] = m;
  return `${scheme}${user}:${encodeURIComponent(password)}@${host}${dbPath}${query}`;
}

/** Reads the password back out the way the database driver does, to prove an encoding round-trips. */
export function passwordOf(url: string): string {
  return decodeURIComponent(new URL(url).password);
}
