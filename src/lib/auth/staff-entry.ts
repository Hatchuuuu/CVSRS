/**
 * Staff reach their sign-in only by typing this address; no public page links to it, and robots.txt does not name it (that
 * would publish it). Keeping it unlisted keeps the staff entry out of the family-facing site. It is NOT a security control:
 * every clinic page still requires a signed-in account, an approved clinic membership and two-step sign-in, enforced by the
 * server and the database.
 */
export const STAFF_SIGN_IN_PATH = "/evactrackstafflogin";
export const STAFF_SIGN_UP_PATH = `${STAFF_SIGN_IN_PATH}/create-account`;

const STAFF_PATHS = [STAFF_SIGN_IN_PATH, STAFF_SIGN_UP_PATH];

/**
 * The canonical staff address for a request typed with different capitals (for example `/EVACTRACKSTAFFLOGIN`), or null when the
 * path is already canonical or is not a staff address. Only exact staff paths are matched, so nothing else changes.
 */
export function staffEntryRedirect(pathname: string): string | null {
  const lower = pathname.toLowerCase();
  const target = STAFF_PATHS.find((p) => lower === p || lower === `${p}/`);
  return target && pathname !== target ? target : null;
}
