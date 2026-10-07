import { isAbsolute, relative, resolve, sep } from "node:path";

export function assertLocalReviewerTarget(databaseUrl: string, origin: string, expectedDatabase: string, environment: NodeJS.ProcessEnv): void {
  if (environment.DEMO_MODE !== "true" || environment.SIGNAL_REVIEWER_PROFILE !== "isolated-local-review") throw new Error("Explicit isolated local reviewer profile and DEMO_MODE=true required");
  const database = new URL(databaseUrl), api = new URL(origin);
  if (!/^[a-z][a-z0-9_]{5,62}$/.test(expectedDatabase) || ["signal", "postgres", "template0", "template1"].includes(expectedDatabase)) throw new Error("Expected named isolated database required");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !["postgres:", "postgresql:"].includes(database.protocol) || database.pathname !== `/${expectedDatabase}` || !database.port || database.port === "55433") throw new Error("Reviewer tool must target the explicit isolated loopback database; main 55433 is protected");
  if (api.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(api.hostname) || !api.port || ["4310", "4311", "4312"].includes(api.port) || api.username || api.password || api.pathname !== "/" || api.search || api.hash) throw new Error("Reviewer API origin must be an isolated loopback HTTP origin");
}

export function assertPrivateReviewerPath(path: string, projectRoot: string): string {
  if (!isAbsolute(path)) throw new Error("Private reviewer file must use an absolute path outside the project");
  const destination = resolve(path), inside = relative(resolve(projectRoot), destination);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))) throw new Error("Private reviewer file cannot be inside the source/archive project");
  if (!destination.endsWith(".json")) throw new Error("Private reviewer file must be JSON");
  return destination;
}
