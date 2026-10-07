/** Controlled synthetic identities, not a public registration/reset endpoint. */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalReviewerTarget, assertPrivateReviewerPath } from "./reviewer-local-guards.ts";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map<string,string>();
for (let i=2;i<process.argv.length;i+=2) {
  const key=process.argv[i], value=process.argv[i+1];
  if (!key?.startsWith("--") || !value || options.has(key)) throw new Error("Use unique --name value arguments");
  options.set(key,value);
}
if ([...options.keys()].some(key=>!["--mode","--origin","--database","--private-file"].includes(key))) throw new Error("Unknown reviewer tool option");
const mode=options.get("--mode")??"create", origin=options.get("--origin")??"", expectedDatabase=options.get("--database")??"";
if (!["create","status","remove"].includes(mode)) throw new Error("Reviewer mode must be create, status or remove");
assertLocalReviewerTarget(process.env.DATABASE_URL??"",origin,expectedDatabase,process.env);
const privateFile=assertPrivateReviewerPath(options.get("--private-file")??"", projectRoot);
await mkdir(dirname(privateFile),{recursive:true,mode:0o700});
assertPrivateReviewerPath(resolve(await realpath(dirname(privateFile)), privateFile.slice(dirname(privateFile).length+1)), projectRoot);
const {db,pool,signalUsersTable:users,signalCandidateProfilesTable:profiles,signalCandidateResumesTable:resumes,signalCompaniesTable:companies,signalConsentsTable:consents}=await import("../lib/db/src/index.ts");
const {hashPassword}=await import("../artifacts/api-server/src/lib/signal-auth.ts");
const {and,eq,inArray,sql}=await import("../lib/db/node_modules/drizzle-orm/index.js");
const databaseUrl=new URL(process.env.DATABASE_URL!);
const targetFingerprint=createHash("sha256").update(JSON.stringify({host:databaseUrl.hostname,port:databaseUrl.port,database:expectedDatabase})).digest("hex");
type Identity={id:number;email:string;password:string;role:"candidate"|"employer";reviewScopeId:string;resumeId?:number;companyId?:number};
type PrivateManifest={schemaVersion:1;origin:string;targetFingerprint:string;createdAt:string;namespace:string;synthetic:true;accounts:Identity[]};
let file: Awaited<ReturnType<typeof open>> | undefined;
try {
  const current=await db.execute(sql`SELECT current_database() AS name`);
  if ((current.rows[0] as {name?:string})?.name!==expectedDatabase) throw new Error("Connected database differs from isolated target");
  if (mode==="create") {
    // Reserve output before committing any rows; never silently replace credentials.
    file=await open(privateFile,"wx",0o600);
    const namespace=`review-${randomBytes(8).toString("hex")}`;
    const accounts=await db.transaction(async tx=> {
      const accounts:Identity[]=[];
      for(let pair=1;pair<=2;pair++) {
        const reviewScopeId=randomUUID();
        for(const role of ["candidate","employer"] as const) {
          const email=`${namespace}-${pair}-${role}@example.test`, password=randomBytes(24).toString("base64url");
          const [user]=await tx.insert(users).values({email,passwordHash:await hashPassword(password),role,displayName:`Проверяющий ${pair} · ${role==="candidate"?"кандидат":"работодатель"}`,emailVerified:true,demoMode:true,reviewScopeId}).returning();
          const identity:Identity={id:user!.id,email,password,role,reviewScopeId};
          await tx.insert(consents).values(["terms","privacy"].map(consentType=>({userId:user!.id,consentType:consentType as "terms"|"privacy",version:"2026-10-05-synthetic-review-fixture"})));
          if(role==="candidate") {
            await tx.insert(profiles).values({userId:user!.id,professionalAlias:`Проверяющий ${pair}`,contactEmail:email,visibility:"private",consentMatching:false});
            const [resume]=await tx.insert(resumes).values({userId:user!.id,isPrimary:true,title:"Моё резюме",visibility:"private",consentMatching:false,consentCatalog:false,readyForOffers:false}).returning({id:resumes.id});
            identity.resumeId=resume!.id;
          } else {
            const [company]=await tx.insert(companies).values({ownerUserId:user!.id,name:`Компания проверяющего ${pair}`,contactEmail:email}).returning({id:companies.id});
            identity.companyId=company!.id;
          }
          accounts.push(identity);
        }
      }
      const manifest:PrivateManifest={schemaVersion:1,origin,targetFingerprint,createdAt:new Date().toISOString(),namespace,synthetic:true,accounts};
      // A failed private write rolls back provisioning, rather than orphaning identities.
      await file!.writeFile(JSON.stringify(manifest,null,2)+"\n");
      await file!.sync();
      return accounts;
    });
    console.log(JSON.stringify({status:"CREATED",privateFile,reviewerPairs:2,accounts:4,seededAttempts:0,seededGrades:0,answerKeysExported:false}));
  } else {
    const manifest=JSON.parse(await readFile(privateFile,"utf8")) as PrivateManifest;
    if (manifest.schemaVersion!==1||manifest.synthetic!==true||manifest.targetFingerprint!==targetFingerprint||manifest.origin!==origin||!/^review-[a-f0-9]{16}$/.test(manifest.namespace)||manifest.accounts.length!==4) throw new Error("Private manifest does not belong to this isolated target");
    await db.transaction(async tx=> {
      const selected=await tx.select().from(users).where(inArray(users.id,manifest.accounts.map(a=>a.id))).for("update");
      if(selected.length!==4) throw new Error("Expected exactly the four owned reviewer accounts");
      for(const identity of manifest.accounts) {
        const actual=selected.find(u=>u.id===identity.id);
        if (!actual||actual.email!==identity.email||actual.role!==identity.role||actual.reviewScopeId!==identity.reviewScopeId||!actual.demoMode||!identity.email.startsWith(manifest.namespace+"-")) throw new Error("Reviewer ownership mismatch; refusing action");
      }
      const cohorts=new Set(selected.map(u=>u.reviewScopeId));
      if(cohorts.size!==2||cohorts.has(null)||[...cohorts].some(scope=>selected.filter(u=>u.reviewScopeId===scope&&u.role==="candidate").length!==1||selected.filter(u=>u.reviewScopeId===scope&&u.role==="employer").length!==1)) throw new Error("Reviewer pair membership mismatch");
      if(mode==="remove") for(const identity of manifest.accounts) {
        const removed=await tx.delete(users).where(and(eq(users.id,identity.id),eq(users.email,identity.email),eq(users.reviewScopeId,identity.reviewScopeId),eq(users.demoMode,true))).returning({id:users.id});
        if(removed.length!==1) throw new Error("Exact owned reviewer deletion failed");
      }
    });
    console.log(JSON.stringify({status:mode==="remove"?"REMOVED":"OWNED_STATE_PRESENT",privateFile,reviewerPairs:2,accounts:4,credentialsPrinted:false,stateReset:false}));
  }
} catch {
  // Database errors can embed account values. Keep all such details out of public logs.
  console.error(JSON.stringify({status:"FAILED",operation:mode,credentialsPrinted:false}));
  process.exitCode=1;
} finally { await file?.close(); await pool.end(); }
